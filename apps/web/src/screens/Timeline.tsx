import {
  isAgent,
  resolveAuthor,
  type AgentPrItem,
  type ChatDetail,
  type Decision,
  type ForkRef,
  type InheritedContext,
  type MessageItem,
  type ReviewItem,
  type TimelineItem,
} from "@chat0110/chat-protocol";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errorText } from "../api.ts";
import { prefersReducedMotion, useCopy } from "../hooks.ts";
import { decisionEventText, quietDecisionEvents } from "../lib/decision.ts";
import { canForkFrom, groupForks, messageRef } from "../lib/fork.ts";
import { chatRoute } from "../lib/route.ts";
import { clock, dateTimeShort, groupByDay } from "../lib/time.ts";
import { excerpt, initials, plural, sha7 } from "../lib/text.ts";
import {
  blockKey,
  blockTime,
  layoutTimeline,
  mergeTimeline,
  replyLine,
  resolveReply,
  type Block,
  type LocalEntry,
} from "../lib/timeline.ts";
import { forms, s } from "../strings.ts";
import { AppLink } from "../ui/AppLink.tsx";
import { cx, Key, Lamp, Screen, TextButton, TextLink } from "../ui/kit.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { DecisionCard, OutgoingProposals, type DecisionHandler } from "./DecisionCard.tsx";

export interface TimelineProps {
  chat: ChatDetail;
  items: TimelineItem[];
  local: LocalEntry[];
  me: { login: string; display: string };
  now: number;
  /** Путь чата без домена — для «Ссылки» на сообщение. */
  path: string;
  onReply: (m: MessageItem) => void;
  onRetry: (localId: string) => void;
  onAccept: (n: number) => Promise<void>;
  /** Дочерние чаты, ответвлённые от сообщений этого. */
  forks: ForkRef[];
  /** История родителя до точки Fork (у дочернего чата). */
  inherited: InheritedContext | null;
  parentTitle: string | null;
  onFork: (m: MessageItem) => void;
  /** Все решения чата — названия для «Заменяет» и «заменено → …». */
  decisions: Decision[];
  /** Предложения этого Fork родителю. */
  outgoing: Decision[];
  /** «Решение» у сообщения — форма нового решения. */
  onDecide: ((m: MessageItem) => void) | null;
  onDecision: DecisionHandler;
}

