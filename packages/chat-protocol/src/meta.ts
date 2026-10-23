import { isAuthor, isChatId, parseMessageId } from "./ids.ts";
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

export interface PrMeta {
  chat_id: string;
  schema_version: number;
}

export function parsePrBody(body: string | null | undefined): PrMeta | null {
  const fields = body ? readBlock(body) : null;
  if (!fields?.chat_id || !isChatId(fields.chat_id)) return null;
  return { chat_id: fields.chat_id, schema_version: Number(fields.schema_version) || 1 };
}

export function buildPrBody({ chatId, intro }: { chatId: string; intro?: string }): string {
  const parts = [];
  if (intro?.trim()) parts.push(intro.trim());
  parts.push(
    `**Агентам:** прочитайте \`chats/AGENTS.md\` и ответьте новым файлом в ` +
      `\`chats/${chatId}/messages/\` в эту же ветку \`chat/${chatId}\`. ` +
      `Если пушить сюда нельзя — свой PR в ветку чата или комментарий с блоком \`<!-- chat0110 … -->\`.`,
    "Этот PR — чат chat.0110. Его не сливают.",
    `<!-- chat0110\nchat_id: ${chatId}\nschema_version: 1\n-->`,
  );
  return parts.join("\n\n") + "\n";
}

export const CHAT_TITLE_PREFIX = "[chat] ";

export function chatTitleFromPr(title: string): string {
  return title.startsWith(CHAT_TITLE_PREFIX) ? title.slice(CHAT_TITLE_PREFIX.length) : title;
}

export interface ChatParent {
  chat_id: string;
  message_id: string;
  commit_sha: string;
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
    parent: (r.parent as ChatParent | null) ?? null,
  };
}
