import type { MessageItem, TimelineResponse } from "@chat0110/chat-protocol";
import { useMemo, type ReactNode } from "react";
import { ApiFailure, errorText } from "../api.ts";
import { lastForkable } from "../lib/fork.ts";
import { chatRoute } from "../lib/route.ts";
import { plural } from "../lib/text.ts";
import { ago } from "../lib/time.ts";
import { countTimeline, type LocalEntry } from "../lib/timeline.ts";
import { forms, s } from "../strings.ts";
import { AppLink } from "../ui/AppLink.tsx";
import { Body, cx, Grille, Key, KeyLink, Lamp, Readout, RoundKey, Screen, type LampState } from "../ui/kit.tsx";
import { Composer } from "./Composer.tsx";
import { Timeline } from "./Timeline.tsx";

export interface SyncState {
  syncedAt: number | null;
  error: ApiFailure | null;
}

/** Лампа и подпись «на связи · синхронизировано …» по итогу последнего запроса. */
export function syncStatus(st: SyncState, now: number): { lamp: LampState; text: string; online: boolean } {
  const when = st.syncedAt ? ago(new Date(st.syncedAt).toISOString(), now) : null;
  if (st.error?.code === "rate_limited") return { lamp: "act", text: errorText(st.error), online: false };
  if (st.error) return { lamp: "off", text: when ? s.header.offline(when) : errorText(st.error), online: false };
  if (!when) return { lamp: "off", text: s.header.connecting, online: false };
  return { lamp: "live", text: s.header.online(when), online: true };
}

interface ChatViewProps {
  data: TimelineResponse;
  sync: SyncState;
  local: LocalEntry[];
  me: { login: string; display: string };
  now: number;
  phone: boolean;
  /** На планшете у шапки есть ручка «О чате»: правая колонка спрятана. */
  infoKnob: boolean;
  infoOpen: boolean;
  onInfo: () => void;
  onBack: () => void;
  path: string;
  reply: MessageItem | null;
  focusTick: number;
  onReply: (m: MessageItem) => void;
  onClearReply: () => void;
  onSend: (text: string, replyTo?: string) => void;
  onRetry: (localId: string) => void;
  onAccept: (n: number) => Promise<void>;
  /** Название родителя для дочернего чата (из контекста или списка). */
  parentTitle: string | null;
  onFork: (m: MessageItem) => void;
}

