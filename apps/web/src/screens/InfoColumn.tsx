import type { ChatDetail, Decision, ForkRef, InheritedContext, TimelineItem } from "@chat0110/chat-protocol";
import { useEffect, useMemo, useState } from "react";
import { dispatchRequest } from "../dispatch.ts";
import { mergeAgentParticipants, sessionsForAuthor, type AutoReplyView } from "../lib/auto-replies.ts";
import { ParticipantAutoReplies } from "./ParticipantAutoReplies.tsx";
import { useCopy } from "../hooks.ts";
import { agentLinkPhrase } from "../lib/chat.ts";
import { awaitsHuman, statusLabel } from "../lib/decision.ts";
import { messageRef } from "../lib/fork.ts";
import { chatRoute, splitRepo } from "../lib/route.ts";
import { plural } from "../lib/text.ts";
import { ago, dateTimeShort, isFresh } from "../lib/time.ts";
import { countTimeline } from "../lib/timeline.ts";
import { forms, s } from "../strings.ts";
import { AppLink } from "../ui/AppLink.tsx";
import { Body, cx, Grille, Key, Lamp, Plate, Screen } from "../ui/kit.tsx";
import { DecisionGlyph, whenShort } from "./DecisionCard.tsx";

interface InfoProps {
  chat: ChatDetail;
  items: TimelineItem[];
  now: number;
  forks: ForkRef[];
  inherited: InheritedContext | null;
  parentTitle: string | null;
  decisions: Decision[];
  /** Предложения этого Fork родителю. */
  outgoing: Decision[];
  /** Переход к карточке в ленте: на телефоне и планшете панель закрывается. */
  onJump: () => void;
  onPropose: (() => void) | null;
  /** 2 — инструкция в Chat/AGENTS.md. Без поля чат ещё на схеме 1. */
  store?: 1 | 2;
}

/** Правая колонка: участники, решения, ветвления, ссылка для агента, паспорт чата. */
export function InfoColumn({ chat, items, now, forks, inherited, parentTitle, decisions, outgoing, onJump, onPropose, store }: InfoProps) {
  const counts = useMemo(() => countTimeline(items), [items]);
  const owner = chat.created_by.toLowerCase();
  const [autoReplies, setAutoReplies] = useState<AutoReplyView | null>(null);
  const [autoError, setAutoError] = useState(false);
  useEffect(() => {
    let alive = true;
    setAutoReplies(null);
    const refresh = () =>
      dispatchRequest(`${chat.repo}/${chat.chat_id}`).then(
        (value) => {
          if (alive) {
            setAutoReplies(value as AutoReplyView);
            setAutoError(false);
          }
        },
        () => {
          if (alive) setAutoError(true);
        },
      );
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [chat.repo, chat.chat_id]);
  const participants = useMemo(
    // Владелец — первым, остальные — кто писал недавно.
    () =>
      mergeAgentParticipants(chat.participants, autoReplies?.sessions ?? []).sort((a, b) =>
        a.author === owner ? -1 : b.author === owner ? 1 : a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : 0,
      ),
    [chat.participants, owner, autoReplies],
  );
  const phrase = agentLinkPhrase(chat.url, store);
  const { copied, failed, copy } = useCopy();

  return (
    <div className="flex flex-col gap-[22px]">
      <Plate className="flex flex-col gap-3.5 px-6 pt-[22px] pb-7">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.info.participants}</h2>
        {participants.length === 0 ? <p className="m-0 text-cap text-ink-2">{s.info.nobody}</p> : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {participants.map((p) => {
            const when = ago(p.last_at, now);
            const role = p.is_agent
              ? p.count === 0 ? (s.locale === "en" ? "Has not replied yet" : "Ещё не отвечал") : s.info.agentWrote(when)
              : p.author === owner
                ? s.info.owner
                : s.info.humanWrote(when);
            return (
              <li key={p.author} className="flex items-start gap-3">
                <Lamp state={p.is_agent ? sessionsForAuthor(autoReplies?.sessions ?? [], p.author).some((session) => session.auto_enabled && session.online) ? "live" : "off" : isFresh(p.last_at, now) ? "live" : "off"} className="mt-1.5 shrink-0" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-copy leading-snug font-semibold [overflow-wrap:anywhere]">{p.display}</span>
                  <span className="text-cap text-ink-2">{role}</span>
                  {p.is_agent ? <ParticipantAutoReplies author={p.author} sessions={sessionsForAuthor(autoReplies?.sessions ?? [], p.author)} view={autoReplies} repo={chat.repo} chatId={chat.chat_id} canPush={chat.can_push && chat.state === "open"} onChange={setAutoReplies} /> : null}
                </span>
              </li>
            );
          })}
        </ul>
        {autoError ? <p role="status" className="m-0 text-cap text-ink-2">{s.locale === "en" ? "Connection status unavailable. Retrying…" : "Не удалось проверить сессии. Повторяем…"}</p> : null}
      </Plate>

      <Decisions chat={chat} decisions={decisions} now={now} onJump={onJump} />

      {chat.parent ? (
        <Proposals chat={chat} outgoing={outgoing} parentTitle={parentTitle} now={now} onPropose={onPropose} />
      ) : null}

      <Branches chat={chat} items={items} forks={forks} inherited={inherited} parentTitle={parentTitle} />

      <Body className="flex flex-col gap-3.5 px-[18px] pt-[18px] pb-[26px]">
        <div className="flex items-center justify-between gap-2.5">
          <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.info.agentLink}</h2>
          <Grille width={46} height={16} />
        </div>
        <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.info.agentLinkHelp}</p>
        <Screen as="div" className="px-4 py-3.5 text-key leading-[1.45] [overflow-wrap:anywhere]">
          {phrase}
        </Screen>
        <div className="flex items-center gap-3">
          <Key onClick={() => copy(phrase)} className="self-start">
            {s.info.copy}
          </Key>
          <span aria-live="polite" className="text-cap text-ink-2">
            {copied ? s.copied : failed ? s.errors.copyFailed : ""}
          </span>
        </div>
      </Body>

      <Plate className="flex flex-col gap-2.5 px-6 pt-[22px] pb-7">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.info.about}</h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2 text-cap">
          <dt className="text-ink-2">{s.info.createdBy}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">
            {chat.created_by}, {dateTimeShort(chat.created_at)}
          </dd>
          <dt className="text-ink-2">{s.info.inBranch}</dt>
          <dd className="m-0">{plural(counts.inBranch, forms.messages)}</dd>
          <dt className="text-ink-2">{s.info.inPr}</dt>
          <dd className="m-0">
            {plural(counts.comments, forms.comments)} · {plural(counts.reviews, forms.reviews)}
          </dd>
          <dt className="text-ink-2">{s.info.stored}</dt>
          <dd className="m-0">{s.info.storedValue}</dd>
        </dl>
      </Plate>

      <p className="m-0 px-1.5 text-cap leading-[1.45] text-ink-2">{s.info.soon}</p>
    </div>
  );
}

