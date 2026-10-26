import type { ChatSummary, ChatUpdatedEvent } from "@chat0110/chat-protocol";
import { s } from "../strings.ts";
import { forkParents } from "./forest.ts";

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

export interface ChatTreeNode {
  chat: ChatSummary;
  /** Отступ в списке: 0 — корень, не больше maxDepth. */
  depth: number;
  children: ChatTreeNode[];
  /** Название родителя, если он есть в списке, — для экранного диктора. */
  parentTitle: string | null;
}

const openFirst = (a: ChatSummary, b: ChatSummary) =>
  (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) ||
  byUpdatedDesc(a, b) ||
  (a.chat_id < b.chat_id ? -1 : a.chat_id > b.chat_id ? 1 : 0);

/**
 * Список с иерархией Fork — доступная замена графического дерева (п. 22
 * спеки). Дети — под родителем, открытые первыми; глубже maxDepth отступ не
 * растёт: потомки идут следом тем же отступом. Дерево, где открыт хоть один
 * чат, — среди открытых; целиком закрытое — в архиве. Поиск — плоский.
 */
export function arrangeChatTree(
  chats: readonly ChatSummary[],
  query: string,
  maxDepth = 3,
): { open: ChatTreeNode[]; archived: ChatTreeNode[] } {
  const parentOf = forkParents(chats);
  const byId = new Map(chats.map((c) => [c.chat_id, c] as const));
  const parentTitle = (c: ChatSummary) => {
    const p = parentOf.get(c.chat_id);
    return p ? (byId.get(p)?.title ?? null) : null;
  };

  if (norm(query)) {
    const { open, archived } = arrangeChats(chats, query);
    const leaf = (c: ChatSummary): ChatTreeNode => ({ chat: c, depth: 0, children: [], parentTitle: parentTitle(c) });
    return { open: open.map(leaf), archived: archived.map(leaf) };
  }

  const kids = new Map<string, ChatSummary[]>();
  for (const c of chats) {
    const p = parentOf.get(c.chat_id);
    if (p === undefined) continue;
    const list = kids.get(p) ?? [];
    list.push(c);
    kids.set(p, list);
  }
  for (const list of kids.values()) list.sort(openFirst);

  const descendants = (c: ChatSummary): ChatSummary[] =>
    (kids.get(c.chat_id) ?? []).flatMap((k) => [k, ...descendants(k)]);

  const build = (c: ChatSummary, depth: number): ChatTreeNode[] => {
    const node: ChatTreeNode = { chat: c, depth, children: [], parentTitle: parentTitle(c) };
    if (depth < maxDepth) {
      node.children = (kids.get(c.chat_id) ?? []).flatMap((k) => build(k, depth + 1));
      return [node];
    }
    return [node, ...descendants(c).map((d) => ({ chat: d, depth, children: [], parentTitle: parentTitle(d) }))];
  };

  const roots = chats.filter((c) => !parentOf.has(c.chat_id)).sort(openFirst);
  const open: ChatTreeNode[] = [];
  const archived: ChatTreeNode[] = [];
  for (const r of roots) {
    const alive = r.state === "open" || descendants(r).some((d) => d.state === "open");
    (alive ? open : archived).push(...build(r, 0));
  }
  return { open, archived };
}

/** Фраза, которую Саша отправляет Claude или Codex в их приложении. */
export function agentLinkPhrase(url: string, store?: 1 | 2): string {
  return s.info.agentPhrase(url, store);
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