export function ChatView(p: ChatViewProps) {
  const { chat, items } = p.data;
  const counts = useMemo(() => countTimeline(items), [items]);
  const forkFrom = useMemo(() => lastForkable(items), [items]);
  const status = syncStatus(p.sync, p.now);
  const chatKey = `${chat.repo.toLowerCase()}/${chat.chat_id}`;

  const timeline = (
    <Timeline
      chat={chat}
      items={items}
      local={p.local}
      me={p.me}
      now={p.now}
      path={p.path}
      onReply={p.onReply}
      onRetry={p.onRetry}
      onAccept={p.onAccept}
      forks={p.data.forks}
      inherited={p.data.inherited}
      parentTitle={p.parentTitle}
      onFork={p.onFork}
    />
  );
  const composer = (
    <Composer
      key={chatKey}
      chatKey={chatKey}
      branch={chat.branch}
      canPush={chat.can_push}
      reply={p.reply}
      onClearReply={p.onClearReply}
      onSend={p.onSend}
      phone={p.phone}
      focusTick={p.focusTick}
    />
  );

  if (p.phone) {
    return (
      <div className="flex h-dvh flex-col bg-ground">
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-3.5 pt-3.5 pb-3.5">
          <Body as="header" className="flex items-center gap-2.5 px-3 pt-3 pb-[18px] plinth-7">
            <RoundKey glyph="‹" aria-label={s.header.back} onClick={p.onBack} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="m-0 truncate text-section font-semibold tracking-[-0.01em]">{chat.title}</h1>
              <span className="flex items-center gap-[7px] text-cap text-ink-2">
                <Lamp state={status.lamp} size={8} />
                <span className="truncate">
                  {status.lamp === "act"
                    ? status.text
                    : s.header.phoneStatus(chat.number, status.online ? s.header.phoneOnline : s.header.phoneOffline)}
                </span>
              </span>
            </div>
            <RoundKey aria-label={s.header.infoKnob} aria-expanded={p.infoOpen} onClick={p.onInfo} />
          </Body>
          {timeline}
        </div>
        {composer}
      </div>
    );
  }

  return (
    <>
      <Body
        as="header"
        className="flex shrink-0 flex-col gap-3.5 rounded-device px-[22px] pt-5 pb-7 plinth-10 short:gap-3 short:pt-4 short:pb-6 desk:gap-[18px] desk:px-[26px] desk:pt-6 desk:pb-[34px] desk:short:gap-3 desk:short:pt-4 desk:short:pb-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-[22px] gap-y-3.5">
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="flex items-center gap-2 text-cap text-ink-2" aria-live="polite">
              <Lamp state={status.lamp} />
              {status.text}
            </span>
            <h1 className="m-0 text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] [overflow-wrap:anywhere] desk:text-title desk:short:text-[24px]">
              {chat.title}
            </h1>
          </div>
          <div className="flex items-center gap-[18px]">
            <Grille width={86} height={36} className="hidden desk:block" />
            <Key
              onClick={() => forkFrom && p.onFork(forkFrom)}
              disabled={!forkFrom}
              title={forkFrom ? s.header.forkHint : s.header.forkNoMessages}
            >
              {s.header.fork}
            </Key>
            <KeyLink href={chat.url} target="_blank" rel="noopener noreferrer">
              {s.header.openInGitHub}
            </KeyLink>
            {p.infoKnob ? (
              <RoundKey aria-label={s.header.infoKnob} aria-expanded={p.infoOpen} onClick={p.onInfo} />
            ) : null}
          </div>
        </div>
        <Screen
          className={cx(
            "grid gap-3.5 px-[18px] py-3.5",
            chat.parent ? "grid-cols-2 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)]" : "grid-cols-3",
          )}
        >
          {chat.parent ? (
            <Readout
              label={s.header.parent}
              value={
                <AppLink
                  to={chatRoute(chat.repo, chat.parent.chat_id)}
                  hash={chat.parent.message_id}
                  className="no-underline [overflow-wrap:anywhere]"
                >
                  {p.parentTitle ?? chat.parent.chat_id}
                </AppLink>
              }
            />
          ) : null}
          <Readout label={s.header.branch} value={chat.branch} />
          <Readout label={s.header.pullRequest} value={s.header.prValue(chat.number, chat.draft, chat.state === "closed")} />
          <Readout
            label={s.header.messages}
            value={`${counts.messages} · ${plural(chat.participants.length, forms.participants)}`}
          />
        </Screen>
      </Body>
      {timeline}
      {composer}
    </>
  );
}

/** Шапка-заглушка, пока лента грузится или если её нет. */
export function MainPlaceholder({
  title,
  text,
  phone,
  onBack,
  action,
}: {
  title: string;
  text?: string | undefined;
  phone: boolean;
  onBack?: (() => void) | undefined;
  action?: ReactNode;
}) {
  return (
    <div className={cx("flex flex-col gap-[22px]", phone && "px-3.5 pt-3.5")}>
      <Body
        as="header"
        className={cx("flex flex-col gap-3 rounded-device plinth-10", phone ? "px-4 pt-4 pb-6" : "px-[26px] pt-6 pb-[34px]")}
      >
        {onBack ? <RoundKey glyph="‹" aria-label={s.header.back} onClick={onBack} /> : null}
        <h1 className={cx("m-0 font-semibold", phone ? "text-section" : "text-title tracking-[-0.03em]")}>{title}</h1>
        {text ? <p className="m-0 max-w-[52ch] text-copy text-ink-2">{text}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </Body>
    </div>
  );
}
