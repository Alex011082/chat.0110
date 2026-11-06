import {ParticipantsBar} from "./ParticipantsBar.tsx";
import type { MessageItem, TimelineResponse } from "@chat0110/chat-protocol";
import { useEffect,useMemo,useState, type ReactNode } from "react";
import { ApiFailure, errorText } from "../api.ts";
import { lastForkable } from "../lib/fork.ts";
import { chatRoute } from "../lib/route.ts";
import { plural } from "../lib/text.ts";
import { ago } from "../lib/time.ts";
import { countTimeline, type LocalEntry } from "../lib/timeline.ts";
import { forms, s } from "../strings.ts";
import { AppLink } from "../ui/AppLink.tsx";
import { Body, cx, Grille, Key, KeyLink, Lamp, Readout, RoundKey, Screen, type LampState } from "../ui/kit.tsx";
import { ChevronIcon, DotsIcon } from "../ui/icons.tsx";
import { Menu, type MenuItem } from "../ui/Menu.tsx";
import { Composer } from "./Composer.tsx";
import type { DecisionHandler } from "./DecisionCard.tsx";
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
  onLoadHistory?:()=>Promise<void>;
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
  onSend: (text: string, replyTo?: string) => void | Promise<boolean>;
  onRetry: (localId: string) => void;
  onAccept: (n: number) => Promise<void>;
  /** Название родителя для дочернего чата (из контекста или списка). */
  parentTitle: string | null;
  onFork: (m: MessageItem) => void;
  onDecide: (m: MessageItem) => void;
  onDecision: DecisionHandler;
  /** «Предложить родителю» — только у Fork. */
  onPropose: (() => void) | null;
  /** Светлый дизайн: тонкая шапка, участники и редкие действия за кнопками. */
  light?: boolean;
  settings?: ReactNode;
  /** Подтверждение приглашения или копирования ссылки. */
  onToast: (text: string) => void;
}