const ROW_LINK =
  "flex min-w-0 flex-col gap-0.5 rounded-row px-3 pt-2 pb-2.5 text-ink no-underline hover:bg-screen hover:text-ink";

/** «Ветвления»: откуда этот чат и какие Fork от него пошли. */
function Branches({
  chat,
  items,
  forks,
  inherited,
  parentTitle,
}: {
  chat: ChatDetail;
  items: TimelineItem[];
  forks: ForkRef[];
  inherited: InheritedContext | null;
  parentTitle: string | null;
}) {
  const parent = chat.parent;
  const from = parent ? messageRef(inherited?.items ?? [], parent.message_id) : null;
  const sorted = [...forks].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const r = splitRepo(chat.repo);
  return (
    <Plate className="flex flex-col gap-3 px-6 pt-[22px] pb-7">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.info.branches}</h2>
        {r ? (
          <AppLink
            to={{ owner: r.owner, repo: r.name, chatId: null, tree: true, select: chat.chat_id }}
            className="shrink-0 text-cap whitespace-nowrap text-ink-2 no-underline hover:text-action-ink"
          >
            {s.info.showInTree}
          </AppLink>
        ) : null}
      </div>
      {parent && from ? (
        <div className="flex flex-col gap-1">
          <span className="scale text-ink-2">{s.info.parent}</span>
          <AppLink to={chatRoute(chat.repo, parent.chat_id)} hash={parent.message_id} className={cx(ROW_LINK, "-mx-3")}>
            <span className="text-key leading-snug font-semibold [overflow-wrap:anywhere]">
              {inherited?.title ?? parentTitle ?? parent.chat_id}
            </span>
            <span className="text-cap text-ink-2">
              {s.info.fromMessage(from.display, from.created_at ? dateTimeShort(from.created_at) : null)}
            </span>
          </AppLink>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="scale text-ink-2">{s.info.children}</span>
        {sorted.length === 0 ? <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.info.noForks}</p> : null}
        {sorted.length > 0 ? (
          <ul className="-mx-3 m-0 flex list-none flex-col p-0">
            {sorted.map((f) => {
              const at = messageRef(items, f.message_id);
              return (
                <li key={f.chat_id} className={cx(f.state === "closed" && "opacity-55")}>
                  <AppLink to={chatRoute(chat.repo, f.chat_id)} className={ROW_LINK}>
                    <span className="flex items-center gap-2 text-key leading-snug font-semibold">
                      <span aria-hidden="true" className="text-ink-3">↳</span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{f.title}</span>
                    </span>
                    <span className="pl-[18px] text-cap text-ink-2">
                      {s.info.childMeta(f.number, f.state === "closed")} ·{" "}
                      {s.info.fromMessage(at.display, at.created_at ? dateTimeShort(at.created_at) : null)}
                    </span>
                  </AppLink>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Plate>
  );
}

/** Ждущие человека — сверху, дальше свежие первыми. */
function byAttention(a: Decision, b: Decision): number {
  return Number(awaitsHuman(b.status)) - Number(awaitsHuman(a.status)) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
}

function DecisionRow({ d, to, hash, meta, onClick }: { d: Decision; to: ReturnType<typeof chatRoute>; hash: string; meta: string; onClick?: () => void }) {
  return (
    <AppLink to={to} hash={hash} onClick={onClick} className={ROW_LINK}>
      <span className="flex items-start gap-2.5">
        <span className="pt-[3px]">
          <DecisionGlyph status={d.status} />
        </span>
        <span className="min-w-0 text-key leading-snug font-semibold [overflow-wrap:anywhere]">{d.title}</span>
      </span>
      <span className={cx("pl-[24px] text-cap", awaitsHuman(d.status) ? "text-action-ink" : "text-ink-2")}>{meta}</span>
    </AppLink>
  );
}

/** «Решения» чата: щелчок — к карточке в ленте. */
function Decisions({ chat, decisions, now, onJump }: { chat: ChatDetail; decisions: Decision[]; now: number; onJump: () => void }) {
  const sorted = [...decisions].sort(byAttention);
  const titles = new Map(decisions.map((d) => [d.id, d.title] as const));
  const opts = { titleOf: (id: string) => titles.get(id) ?? null, when: (iso: string) => whenShort(iso, now) };
  return (
    <Plate className="flex flex-col gap-3 px-6 pt-[22px] pb-7">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.info.decisions}</h2>
        {decisions.length > 0 ? <span className="text-cap text-ink-2">{plural(decisions.length, forms.decisions)}</span> : null}
      </div>
      {sorted.length === 0 ? <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.info.noDecisions}</p> : null}
      {sorted.length > 0 ? (
        <ul className="-mx-3 m-0 flex list-none flex-col p-0">
          {sorted.map((d) => (
            <li key={d.id}>
              <DecisionRow
                d={d}
                to={chatRoute(chat.repo, chat.chat_id)}
                hash={d.id}
                meta={(d.from_chat ? `${s.decision.fromFork} · ` : "") + statusLabel(d, opts)}
                onClick={onJump}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Plate>
  );
}

/** «Предложения родителю» — только у Fork. */
function Proposals({
  chat,
  outgoing,
  parentTitle,
  now,
  onPropose,
}: {
  chat: ChatDetail;
  outgoing: Decision[];
  parentTitle: string | null;
  now: number;
  onPropose: (() => void) | null;
}) {
  const parent = chat.parent!;
  const titles = new Map(outgoing.map((d) => [d.id, d.title] as const));
  const opts = { titleOf: (id: string) => titles.get(id) ?? null, when: (iso: string) => whenShort(iso, now) };
  const sorted = [...outgoing].sort(byAttention);
  return (
    <Plate className="flex flex-col gap-3 px-6 pt-[22px] pb-7">
      <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.info.proposals}</h2>
      {sorted.length === 0 ? <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.info.noProposals}</p> : null}
      {sorted.length > 0 ? (
        <ul className="-mx-3 m-0 flex list-none flex-col p-0">
          {sorted.map((d) => (
            <li key={d.id}>
              <DecisionRow
                d={d}
                to={chatRoute(chat.repo, parent.chat_id)}
                hash={d.id}
                meta={`${d.status === "proposed" ? s.decision.outgoingWaiting : statusLabel(d, opts)} · ${s.info.proposalTo(parentTitle ?? parent.chat_id)}`}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {onPropose ? (
        <Key onClick={onPropose} className="self-start">
          {s.info.propose}
        </Key>
      ) : null}
    </Plate>
  );
}
