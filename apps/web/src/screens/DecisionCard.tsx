import { displayName, type ChatDetail, type Decision, type ForkRef, type TimelineItem } from "@chat0110/chat-protocol";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorText } from "../api.ts";
import { routeHref } from "../hooks.ts";
import { awaitsHuman, decisionActions, decisionLamp, statusLabel, type DecisionVerb } from "../lib/decision.ts";
import { messageRef } from "../lib/fork.ts";
import { chatRoute } from "../lib/route.ts";
import { excerpt } from "../lib/text.ts";
import { clock, dateTimeShort, dayKey } from "../lib/time.ts";
import { s } from "../strings.ts";
import { AppLink, followInApp } from "../ui/AppLink.tsx";
import { ActionKey, cx, Key, KeyLink, Lamp, Readout, Screen, SLOT, TextButton } from "../ui/kit.tsx";
import { Markdown } from "../ui/Markdown.tsx";

// Карточка решения в ленте (docs/protocol.md, «Решения (Этап 5)»). Предложение
// из Fork — та же карточка с показаниями «Источник» и «Исходная точка»
// (п. 4.7 спеки). Пока решение ждёт человека — светится оранжевый ободок.

export type DecisionHandler = (d: Decision, verb: DecisionVerb, text?: string) => Promise<void>;

/** «10:14» сегодня, «22 окт., 10:14» — раньше. */
export function whenShort(iso: string, now: number): string {
  return dayKey(iso) === dayKey(now) ? clock(iso) : dateTimeShort(iso);
}

const CHIP =
  "inline-flex max-w-full min-h-8 items-center gap-1.5 rounded-full bg-body px-3 pb-[3px] pt-px text-cap font-semibold text-ink no-underline plinth-3 hover:text-ink active:translate-y-px active:plinth-1";

interface CardProps {
  d: Decision;
  chat: ChatDetail;
  /** Загруженная лента чата: имена и цитаты оснований. */
  known: readonly TimelineItem[];
  forks: readonly ForkRef[];
  titleOf: (id: string) => string | null;
  now: number;
  flash: boolean;
  flashDone: boolean;
  onAction: DecisionHandler;
}

