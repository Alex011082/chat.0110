import {
  isAgent,
  resolveAuthor,
  type AgentPrItem,
  type ChatDetail,
  type MessageItem,
  type ReviewItem,
  type TimelineItem,
} from "@chat0110/chat-protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errorText } from "../api.ts";
import { prefersReducedMotion, useCopy } from "../hooks.ts";
import { clock, groupByDay } from "../lib/time.ts";
import { initials, plural, sha7 } from "../lib/text.ts";
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
import { cx, Key, Lamp, Screen, TextButton, TextLink } from "../ui/kit.tsx";
import { Markdown } from "../ui/Markdown.tsx";

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
}

export function Timeline(p: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const opened = useRef(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [flashDone, setFlashDone] = useState(false);

  const view = useMemo(() => mergeTimeline(p.items, p.local), [p.items, p.local]);
  const blocks = useMemo(() => layoutTimeline(view), [view]);
  const known = useMemo(
    () => [...p.items, ...p.local.flatMap((e) => (e.item ? [e.item] : []))],
    [p.items, p.local],
  );
  const groups = useMemo(() => groupByDay(blocks, blockTime, p.now), [blocks, p.now]);

  // Глубокая ссылка #<id>: прокрутить к сообщению и коротко подсветить ободком.
  const flashTo = (id: string): boolean => {
    const el = document.getElementById(id);
    if (!el || !scroller.current?.contains(el)) return false;
    // Человек пришёл читать конкретное место — не утаскиваем его вниз при обновлении.
    nearBottom.current = false;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
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

  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (id) flashTo(id);
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

  const ctx: EntryCtx = { ...p, known, flashId, flashDone };

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
        </div>
      </div>
    </section>
  );
}

interface EntryCtx extends TimelineProps {
  known: TimelineItem[];
  flashId: string | null;
  flashDone: boolean;
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
        </div>
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

function SystemLine({ first, at, children }: { first: boolean; at: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 text-cap text-ink-2",
        first ? "pt-2 pb-3.5" : "border-t border-line py-3",
      )}
    >
      <Lamp state="off" size={6} ring={false} />
      <span>
        {children} · {clock(at)}
      </span>
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