export function Timeline(p: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const opened = useRef(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [flashDone, setFlashDone] = useState(false);

  // «Сразу принять» пишет и предложение, и принятие — строку «принял» не повторяем.
  const shown = useMemo(() => {
    const quiet = quietDecisionEvents(p.items);
    return quiet.size ? p.items.filter((i) => !quiet.has(i.id)) : p.items;
  }, [p.items]);
  const view = useMemo(() => mergeTimeline(shown, p.local), [shown, p.local]);
  const blocks = useMemo(() => layoutTimeline(view), [view]);
  const known = useMemo(
    () => [...p.items, ...p.local.flatMap((e) => (e.item ? [e.item] : []))],
    [p.items, p.local],
  );
  const groups = useMemo(() => groupByDay(blocks, blockTime, p.now), [blocks, p.now]);
  const forks = useMemo(
    () => groupForks(p.forks, known.flatMap((i) => (i.kind === "message" ? [i.id] : []))),
    [p.forks, known],
  );

  // Глубокая ссылка #<id>: прокрутить к сообщению и коротко подсветить ободком.
  const flashTo = (id: string): boolean => {
    const el = document.getElementById(id);
    if (!el || !scroller.current?.contains(el)) return false;
    // Человек пришёл читать конкретное место — не утаскиваем его вниз при обновлении.
    nearBottom.current = false;
    // Высокая карточка (решение с доводами) по центру ушла бы заголовком за край.
    const tall = el.offsetHeight > scroller.current.clientHeight * 0.7;
    el.scrollIntoView({ block: tall ? "start" : "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setFlashId(id);
    setFlashDone(false);
    return true;
  };

  useEffect(() => {
    if (!flashId) return;
    const fade = setTimeout(() => setFlashDone(true), prefersReducedMotion() ? 2000 : 40);
    const clear = setTimeout(() => setFlashId(null), 2600);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [flashId]);

  // Цель ссылки, которой ещё нет в ленте (новое решение до перечитывания) —
  // подсветим, как только она появится.
  const pendingHash = useRef<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (id) pendingHash.current = flashTo(id) ? null : id;
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // При открытии — вниз (или к #id); новые сообщения — вниз, только если
  // человек и так был у конца и не читает историю выше.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!opened.current) {
      opened.current = true;
      const id = decodeURIComponent(location.hash.slice(1));
      if (id && flashTo(id)) return;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (pendingHash.current && flashTo(pendingHash.current)) {
      pendingHash.current = null;
      return;
    }
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [blocks.length, p.items]);

  // Окно сузилось, догрузился шрифт, на телефоне открылась клавиатура — если
  // человек был у конца ленты, он там и остаётся.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of [...p.decisions, ...p.outgoing]) m.set(d.id, d.title);
    for (const i of p.items) if (i.kind === "decision") m.set(i.id, i.decision.title);
    return m;
  }, [p.decisions, p.outgoing, p.items]);
  const titleOf = useCallback((id: string) => titles.get(id) ?? null, [titles]);

  const ctx: EntryCtx = { ...p, known, flashId, flashDone, forksAt: forks.byMessage, titleOf };

  // Раскрытый контекст родителя растит ленту сверху — не утаскиваем человека вниз.
  const onContext = () => {
    nearBottom.current = false;
  };

  return (
    <section
      aria-label={s.timeline.label}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-plate bg-plate plinth-6"
    >
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[18px] pt-1.5 pb-4 tab:px-[26px] tab:pt-[18px] tab:pb-[30px]"
      >
        <div>
        {p.chat.parent ? (
          <ForkOrigin chat={p.chat} inherited={p.inherited} parentTitle={p.parentTitle} now={p.now} onToggle={onContext} />
        ) : null}
        <OutgoingProposals outgoing={p.outgoing} chat={p.chat} now={p.now} />
        {groups.length === 0 ? <p className="m-0 py-6 text-copy text-ink-2">{s.timeline.emptyChat}</p> : null}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label}>
            <div className="flex items-center gap-3 pt-1.5 pb-2.5 text-ink-2" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="scale">{g.label}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            {g.items.map((b, i) => (
              <Entry key={blockKey(b)} block={b} first={i === 0} ctx={ctx} />
            ))}
          </div>
        ))}
        {forks.rest.length > 0 ? (
          <div className="flex flex-col gap-2.5 border-t border-line pt-3.5 pb-1">
            <span className="scale text-ink-2">{s.timeline.forksElsewhere}</span>
            <ForkChips forks={forks.rest} repo={p.chat.repo} />
          </div>
        ) : null}
        </div>
      </div>
    </section>
  );
}

// --- Fork: откуда пришёл чат и куда ответвился ---------------------------------

