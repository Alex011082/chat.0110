import type { ChatSummary, ChatUpdatedEvent } from "@chat0110/chat-protocol";
import { s } from "../strings.ts";

function norm(text: string): string {
  return text.toLocaleLowerCase("ru").replaceAll("ё", "е").trim();
}

const byUpdatedDesc = (a: ChatSummary, b: ChatSummary) =>
  a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;

/** Список чатов: поиск по названию, свежие сверху, закрытые — в архив. */
export function arrangeChats(
  chats: readonly ChatSummary[],
  query: string,
): { open: ChatSummary[]; archived: ChatSummary[] } {
  const q = norm(query);
  const found = q ? chats.filter((c) => norm(c.title).includes(q)) : [...chats];
  found.sort(byUpdatedDesc);
  return {
    open: found.filter((c) => c.state === "open"),
    archived: found.filter((c) => c.state !== "open"),
  };
}

/** Фраза, которую Саша отправляет Claude или Codex в их приложении. */
export function agentLinkPhrase(url: string): string {
  return s.info.agentPhrase(url);
}

export interface OpenChatRef {
  repo: string;
  chat_id: string;
  number: number;
}

/**
 * Будит ли событие открытую ленту. Вебхук не всегда знает chat_id (например,
 * комментарий к PR агента), поэтому без chat_id перечитываем на всякий случай:
 * лишний запрос дешевле пропущенного сообщения.
 */
export function eventMatchesChat(ev: ChatUpdatedEvent, chat: OpenChatRef): boolean {
  if (ev.repo.toLowerCase() !== chat.repo.toLowerCase()) return false;
  // Номер PR без chat_id может быть и PR агента в ветку чата — его номер
  // с номером чата не совпадёт, поэтому номер тут ничего не отсекает.
  return ev.chat_id ? ev.chat_id === chat.chat_id : true;
}

/** Пауза перед повторным подключением SSE: 1, 2, 4 … 60 с. */
export function backoffDelay(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
}
