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
  onSend: (text: string, replyTo?: string) => void;
  phone: boolean;
  /** Растёт, когда нажали «Ответить», — повод поставить курсор в поле. */
  focusTick: number;
}

export function Composer(p: ComposerProps) {
  const [text, setText] = useState(() => drafts.get(p.chatKey) ?? "");
  const area = useRef<HTMLTextAreaElement>(null);

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

  const submit = () => {
    const value = text.trim();
    if (!value || !p.canPush) return;
    p.onSend(value, p.reply?.id);
    update("");
    p.onClearReply();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
        disabled={!p.canPush}
        placeholder={s.composer.placeholder}
        onChange={(e) => update(e.target.value)}
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
        {!p.canPush ? <p className="m-0 px-1 text-cap text-ink-2">{s.composer.readOnly}</p> : null}
        <div className="flex items-end gap-2.5">
          {field}
          <ActionRound type="submit" aria-label={s.composer.send} disabled={!p.canPush} />
        </div>
      </form>
    );
  }

  return (
    <Body as="form" onSubmit={onSubmit} className="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-6 short:gap-2.5 short:pt-3 short:pb-5">
      {replyChip}
      {field}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="px-1 text-cap text-ink-2">{p.canPush ? s.composer.hint(p.branch) : s.composer.readOnly}</span>
        <ActionKey type="submit" disabled={!p.canPush}>
          {s.composer.send}
        </ActionKey>
      </div>
    </Body>
  );
}