export function ChatView(p: ChatViewProps) {
  const { chat, items } = p.data;
  const counts = useMemo(() => countTimeline(items), [items]);
  const forkFrom = useMemo(() => lastForkable(items), [items]);
  const status = syncStatus(p.sync, p.now);
  const chatKey = `${chat.repo.toLowerCase()}/${chat.chat_id}`;
  const [mobilePanel,setMobilePanel]=useState<"privacy"|"tasks"|null>(null);
  useEffect(()=>setMobilePanel(null),[chatKey]);

  const timeline = (
    <Timeline
      compact={p.phone}
      hasMore={p.data.history?.has_more}
      checking={p.data.history?.checking}
      checkFailed={p.data.history?.check_failed}
      onLoadHistory={p.onLoadHistory}
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
      decisions={p.data.decisions ?? []}
      outgoing={p.data.outgoing ?? []}
      onDecide={p.data.chat_store === 2 ? null : p.onDecide}
      onDecision={p.onDecision}
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
      light={p.light && !p.phone}
      panel={mobilePanel}
      onClosePanel={()=>setMobilePanel(null)}
    />
  );

  // Светлая шапка: кружки участников, «+» — позвать агента или человека, «⋯» — редкое.
  const more: MenuItem[] = [
    ...(p.phone?[
      {kind:"button" as const,label:s.locale==="en"?"Data protection":"Защита данных",onClick:()=>setMobilePanel("privacy")},
      {kind:"button" as const,label:s.locale==="en"?"Tasks in this chat":"Задания в этом чате",onClick:()=>setMobilePanel("tasks")},
      {kind:"button" as const,label:s.locale==="en"?"Branches and decisions":"Ветвления и решения",onClick:p.onInfo},
      {kind:"link" as const,label:s.locale==="en"?"Connect AI":"Подключить ИИ",href:`/connect?repo=${encodeURIComponent(chat.repo)}&chat=${encodeURIComponent(chat.chat_id)}`,external:true},
    ]:[]),
    {
      kind: "button",
      label: s.header.fork,
      title: forkFrom ? s.header.forkHint : s.header.forkNoMessages,
      disabled: !forkFrom,
      onClick: () => forkFrom && p.onFork(forkFrom),
    },
    ...(p.onPropose ? [{ kind: "button" as const, label: s.header.propose, title: s.header.proposeHint, onClick: p.onPropose }] : []),
    { kind: "link", label: s.header.openInGitHub, href: chat.url, external: true },
    ...(p.phone&&p.settings?[{kind:"node" as const,node:p.settings}]:[]),
  ];
  const title = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <h1 title={chat.title} className={cx("m-0 leading-snug font-semibold tracking-[-0.01em]", p.phone ? "mobile-chat-title" : "truncate text-[23px]")}>{chat.title}</h1>
      <span className="flex min-w-0 items-center gap-1.5 text-cap text-ink-2" aria-live="polite">
        <Lamp state={status.lamp} size={8} ring={false} />
        <span className="truncate">{status.lamp === "act" ? status.text : s.header.phoneStatus(chat.number, p.phone ? (status.online ? s.header.phoneOnline : s.header.phoneOffline) : status.text)}</span>
      </span>
    </div>
  );
  const controls = <>
    <ParticipantsBar chat={chat} limit={p.phone ? 3 : p.infoKnob ? 2 : 4} store={p.data.chat_store} phone={p.phone} onToast={p.onToast}/>
    <button type="button" className="chat-details-button" onClick={p.onInfo} aria-expanded={p.infoOpen}>{s.info.label}</button>
    <Menu label={s.design.more} trigger={<DotsIcon />} items={more} />
  </>;
  const lightHeader = (
    <header className={cx("light-chat-header", p.phone && "mobile-chat-header")}>
      {p.phone ? <>
        <div className="flex w-full items-center gap-2">
          <button type="button" aria-label={s.header.back} onClick={p.onBack} className="settings-trigger shrink-0"><ChevronIcon left size={22}/></button>
          {title}<Menu phone label={s.locale==="en"?"Chat actions":"Действия чата"} trigger={<DotsIcon/>} items={more}/>
        </div>
        <div className="flex w-full items-center gap-2"><ParticipantsBar chat={chat} limit={3} store={p.data.chat_store} phone onToast={p.onToast}/></div>
      </> : <>{title}{controls}</>}
    </header>
  );

  if (p.phone) {
    return (
      <div className="mobile-chat flex h-dvh flex-col bg-body">
        {lightHeader}
        {timeline}
        {composer}
      </div>
    );
  }

  if (p.light) {
    return (
      <>
        {lightHeader}
        {timeline}
        {composer}
      </>
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
          <div className="flex flex-wrap items-center justify-end gap-x-[18px] gap-y-2.5">
            <Grille width={86} height={36} className={cx("hidden", p.onPropose ? "min-[1440px]:block" : "desk:block", "short:hidden")} />
            <Key
              onClick={() => forkFrom && p.onFork(forkFrom)}
              disabled={!forkFrom}
              title={forkFrom ? s.header.forkHint : s.header.forkNoMessages}
            >
              {s.header.fork}
            </Key>
            {p.onPropose ? (
              <Key onClick={p.onPropose} title={s.header.proposeHint}>
                {s.header.propose}
              </Key>
            ) : null}
            <KeyLink href={chat.url} target="_blank" rel="noopener noreferrer">
              {s.header.openInGitHub}
            </KeyLink>
            {p.infoKnob ? (
              <RoundKey aria-label={s.header.infoKnob} aria-expanded={p.infoOpen} onClick={p.onInfo} />
            ) : null}
          </div>
        </div>
        {/* На низком окне плашку прячем: ветка и PR есть в «О чате», а высота
            нужна ленте. */}
        <Screen
          className={cx(
            "grid gap-3.5 px-[18px] py-3.5 short:hidden",
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
        {text ? <p className="m-0 text-copy text-ink-2">{text}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </Body>
    </div>
  );
}