/** Чипы «↳ Fork: …» — Fork всегда в том же репо, что и родитель. */
function ForkChips({ forks, repo, label }: { forks: ForkRef[]; repo: string; label?: string }) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-wrap gap-2.5 p-0">
      {forks.map((f) => (
        <li key={f.chat_id} className="min-w-0">
          <AppLink
            to={chatRoute(repo, f.chat_id)}
            className={cx(
              "inline-flex max-w-full min-h-8 items-center gap-1.5 rounded-full bg-body px-3 pb-[3px] pt-px text-cap font-semibold text-ink no-underline plinth-3",
              "hover:text-ink active:translate-y-px active:plinth-1",
              f.state === "closed" && "opacity-55",
            )}
          >
            <span className="truncate">{s.timeline.forkChip(f.title, f.number)}</span>
            {f.state === "closed" ? <span className="shrink-0 font-normal text-ink-2">· {s.timeline.forkChipClosed}</span> : null}
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function ForkOrigin({
  chat,
  inherited,
  parentTitle,
  now,
  onToggle,
}: {
  chat: ChatDetail;
  inherited: InheritedContext | null;
  parentTitle: string | null;
  now: number;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const parent = chat.parent!;
  const from = messageRef(inherited?.items ?? [], parent.message_id);
  const title = inherited?.title ?? parentTitle ?? parent.chat_id;
  const count = inherited?.items.length ?? 0;
  const reason = chat.meta?.parent?.reason;
  const listId = `inherited-${chat.chat_id}`;
  const ancestors = inherited?.ancestors ?? [];
  const boundaries = new Set(ancestors.map((a) => a.boundary_message_id));
  const titles = new Map(ancestors.map((a) => [a.chat_id, a.title]));
  const groups = useMemo(
    () => groupByDay(inherited?.items ?? [], (m) => m.created_at, now),
    [inherited, now],
  );
  let lastOrigin: string | undefined;
  return (
    <>
      <Screen className="mt-2 mb-3 flex flex-col gap-2 px-4 py-3.5 tab:mt-0">
        <span className="scale text-ink-2">{s.header.fork}</span>
        <p className="m-0 text-key leading-[1.45] [overflow-wrap:anywhere]">
          <b className="font-semibold">{s.timeline.forkFrom(title)}</b>
          {" · "}
          <span className="text-ink-2">{s.timeline.forkFromMessage(from.display, from.excerpt)}</span>
        </p>
        {reason ? <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.timeline.forkReason(reason)}</p> : null}
        {inherited && inherited.gaps.length > 0 ? (
          <p className="m-0 text-cap leading-[1.45] text-ink-2">{inherited.gaps.join(" ")}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-5 gap-y-0.5">
          <AppLink
            to={chatRoute(chat.repo, parent.chat_id)}
            hash={parent.message_id}
            className="inline-flex min-h-8 items-center text-cap text-ink-2 no-underline hover:text-action-ink"
          >
            {s.timeline.openParent}
          </AppLink>
          {count > 0 ? (
            <TextButton
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => {
                onToggle();
                setOpen((o) => !o);
              }}
            >
              {open ? s.timeline.hideContext : s.timeline.showContext(plural(count, forms.messages))}
            </TextButton>
          ) : null}
        </div>
      </Screen>
      {open && inherited ? (
        <section id={listId} aria-label={s.timeline.contextLabel} className="mb-2 border-b border-line pb-2">
          <p className="m-0 pb-1 text-cap text-ink-2">{s.timeline.contextNote}</p>
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.label}>
              <div className="flex items-center gap-3 pt-2 pb-1 text-ink-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="scale">{g.label}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              {g.items.map((m) => {
                const showOrigin = ancestors.length > 1 && m.origin_chat_id !== undefined && m.origin_chat_id !== lastOrigin;
                lastOrigin = m.origin_chat_id ?? lastOrigin;
                return (
                  <InheritedMessage
                    key={m.id}
                    m={m}
                    point={boundaries.size > 0 ? boundaries.has(m.id) : m.id === parent.message_id}
                    origin={showOrigin ? titles.get(m.origin_chat_id!) ?? m.origin_chat_id! : null}
                  />
                );
              })}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

/** Сообщение родителя: приглушённое, только чтение, без клавиш. */
function InheritedMessage({ m, point, origin }: { m: MessageItem; point: boolean; origin: string | null }) {
  return (
    <article className="flex gap-3.5 py-3 opacity-60">
      <Avatar author={m.author} display={m.display} human={!isAgent(m.author)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {origin ? <span className="scale text-ink-2">{origin}</span> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <b className="text-copy font-semibold">{m.display}</b>
          <span className="text-cap text-ink-2">{dateTimeShort(m.created_at)}</span>
          {point ? (
            <span className="flex items-center gap-1.5 text-cap font-semibold text-ink">
              <span aria-hidden="true" className="size-2 rounded-full bg-ink" />
              {s.timeline.forkPoint}
            </span>
          ) : null}
        </div>
        <Markdown text={m.text} />
      </div>
    </article>
  );
}

interface EntryCtx extends TimelineProps {
  known: TimelineItem[];
  flashId: string | null;
  flashDone: boolean;
  forksAt: Map<string, ForkRef[]>;
  titleOf: (id: string) => string | null;
}

function Entry({ block, first, ctx }: { block: Block; first: boolean; ctx: EntryCtx }) {
  if (block.type === "local") return <LocalMessage entry={block.entry} first={first} ctx={ctx} />;
  if (block.type === "agentPr") {
    return block.item.state === "open" ? (
      <AgentPrCard item={block.item} pending={block.pending} ctx={ctx} />
    ) : (
      <SystemLine first={first} at={block.item.created_at}>
        {block.item.state === "merged"
          ? s.timeline.agentPrMerged(block.item.display, block.item.number)
          : s.timeline.agentPrClosed(block.item.display, block.item.number)}
      </SystemLine>
    );
  }
  const item = block.item;
  switch (item.kind) {
    case "message":
      return <Message m={item} first={first} published={block.published} ctx={ctx} />;
    case "review":
      return <Review r={item} />;
    case "created":
      return (
        <SystemLine first={first} at={item.created_at}>
          {s.timeline.created(item.actor, ctx.chat.number, ctx.chat.draft)}
        </SystemLine>
      );
    case "push":
      return (
        <SystemLine first={first} at={item.created_at}>
          {s.timeline.pushed(item.display, item.title, plural(item.files, forms.files))}
        </SystemLine>
      );
    case "decision":
      return (
        <DecisionCard
          d={item.decision}
          chat={ctx.chat}
          known={ctx.known}
          forks={ctx.forks}
          titleOf={ctx.titleOf}
          now={ctx.now}
          flash={ctx.flashId === item.id}
          flashDone={ctx.flashDone}
          onAction={ctx.onDecision}
        />
      );
    case "decision_event":
      return (
        <SystemLine first={first} at={item.created_at} note={item.text ? excerpt(item.text, 220) : null}>
          <a href={`#${item.decision_id}`} className="no-underline">
            {decisionEventText(item)}
          </a>
        </SystemLine>
      );
    case "agent_pr":
      return null;
  }
}

// --- Сообщение -----------------------------------------------------------------

function Avatar({ author, display, human }: { author: string; display: string; human: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "hidden size-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tab:flex",
        human ? "bg-knob-ink text-knob-ink-fg avatar-ink" : "bg-body text-ink avatar-plastic",
      )}
    >
      {initials(author, display)}
    </span>
  );
}

function metaLine(m: MessageItem): string {
  const parts: string[] = [];
  if (isAgent(m.author)) parts.push(s.timeline.agent);
  if (m.actor && resolveAuthor(m.actor) !== m.author) {
    parts.push(m.source === "comment" ? s.timeline.postedBy(m.actor) : s.timeline.pushedBy(m.actor));
  }
  parts.push(clock(m.created_at));
  if (m.source === "file") parts.push(s.timeline.file(sha7(m.commit_sha)));
  else if (m.source === "comment") parts.push(s.timeline.comment);
  else if (m.agent_pr != null) parts.push(s.timeline.fromPr(m.agent_pr));
  return parts.join(" · ");
}

function Message({ m, first, published, ctx }: { m: MessageItem; first: boolean; published: boolean; ctx: EntryCtx }) {
  const reply = m.reply_to ? resolveReply(ctx.known, m.reply_to) : null;
  const { copied, copy } = useCopy();
  const flashing = ctx.flashId === m.id;
  const forks = ctx.forksAt.get(m.id);
  return (
    <article
      id={m.id}
      className={cx(
        "flex scroll-mt-4 gap-3.5 py-3.5 tab:py-4",
        !first && "border-t border-line",
        flashing && "flash",
        flashing && ctx.flashDone && "flash-done",
      )}
    >
      <Avatar author={m.author} display={m.display} human={!isAgent(m.author)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <b className="text-copy font-semibold">{m.display}</b>
          <span className="text-cap text-ink-2">{metaLine(m)}</span>
          {m.pending ? <span className="text-cap text-action-ink">{s.timeline.notMerged}</span> : null}
          {published ? (
            <span className="flex items-center gap-1.5 text-cap text-ink-2">
              <Lamp state="live" size={8} ring={false} />
              {s.timeline.published}
            </span>
          ) : null}
        </div>
        {reply ? <span className="text-cap text-ink-2">{replyLine(reply)}</span> : null}
        <Markdown text={m.text} />
        <div className="flex flex-wrap gap-4">
          <TextButton onClick={() => ctx.onReply(m)}>{s.timeline.reply}</TextButton>
          {m.url ? (
            <TextLink href={m.url} target="_blank" rel="noopener noreferrer">
              {s.timeline.inGitHub}
            </TextLink>
          ) : null}
          <TextButton onClick={() => copy(`${location.origin}${ctx.path}#${m.id}`)} aria-live="polite">
            {copied ? s.copied : s.timeline.link}
          </TextButton>
          {canForkFrom(m) ? <TextButton onClick={() => ctx.onFork(m)}>{s.timeline.fork}</TextButton> : null}
          {!m.pending && ctx.chat.can_push && ctx.onDecide ? (
            <TextButton onClick={() => ctx.onDecide?.(m)}>{s.timeline.decide}</TextButton>
          ) : null}
        </div>
        {forks ? <ForkChips forks={forks} repo={ctx.chat.repo} label={s.timeline.forksLabel} /> : null}
      </div>
    </article>
  );
}

function LocalMessage({ entry, first, ctx }: { entry: LocalEntry; first: boolean; ctx: EntryCtx }) {
  const reply = entry.reply_to ? resolveReply(ctx.known, entry.reply_to) : null;
  const failed = entry.status === "error";
  return (
    <article
      aria-busy={!failed || undefined}
      className={cx("flex gap-3.5 py-3.5 tab:py-4", !first && "border-t border-line", !failed && "opacity-60")}
    >
      <Avatar author={ctx.me.login} display={ctx.me.display} human />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <b className="text-copy font-semibold">{ctx.me.display}</b>
          {failed ? (
            <span className="flex flex-wrap items-center gap-x-1.5 text-cap" role="alert">
              <Lamp state="act" size={8} ring={false} />
              <TextButton onClick={() => ctx.onRetry(entry.localId)} className="min-h-0 text-action-ink underline">
                {s.timeline.retrySend}
              </TextButton>
              {entry.error ? <span className="text-ink-2">· {entry.error}</span> : null}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-cap text-ink-2">
              <span aria-hidden="true" className="box-border size-2 rounded-full border-2 border-solid border-lamp-off" />
              {s.timeline.sending}
            </span>
          )}
        </div>
        {reply ? <span className="text-cap text-ink-2">{replyLine(reply)}</span> : null}
        <Markdown text={entry.text} />
      </div>
    </article>
  );
}

// --- Системные строки, ревью, PR агента ------------------------------------------

function SystemLine({ first, at, note, children }: { first: boolean; at: string; note?: string | null; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1 text-cap text-ink-2", first ? "pt-2 pb-3.5" : "border-t border-line py-3")}>
      <div className="flex items-center gap-2.5">
        <Lamp state="off" size={6} ring={false} />
        <span>
          {children} · {clock(at)}
        </span>
      </div>
      {note ? <p className="m-0 pl-4 leading-[1.45] text-ink [overflow-wrap:anywhere]">«{note}»</p> : null}
    </div>
  );
}

function hunkTail(hunk: string | undefined): string | null {
  if (!hunk) return null;
  const lines = hunk.split("\n").filter((l) => !l.startsWith("@@"));
  return lines.length ? lines.slice(-3).join("\n") : null;
}

function Review({ r }: { r: ReviewItem }) {
  const where = r.path ? s.timeline.reviewLine(r.path, r.line) : r.state ? s.timeline.reviewState[r.state] : undefined;
  const snippet = hunkTail(r.diff_hunk);
  return (
    <Screen id={r.id} className="mt-1 mb-4 flex flex-col gap-2.5 px-4 py-3.5 tab:ml-12">
      <span className="text-cap text-ink-2">
        <b className="font-semibold text-ink">{s.timeline.review(r.display)}</b>
        {where ? ` · ${where}` : ""} · {clock(r.created_at)}
      </span>
      {snippet ? (
        <pre className="m-0 overflow-x-auto rounded-[10px] bg-plate px-3 py-2 font-mono text-[12.5px] leading-[1.5] whitespace-pre">
          {snippet}
        </pre>
      ) : null}
      {r.text ? <Markdown text={r.text} className="text-key" /> : null}
      <TextLink href={r.url} target="_blank" rel="noopener noreferrer" className="self-start">
        {s.timeline.inGitHub}
      </TextLink>
    </Screen>
  );
}

function AgentPrCard({ item, pending, ctx }: { item: AgentPrItem; pending: MessageItem[]; ctx: EntryCtx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = pending.length || item.message_ids.length;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await ctx.onAccept(item.number);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      id={item.id}
      className="bezel mx-1 mt-1.5 mb-5 flex flex-col gap-3 rounded-body bg-body px-3.5 pt-3.5 pb-5 plinth-7 tab:mr-1 tab:ml-[52px] tab:px-[18px] tab:pt-4 tab:pb-[22px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2.5 text-key font-semibold tab:text-copy">
          <Lamp state="act" />
          {s.timeline.agentPrOpened(item.display, item.number)}
        </span>
        <span className="text-cap text-action-ink">
          {count ? s.timeline.agentPrPending(plural(count, forms.messages)) : s.timeline.notMerged}
        </span>
      </div>
      {pending.map((m) => {
        const flashing = ctx.flashId === m.id;
        return (
          <div
            key={m.id}
            id={m.id}
            className={cx("flex flex-col gap-1", flashing && "flash", flashing && ctx.flashDone && "flash-done")}
          >
            <span className="text-cap text-ink-2">
              {m.display} · {clock(m.created_at)} · <span className="text-action-ink">{s.timeline.notMerged}</span>
            </span>
            <Markdown text={m.text} className="text-key" />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2.5">
        <Key onClick={accept} disabled={busy}>
          {busy ? s.timeline.accepting : s.timeline.accept}
        </Key>
        <TextLink href={item.url} target="_blank" rel="noopener noreferrer" className="min-h-10 px-1.5">
          {s.timeline.openPr(item.number)}
        </TextLink>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-cap text-action-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