export function DecisionCard({ d, chat, known, forks, titleOf, now, flash, flashDone, onAction }: CardProps) {
  const [busy, setBusy] = useState<DecisionVerb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discussing, setDiscussing] = useState(false);
  const [comment, setComment] = useState("");
  const waiting = awaitsHuman(d.status);
  const lamp = decisionLamp(d.status);
  const verbs = decisionActions(d.status, chat.can_push);
  const fork = d.from_chat ? (forks.find((f) => f.chat_id === d.from_chat) ?? null) : null;
  const when = (iso: string) => whenShort(iso, now);
  const label = statusLabel(d, { titleOf, when });
  const fieldId = `discuss-${d.id}`;
  const form = useRef<HTMLFormElement>(null);

  // Поле обсуждения появляется под клавишами — в короткой ленте оно было бы за краем.
  useEffect(() => {
    if (discussing) form.current?.scrollIntoView({ block: "nearest" });
  }, [discussing]);

  const run = async (verb: DecisionVerb, text?: string) => {
    setBusy(verb);
    setError(null);
    try {
      await onAction(d, verb, text);
      if (verb === "discuss") {
        setComment("");
        setDiscussing(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const sendComment = (e: FormEvent) => {
    e.preventDefault();
    if (comment.trim() && !busy) void run("discuss", comment.trim());
  };

  const forkTo = d.from_chat ? chatRoute(chat.repo, d.from_chat) : null;

  return (
    <article
      id={d.id}
      aria-label={`${d.from_chat ? s.decision.fromFork : s.decision.card}: ${d.title}`}
      className={cx(
        "mx-1 mt-1.5 mb-5 flex scroll-mt-4 flex-col gap-3 rounded-body bg-body px-3.5 pt-3.5 pb-5 plinth-7",
        "tab:mr-1 tab:ml-[52px] tab:px-[18px] tab:pt-4 tab:pb-[22px]",
        waiting && "bezel",
        // Ободок ожидания уже горит — вспышка глубокой ссылки его бы погасила.
        !waiting && flash && "flash",
        !waiting && flash && flashDone && "flash-done",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2.5">
          <DecisionGlyph status={d.status} />
          <span className="scale whitespace-nowrap text-ink">{d.from_chat ? s.decision.fromFork : s.decision.card}</span>
        </span>
        <span
          className={cx(
            "flex items-center gap-2 text-cap",
            waiting ? "text-action-ink" : lamp === "live" ? "text-ink" : "text-ink-2",
          )}
        >
          <Lamp state={lamp} size={8} />
          {label}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-section leading-[1.3] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{d.title}</h3>
        <span className="text-cap text-ink-2">
          {displayName(d.created_by)} · {when(d.created_at)}
        </span>
      </div>

      {d.from_chat && forkTo ? (
        <Screen className="grid gap-x-4 gap-y-3 px-4 py-3.5 tab:grid-cols-2">
          <Readout
            small
            label={s.decision.source}
            value={
              <AppLink to={forkTo} className="no-underline">
                {fork?.title ?? d.from_chat}
              </AppLink>
            }
          />
          <Readout small label={s.decision.origin} value={<OriginValue fork={fork} known={known} now={now} />} />
        </Screen>
      ) : null}

      {d.text ? <Markdown text={d.text} className="text-key" /> : null}

      {d.source_messages.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="scale text-ink-2">{s.decision.sources}</span>
          <ul aria-label={s.decision.sourcesLabel} className="m-0 flex list-none flex-wrap gap-2 p-0">
            {d.source_messages.map((id) => {
              const ref = messageRef(known, id);
              const text = s.decision.sourceChip(
                ref.display ?? s.decision.sourceUnknown,
                ref.created_at ? when(ref.created_at) : null,
                ref.excerpt ? excerpt(ref.excerpt, 28) : null,
              );
              return (
                <li key={id} className="min-w-0">
                  {forkTo ? (
                    // Доказательства предложения живут в ветке Fork.
                    <AppLink to={forkTo} hash={id} className={CHIP}>
                      <span className="truncate">↗ {text}</span>
                    </AppLink>
                  ) : (
                    <a href={`#${id}`} className={CHIP}>
                      <span className="truncate">{text}</span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {d.supersedes ? (
        <p className="m-0 text-cap text-ink-2">
          {s.decision.replaces}{" "}
          <a href={`#${d.supersedes}`} className="font-semibold text-ink underline decoration-ink-3 underline-offset-2">
            {titleOf(d.supersedes) ?? d.supersedes}
          </a>
        </p>
      ) : null}

      {verbs.length > 0 || forkTo ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {forkTo ? (
            <KeyLink href={routeHref(forkTo)} onClick={(e) => followInApp(e, forkTo)}>
              {s.decision.openFork}
            </KeyLink>
          ) : null}
          {verbs.includes("accept") ? (
            <ActionKey onClick={() => void run("accept")} disabled={!!busy}>
              {busy === "accept" ? s.decision.busy : s.decision.accept}
            </ActionKey>
          ) : null}
          {verbs.includes("reject") ? (
            <Key onClick={() => void run("reject")} disabled={!!busy}>
              {busy === "reject" ? s.decision.busy : s.decision.reject}
            </Key>
          ) : null}
          {verbs.includes("reopen") ? (
            <Key onClick={() => void run("reopen")} disabled={!!busy}>
              {busy === "reopen" ? s.decision.busy : s.decision.reopen}
            </Key>
          ) : null}
          {verbs.includes("discuss") ? (
            <Key
              onClick={() => setDiscussing((o) => !o)}
              disabled={!!busy}
              aria-expanded={discussing}
              aria-controls={fieldId}
              className={discussing ? "pressed" : undefined}
            >
              {s.decision.discuss}
            </Key>
          ) : null}
        </div>
      ) : null}

      {discussing ? (
        <form ref={form} id={fieldId} onSubmit={sendComment} className="flex scroll-mb-4 flex-col gap-2.5">
          <label className="flex flex-col gap-[7px]">
            <span className="text-cap font-semibold">{s.decision.discussLabel}</span>
            <textarea
              rows={2}
              autoFocus
              value={comment}
              placeholder={s.decision.discussPlaceholder}
              onChange={(e) => setComment(e.target.value)}
              className={cx(SLOT, "resize-none py-2.5 text-key leading-[1.45]")}
            />
          </label>
          <div className="flex items-center gap-3">
            <Key type="submit" disabled={!comment.trim() || !!busy}>
              {busy === "discuss" ? s.decision.busy : s.decision.discussSend}
            </Key>
            <TextButton onClick={() => setDiscussing(false)}>{s.cancel}</TextButton>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-cap text-action-ink">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/** Исходная точка предложения — сообщение этого чата, от которого ответвился Fork. */
function OriginValue({ fork, known, now }: { fork: ForkRef | null; known: readonly TimelineItem[]; now: number }) {
  if (!fork) return <span className="text-ink-2">—</span>;
  const ref = messageRef(known, fork.message_id);
  const text = s.decision.originValue(
    ref.display,
    ref.created_at ? whenShort(ref.created_at, now) : null,
    ref.excerpt ? excerpt(ref.excerpt, 36) : null,
  );
  return (
    <a href={`#${fork.message_id}`} className="no-underline">
      {text}
    </a>
  );
}

/** Ромб решения — тот же знак, что в дереве: лампа внутри корпуса-ромба. */
export function DecisionGlyph({ status, size = 14 }: { status: Decision["status"]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-8.5 -8.5 17 17" aria-hidden="true" className="shrink-0 overflow-visible">
      <DecisionShape status={status} />
    </svg>
  );
}

/** Ромб для SVG дерева и легенды: зелёный — принято, оранжевое кольцо — ждёт, серый — нет. */
export function DecisionShape({ status }: { status: Decision["status"] }) {
  const lamp = decisionLamp(status);
  return (
    <rect
      x={-5}
      y={-5}
      width={10}
      height={10}
      rx={1.5}
      transform="rotate(45)"
      className={cx(
        lamp === "live" && "fill-pilot stroke-base",
        lamp === "act" && "fill-plate stroke-lamp",
        lamp === "off" && "fill-ink-3 stroke-base",
      )}
      strokeWidth={2}
    />
  );
}

// --- Предложения этого Fork родителю -------------------------------------------

/** Блок наверху ленты Fork: что ушло родителю и что там с ним решили. */
export function OutgoingProposals({
  outgoing,
  chat,
  now,
}: {
  outgoing: readonly Decision[];
  chat: ChatDetail;
  now: number;
}) {
  if (!chat.parent || outgoing.length === 0) return null;
  const parentId = chat.parent.chat_id;
  const titles = new Map(outgoing.map((d) => [d.id, d.title] as const));
  return (
    <Screen as="section" aria-label={s.info.proposals} className="mb-3 flex flex-col gap-3 px-4 py-3.5">
      {outgoing.map((d) => {
        const label =
          d.status === "proposed"
            ? s.decision.outgoingWaiting
            : statusLabel(d, { titleOf: (id) => titles.get(id) ?? null, when: (iso) => whenShort(iso, now) });
        return (
          <div key={d.id} className="flex flex-col gap-1">
            <span className={cx("flex items-center gap-2 text-cap", awaitsHuman(d.status) ? "text-action-ink" : "text-ink-2")}>
              <Lamp state={decisionLamp(d.status)} size={8} />
              {s.decision.outgoing(label)}
            </span>
            <AppLink
              to={chatRoute(chat.repo, parentId)}
              hash={d.id}
              className="text-key leading-snug font-semibold no-underline [overflow-wrap:anywhere]"
            >
              {d.title} <span className="font-normal text-ink-2">· {s.decision.openInParent} →</span>
            </AppLink>
          </div>
        );
      })}
    </Screen>
  );
}
