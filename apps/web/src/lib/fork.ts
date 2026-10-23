import {
  displayName,
  parseMessageId,
  type ForkRef,
  type ForkRequest,
  type MessageItem,
  type TimelineItem,
} from "@chat0110/chat-protocol";
import { excerpt } from "./text.ts";

// Fork из сообщения (docs/protocol.md, «Fork»): что предложить в форме, какое
// сообщение брать по умолчанию и где показать готовые ответвления.

export const FORK_TITLE_MAX = 120;
export const FORK_REASON_MAX = 500;
const PREFIX = "Fork: ";

/** «Fork: <название родителя>», не длиннее лимита названия чата. */
export function forkTitle(parentTitle: string, max: number = FORK_TITLE_MAX): string {
  const base = parentTitle.trim();
  const title = base.startsWith(PREFIX) ? base : PREFIX + base;
  const chars = Array.from(title);
  if (chars.length <= max) return title;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/** Fork из сообщения «не влито» нельзя: его ещё нет в ветке чата. */
export function canForkFrom(m: MessageItem): boolean {
  return !m.pending;
}

/** Клавиша «Fork» в шапке — от последнего влитого сообщения. */
export function lastForkable(items: readonly TimelineItem[]): MessageItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === "message" && canForkFrom(it)) return it;
  }
  return null;
}

export interface ForkForm {
  title: string;
  reason: string;
  first: string;
}

export function forkRequest(messageId: string, form: ForkForm): ForkRequest {
  const req: ForkRequest = { message_id: messageId, title: form.title.trim() };
  const reason = form.reason.trim();
  const first = form.first.trim();
  if (reason) req.reason = reason;
  if (first) req.first_message = first;
  return req;
}

const byCreated = (a: ForkRef, b: ForkRef) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.chat_id < b.chat_id ? -1 : 1;

/**
 * Чипы «↳ Fork» под сообщениями-точками. Fork от сообщения, которого нет в
 * загруженной ленте (например, комментарий удалён), — в хвост ленты.
 */
export function groupForks(
  forks: readonly ForkRef[],
  messageIds: Iterable<string>,
): { byMessage: Map<string, ForkRef[]>; rest: ForkRef[] } {
  const ids = new Set(messageIds);
  const byMessage = new Map<string, ForkRef[]>();
  const rest: ForkRef[] = [];
  for (const f of [...forks].sort(byCreated)) {
    if (!ids.has(f.message_id)) {
      rest.push(f);
      continue;
    }
    const list = byMessage.get(f.message_id) ?? [];
    list.push(f);
    byMessage.set(f.message_id, list);
  }
  return { byMessage, rest };
}

export interface MessageRef {
  display: string | null;
  created_at: string | null;
  excerpt: string | null;
}

/** Автор, время и начало сообщения-точки: из ленты, иначе хотя бы из id файла. */
export function messageRef(items: readonly TimelineItem[], id: string): MessageRef {
  const found = items.find((i): i is MessageItem => i.kind === "message" && i.id === id);
  if (found) return { display: found.display, created_at: found.created_at, excerpt: excerpt(found.text) };
  const parsed = parseMessageId(id);
  if (parsed) return { display: displayName(parsed.author), created_at: parsed.date, excerpt: null };
  return { display: null, created_at: null, excerpt: null };
}
