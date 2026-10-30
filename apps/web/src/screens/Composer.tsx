import { PrivacyPanel } from "./PrivacyPanel.tsx";
import { mentionRoute, resolveMention, suggestMentions, type DispatchView } from "@chat0110/chat-protocol";
import { dispatchRequest, dispatchText } from "../dispatch.ts";
import type { MessageItem } from "@chat0110/chat-protocol";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { excerpt } from "../lib/text.ts";
import { s } from "../strings.ts";
import { ActionKey, ActionRound, Body, cx, SLOT } from "../ui/kit.tsx";

// Черновики живут, пока открыта вкладка: переход в другой чат их не теряет.
const drafts = new Map<string, string>();

interface ComposerProps {
  chatKey: string;
  branch: string;
  canPush: boolean;
  reply: MessageItem | null;
  onClearReply: () => void;
  onSend: (text: string, replyTo?: string) => void | Promise<boolean>;
  phone: boolean;
  /** Растёт, когда нажали «Ответить», — повод поставить курсор в поле. */
  focusTick: number;
}

export function Composer(p: ComposerProps) {
  const [sending, setSending] = useState(false);
  const [text, setText] = useState(() => drafts.get(p.chatKey) ?? "");
  const area = useRef<HTMLTextAreaElement>(null);
  const [dispatch, setDispatch] = useState<DispatchView | null>(null);
  const [dispatchError, setDispatchError] = useState(false);
  const [stopError, setStopError] = useState(false);
  const [cursor, setCursor] = useState(text.length);
  const [selected, setSelected] = useState(0);
  const d = dispatchText(s.locale === "en");
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      dispatchRequest(p.chatKey).then(
        (value) => {
          if (alive) {
            setDispatch(value);
            setDispatchError(false);
          }
        },
        () => {
          if (alive) setDispatchError(true);
        },
      );
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [p.chatKey]);
  let route: string[] = [];
  let routingError = "";
  try {
    route = mentionRoute(text);
  } catch {
    routingError = d.invalid;
  }
  if (route.length && (dispatchError || !dispatch)) routingError = d.unavailable;
  let resolved: string[] = [];
  if (dispatch && !routingError) {
    try {
      resolved = route.map((alias) => resolveMention(alias, dispatch.sessions));
    } catch (e) {
      routingError = e instanceof Error && e.message === "ambiguous" ? d.ambiguous : d.unknown;
    }
    if (resolved.length > 1 && resolved[0] === resolved[1]) routingError = d.invalid;
  }
  const fragment = text.slice(0, cursor).match(/(?:^|\s)(@{1,2})([\p{L}\p{N}_-]*)$/u);
  const options = fragment
    ? (dispatch?.sessions ?? []).filter((session) =>
        suggestMentions(fragment[2]!, dispatch?.sessions ?? []).includes(session.id),
      )
    : [];
  const pick = (alias: string) => {
    if (!fragment) return;
    const start = cursor - fragment[1]!.length - fragment[2]!.length;
    const replacement = `${fragment[1]}${alias} `;
    update(text.slice(0, start) + replacement + text.slice(cursor));
    const next = start + replacement.length;
    setCursor(next);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next, next);
    });
  };
  const checkingHint = sending && text.length > 8000 ? <p role="status" className="m-0 text-cap text-ink-2">{s.locale === "en" ? "Checking a large text locally. This can take up to two minutes." : "Большой текст проверяется локально. Это может занять до двух минут."}</p> : null;
  const routePanel = (
    <div id="mention-help" className="flex flex-col gap-1.5 text-cap text-ink-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{d.help}</span>
        <a
          href={`/connect?repo=${encodeURIComponent(p.chatKey.split("/").slice(0, 2).join("/"))}&chat=${encodeURIComponent(p.chatKey.split("/")[2] ?? "")}`}
          target="_blank"
          rel="noreferrer"
          className="text-action-ink"
        >
          {d.connect} ↗
        </a>
      </div>
      {options.length > 0 ? (
        <div
          id="mention-options"
          role="listbox"
          aria-label={d.title}
          className="max-h-36 overflow-y-auto rounded-slot bg-slot p-1"
        >
          {options.map((session, index) => (
            <button
              type="button"
              key={session.id}
              role="option"
              aria-selected={selected === index}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(session.alias)}
              className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border-0 px-3 text-left text-cap ${selected === index ? "bg-plate text-ink" : "bg-transparent text-ink-2"}`}
            >
              <span>
                @{session.alias} · {session.name}
              </span>
              <span>{session.online ? d.online : d.offline}</span>
            </button>
          ))}
        </div>
      ) : null}
      {route.length > 0 &&
      !routingError &&
      resolved.some((id) => !dispatch?.sessions.find((session) => session.id === id)?.online) ? (
        <span>
          {s.locale === "en"
            ? "The message will be saved and wait for the participant to connect."
            : "Сообщение сохранится и будет ждать подключения участника."}
        </span>
      ) : null}
      {routingError ? (
        <span role="alert" className="text-action-ink">
          {routingError}
        </span>
      ) : route.length ? (
        <span>
          {d.route}:{" "}
          {route
            .map(
              (alias, index) =>
                `${dispatch?.sessions.find((session) => session.id === resolved[index])?.name ?? alias}${index === 2 ? ` (${d.final})` : ""}`,
            )
            .join(" → ")}{" "}
          → ■
        </span>
      ) : null}
      {dispatch && !dispatch.sessions.length ? <span>{d.empty}</span> : null}
      {(dispatch?.chains ?? [])
        .filter((c) => !["done", "cancelled"].includes(c.status))
        .slice(0, 5)
        .map((chain) => (
          <div key={chain.id} className="flex items-center justify-between gap-2">
            <span>
              {chain.route
                .map((id) => dispatch?.sessions.find((session) => session.id === id)?.name ?? "?")
                .join(" → ")}{" "}
              · {Math.min(chain.step + 1, chain.route.length)}/{chain.route.length} · {d.status[chain.status]}
            </span>
            {!["expired", "needs_owner"].includes(chain.status) ? <button
              type="button"
              disabled={!p.canPush || sending}
              className="min-h-9 shrink-0 border-0 bg-transparent text-action-ink"
              onClick={() => void dispatchRequest(p.chatKey, chain.id).then(setDispatch, () => setStopError(true))}
            >
              {d.stop}
            </button> : null}
          </div>
        ))}
      {stopError ? <span role="alert">{d.failed}</span> : null}
    </div>
  );

  // Фокус — только на новое «Ответить», не при открытии чата: на телефоне
  // иначе всплывала бы клавиатура.
  const seenTick = useRef(p.focusTick);
  useEffect(() => {
    if (p.focusTick === seenTick.current) return;
    seenTick.current = p.focusTick;
    area.current?.focus();
  }, [p.focusTick]);

  // На телефоне поле растёт вместе с текстом, но не выше 160px.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !p.phone) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, p.phone]);

  const update = (value: string) => {
    setText(value);
    if (value) drafts.set(p.chatKey, value);
    else drafts.delete(p.chatKey);
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || !p.canPush || routingError || sending) return;
    setSending(true);
    try {
      const sent = await p.onSend(value, p.reply?.id);
      if (sent !== false) { update(""); p.onClearReply(); }
    } finally { setSending(false); }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "ArrowDown") setSelected((i) => (i + 1) % options.length);
      else if (e.key === "ArrowUp") setSelected((i) => (i - 1 + options.length) % options.length);
      else pick(options[Math.min(selected, options.length - 1)]!.alias);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const replyChip = p.reply ? (
    <div className="flex items-center justify-between gap-2 px-1 text-cap text-ink-2">
      <span className="min-w-0 truncate">{s.composer.replyChip(p.reply.display, excerpt(p.reply.text, 32))}</span>
      <button
        type="button"
        aria-label={s.composer.removeReply}
        onClick={p.onClearReply}
        className="size-8 shrink-0 rounded-full border-0 bg-transparent text-[18px] text-ink-2 hover:text-action-ink"
      >
        ×
      </button>
    </div>
  ) : null;

  const field = (
    <label className="flex min-w-0 flex-1">
      <span className="sr-only-text">{s.composer.label}</span>
      <textarea
        ref={area}
        rows={p.phone ? 1 : 3}
        value={text}
        disabled={!p.canPush || sending}
        placeholder={s.composer.placeholder}
        onChange={(e) => {
          update(e.target.value);
          setCursor(e.target.selectionStart);
          setSelected(0);
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
        aria-describedby="mention-help"
        aria-controls={options.length ? "mention-options" : undefined}
        onKeyDown={onKeyDown}
        className={cx(SLOT, "resize-none py-3 text-copy", p.phone ? "py-[11px]" : "short:h-[68px]")}
      />
    </label>
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  if (p.phone) {
    return (
      <form
        onSubmit={onSubmit}
        className="flex shrink-0 flex-col gap-2 border-t border-line bg-rail px-3.5 pt-3.5 pb-[max(18px,env(safe-area-inset-bottom))]"
      >
        {replyChip}
        {routePanel}
        {checkingHint}
        <PrivacyPanel chatKey={p.chatKey} text={text} onApply={update} />
        {!p.canPush ? <p className="m-0 px-1 text-cap text-ink-2">{s.composer.readOnly}</p> : null}
        <div className="flex items-end gap-2.5">
          {field}
          <ActionRound type="submit" aria-label={s.composer.send} disabled={!p.canPush || !!routingError || sending} />
        </div>
      </form>
    );
  }

  return (
    <Body
      as="form"
      onSubmit={onSubmit}
      className="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-6 short:gap-2.5 short:pt-3 short:pb-5"
    >
      {replyChip}
      {routePanel}
      {checkingHint}
      {field}
      <PrivacyPanel chatKey={p.chatKey} text={text} onApply={update} />
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="px-1 text-cap text-ink-2">{p.canPush ? s.composer.hint(p.branch) : s.composer.readOnly}</span>
        <ActionKey type="submit" disabled={!p.canPush || !!routingError || sending}>
          {sending ? (s.locale === "en" ? "Checking…" : "Проверяем…") : s.composer.send}
        </ActionKey>
      </div>
    </Body>
  );
}
