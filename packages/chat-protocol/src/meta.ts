import { isAuthor, isChatId, parseMessageId, type ChatStore } from "./ids.ts";
import { validIso } from "./message-file.ts";

// Машинные метаданные живут в HTML-комментарии: на GitHub они невидимы,
// а текст для человека остаётся читаемым прямо в PR (п. 5.1 спеки).
const BLOCK_RE = /<!--\s*chat0110\s*\n([\s\S]*?)-->/;

function readBlock(body: string): Record<string, string> | null {
  const m = body.match(BLOCK_RE);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-z_]+):\s*(.*?)\s*$/);
    if (kv) fields[kv[1]!] = kv[2]!;
  }
  return fields;
}

export interface CommentMeta {
  id?: string;
  author?: string;
  reply_to?: string;
}

export function parseCommentMeta(body: string): { text: string; meta: CommentMeta } {
  const fields = readBlock(body) ?? {};
  const meta: CommentMeta = {};
  if (fields.id && parseMessageId(fields.id)) meta.id = fields.id;
  if (fields.author && isAuthor(fields.author)) meta.author = fields.author;
  if (fields.reply_to && parseMessageId(fields.reply_to)) meta.reply_to = fields.reply_to;
  return { text: body.replace(BLOCK_RE, "").trim(), meta };
}

export function withCommentMeta(text: string, meta: CommentMeta): string {
  const lines = Object.entries(meta)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return `${text.trimEnd()}\n\n<!-- chat0110\n${lines.join("\n")}\n-->\n`;
}

export interface ForkPoint {
  chat_id: string;
  message_id: string;
  commit_sha: string;
}

export interface PrMeta {
  chat_id: string;
  schema_version: number;
  parent?: ForkPoint;
}

const SHA_RE = /^[0-9a-f]{7,40}$/;
const FORK_MESSAGE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function validForkPoint(chatId: unknown, messageId: unknown, sha: unknown): ForkPoint | null {
  if (typeof chatId !== "string" || !isChatId(chatId)) return null;
  if (typeof messageId !== "string" || !FORK_MESSAGE_RE.test(messageId)) return null;
  if (typeof sha !== "string" || !SHA_RE.test(sha)) return null;
  return { chat_id: chatId, message_id: messageId, commit_sha: sha };
}

export function parsePrBody(body: string | null | undefined): PrMeta | null {
  const fields = body ? readBlock(body) : null;
  if (!fields?.chat_id || !isChatId(fields.chat_id)) return null;
  const meta: PrMeta = { chat_id: fields.chat_id, schema_version: Number(fields.schema_version) || 1 };
  // Родитель дублируется в теле PR, чтобы дерево строилось из одного списка PR,
  // без чтения chat.json каждой ветки. Источник истины — chat.json.
  const parent = validForkPoint(fields.parent_chat_id, fields.parent_message_id, fields.fork_commit_sha);
  if (parent) meta.parent = parent;
  return meta;
}

export function buildPrBody({
  chatId,
  intro,
  parent,
  store = 1,
}: {
  chatId: string;
  intro?: string;
  parent?: ForkPoint;
  store?: ChatStore;
}): string {
  const agents = store === 2 ? "Chat/AGENTS.md" : "chats/AGENTS.md";
  const messages = store === 2 ? `Chat/conversations/${chatId}/messages/` : `chats/${chatId}/messages/`;
  const parts = [];
  if (parent) {
    parts.push(`Fork из чата \`${parent.chat_id}\` от сообщения \`${parent.message_id}\` (коммит \`${parent.commit_sha.slice(0, 7)}\`).`);
  }
  if (intro?.trim()) parts.push(intro.trim());
  parts.push(
    `**Агентам:** прочитайте \`${agents}\` и ответьте новым файлом в ` +
      `\`${messages}\` в эту же ветку \`chat/${chatId}\`. ` +
      `Если пушить сюда нельзя — свой PR в ветку чата или комментарий с блоком \`<!-- chat0110 … -->\`.`,
    "Этот PR — чат chat.0110. Его не сливают.",
    `<!-- chat0110\nchat_id: ${chatId}\nschema_version: ${store === 2 ? 2 : 1}\n` +
      (parent
        ? `parent_chat_id: ${parent.chat_id}\nparent_message_id: ${parent.message_id}\nfork_commit_sha: ${parent.commit_sha}\n`
        : "") +
      "-->",
  );
  return parts.join("\n\n") + "\n";
}

export const CHAT_TITLE_PREFIX = "[chat] ";

export function chatTitleFromPr(title: string): string {
  return title.startsWith(CHAT_TITLE_PREFIX) ? title.slice(CHAT_TITLE_PREFIX.length) : title;
}

export interface ChatParent extends ForkPoint {
  reason?: string;
}

export interface ChatMeta {
  schema_version: 1;
  chat_id: string;
  title: string;
  created_at: string;
  created_by: string;
  parent: ChatParent | null;
}

export function serializeChatJson(meta: ChatMeta): string {
  return JSON.stringify(meta, null, 2) + "\n";
}

export function parseChatJson(content: string): ChatMeta | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const createdAt = typeof r.created_at === "string" ? validIso(r.created_at) : undefined;
  if (
    typeof r.chat_id !== "string" || !isChatId(r.chat_id) ||
    typeof r.title !== "string" || !createdAt ||
    typeof r.created_by !== "string"
  ) return null;
  return {
    schema_version: 1,
    chat_id: r.chat_id,
    title: r.title,
    created_at: createdAt,
    created_by: r.created_by,
    parent: parseParent(r.parent),
  };
}

function parseParent(raw: unknown): ChatParent | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const point = validForkPoint(p.chat_id, p.message_id, p.commit_sha);
  if (!point) return null;
  return typeof p.reason === "string" && p.reason.trim() ? { ...point, reason: p.reason } : point;
}
