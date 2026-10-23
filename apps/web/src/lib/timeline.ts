import {
  displayName,
  parseMessageId,
  type AgentPrItem,
  type MessageItem,
  type TimelineItem,
} from "@chat0110/chat-protocol";
import { s } from "../strings.ts";
import { excerpt } from "./text.ts";

// --- Цитата ответа -----------------------------------------------------------

export interface ReplyRef {
  display: string;
  excerpt: string | null;
}

/**
 * На что отвечает сообщение. Ищем в загруженной ленте; если сообщения там нет,
 * автор всё равно виден из id файла — цитаты не будет, имя будет.
 */
export function resolveReply(items: readonly TimelineItem[], replyTo: string): ReplyRef | null {
  const found = items.find((i): i is MessageItem => i.kind === "message" && i.id === replyTo);
  if (found) return { display: found.display, excerpt: excerpt(found.text) };
  const parsed = parseMessageId(replyTo);
  return parsed ? { display: displayName(parsed.author), excerpt: null } : null;
}

export function replyLine(ref: ReplyRef): string {
  return s.timeline.replyTo(ref.display, ref.excerpt);
}

// --- Отправка без ожидания сервера -------------------------------------------

export type LocalStatus = "sending" | "error" | "published";

/** Сообщение, отправленное из этой вкладки. Живёт, пока вкладка открыта. */
export interface LocalEntry {
  localId: string;
  text: string;
  reply_to?: string;
  created_at: string;
  status: LocalStatus;
  error?: string;
  /** Ответ сервера — есть, когда status === "published". */
  item?: MessageItem;
}

export type ViewItem =
  | { kind: "item"; item: TimelineItem; published: boolean }
  | { kind: "local"; entry: LocalEntry };

/**
 * Лента для показа: серверная + своё. Опубликованное, которого сервер ещё не
 * вернул, встаёт на своё место по времени; когда сервер его вернул — без
 * повтора, но с лампой «опубликовано». Отправляемое и упавшее — в конце.
 */
export function mergeTimeline(server: readonly TimelineItem[], local: readonly LocalEntry[]): ViewItem[] {
  const publishedIds = new Set<string>();
  const extra: MessageItem[] = [];
  const serverIds = new Set(server.map((i) => i.id));
  for (const e of local) {
    if (e.status !== "published" || !e.item) continue;
    publishedIds.add(e.item.id);
    if (!serverIds.has(e.item.id)) extra.push(e.item);
  }

  const view: ViewItem[] = server.map((item) => ({ kind: "item", item, published: publishedIds.has(item.id) }));
  for (const item of extra) {
    let at = view.length;
    while (at > 0) {
      const prev = view[at - 1]!;
      if (prev.kind === "item" && prev.item.created_at <= item.created_at) break;
      at--;
    }
    view.splice(at, 0, { kind: "item", item, published: true });
  }
  for (const e of local) {
    if (e.status !== "published") view.push({ kind: "local", entry: e });
  }
  return view;
}

// --- Раскладка в блоки --------------------------------------------------------

export type Block =
  | { type: "item"; item: TimelineItem; published: boolean }
  | { type: "agentPr"; item: AgentPrItem; pending: MessageItem[] }
  | { type: "local"; entry: LocalEntry };

/** Сообщения «не влито» показываются внутри карточки своего PR агента. */
export function layoutTimeline(view: readonly ViewItem[]): Block[] {
  const openCards = new Map<number, AgentPrItem>();
  for (const v of view) {
    if (v.kind === "item" && v.item.kind === "agent_pr" && v.item.state === "open") openCards.set(v.item.number, v.item);
  }
  const cardOf = (m: MessageItem): number | null => {
    if (!m.pending) return null;
    if (m.agent_pr != null && openCards.has(m.agent_pr)) return m.agent_pr;
    for (const card of openCards.values()) if (card.message_ids.includes(m.id)) return card.number;
    return null;
  };

  const pendingByCard = new Map<number, MessageItem[]>();
  for (const v of view) {
    if (v.kind !== "item" || v.item.kind !== "message") continue;
    const n = cardOf(v.item);
    if (n == null) continue;
    const list = pendingByCard.get(n) ?? [];
    list.push(v.item);
    pendingByCard.set(n, list);
  }

  const blocks: Block[] = [];
  for (const v of view) {
    if (v.kind === "local") {
      blocks.push({ type: "local", entry: v.entry });
    } else if (v.item.kind === "agent_pr") {
      blocks.push({ type: "agentPr", item: v.item, pending: pendingByCard.get(v.item.number) ?? [] });
    } else if (v.item.kind === "message" && cardOf(v.item) != null) {
      continue;
    } else {
      blocks.push({ type: "item", item: v.item, published: v.published });
    }
  }
  return blocks;
}

export function blockTime(b: Block): string {
  return b.type === "local" ? b.entry.created_at : b.item.created_at;
}

export function blockKey(b: Block): string {
  return b.type === "local" ? `local:${b.entry.localId}` : b.item.id;
}

// --- Цифры для шкал -----------------------------------------------------------

export interface TimelineCounts {
  messages: number;
  inBranch: number;
  comments: number;
  reviews: number;
}

export function countTimeline(items: readonly TimelineItem[]): TimelineCounts {
  const c: TimelineCounts = { messages: 0, inBranch: 0, comments: 0, reviews: 0 };
  for (const i of items) {
    if (i.kind === "review") c.reviews++;
    if (i.kind !== "message" || i.pending) continue;
    c.messages++;
    if (i.source === "file") c.inBranch++;
    else if (i.source === "comment") c.comments++;
  }
  return c;
}
