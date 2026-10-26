// Снимок контекста Fork: вся цепочка предков до точек ветвления.
// Пишется в чат ребёнка в момент Fork и дальше не перечитывает родителя:
// ветку родителя могут удалить, а комментарий PR — отредактировать.
import { isAuthor, isChatId, type ChatStore } from "./ids.ts";
import { parseMessageFile, validIso, type MessageFile } from "./message-file.ts";
import { parseCommentMeta, type ForkPoint } from "./meta.ts";
import { displayName, resolveAuthor } from "./agents.ts";
import type { CommentInput, FileInput, ReviewCommentInput, ReviewInput } from "./timeline.ts";
import type { MessageItem } from "./timeline.ts";

export const FORK_CHAIN_MAX = 32;

export const GAP_NO_SNAPSHOT = "Снимок контекста не записывался: комментарии PR могли измениться.";
export const GAP_DAMAGED = "Снимок контекста повреждён.";
export const GAP_BOUNDARY = "Точка ветвления не попала в снимок.";
export const GAP_TOO_LONG = "Цепочка Fork длиннее 32 уровней, дальше не читал.";

export const gapCycle = (id: string) => `Цикл в цепочке Fork на чате ${id}.`;
export const gapUnavailable = (id: string, sha: string) => `Чат ${id}: коммит ${sha.slice(0, 7)} недоступен.`;
export const gapParentUnknown = (id: string) => `Паспорт чата ${id} на коммите ветвления не прочитан: предки выше неизвестны.`;
export const gapComments = (id: string) => `Комментарии чата ${id} на момент ветвления не сохранены.`;

const SHA_RE = /^[0-9a-f]{7,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function forkContextPath(chatId: string, store: ChatStore): string {
  return store === 2 ? `Chat/forks/${chatId}/context.json` : `chats/${chatId}/context.json`;
}

export interface FrozenMessage {
  id: string;
  origin_chat_id: string;
  author: string;
  source: "file" | "comment";
  created_at: string;
  text: string;
  reply_to?: string;
}

/** Один предок, обрезанный своей точкой ветвления. Корень — первый. */
export interface ForkAncestor {
  chat_id: string;
  title: string;
  number: number | null;
  boundary_message_id: string;
  commit_sha: string;
  messages: FrozenMessage[];
}

export interface ForkContextFile {
  schema_version: 1;
  chat_id: string;
  created_at: string;
  created_by: string;
  parent: ForkPoint;
  complete: boolean;
  gaps: string[];
  ancestors: ForkAncestor[];
}

export function serializeForkContext(file: ForkContextFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

function frozen(origin: string, id: string, author: string, source: FrozenMessage["source"], at: string, text: string, replyTo?: string): FrozenMessage {
  const msg: FrozenMessage = { id, origin_chat_id: origin, author, source, created_at: at, text };
  if (replyTo) msg.reply_to = replyTo;
  return msg;
}

function fromFile(origin: string, msg: MessageFile): FrozenMessage {
  return frozen(origin, msg.id, msg.author, "file", msg.created_at, msg.text, msg.reply_to);
}

function dedupeSort(messages: FrozenMessage[]): FrozenMessage[] {
  const seen = new Set<string>();
  const out: FrozenMessage[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  out.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// Срез непосредственного родителя на момент Fork. Файлы — с коммита ветвления.
// Комментарии PR берём как они есть сейчас и сразу замораживаем: позже их
// могут отредактировать. Всё строже точки ветвления отбрасывается.
export function parentSlice(input: {
  chatId: string;
  title: string;
  number: number | null;
  messageId: string;
  commitSha: string;
  files: FileInput[];
  comments: CommentInput[];
  reviews: ReviewInput[];
  reviewComments: ReviewCommentInput[];
}): { ancestor: ForkAncestor; boundaryKnown: boolean } {
  const { chatId } = input;
  const files = input.files.flatMap((f) => {
    const msg = parseMessageFile(f.name, f.content);
    return msg ? [fromFile(chatId, msg)] : [];
  });
  const comments: FrozenMessage[] = [];
  for (const c of input.comments) {
    const at = validIso(c.created_at);
    if (!at) continue;
    const { text, meta } = parseCommentMeta(c.body);
    const body = text.trim();
    if (!body) continue;
    const author = meta.author ?? resolveAuthor(c.login);
    comments.push(frozen(chatId, meta.id ?? `c${c.id}`, author, "comment", at, body, meta.reply_to));
  }
  for (const r of input.reviews) {
    const body = r.body.trim();
    const at = validIso(r.submitted_at);
    if (!body || !at) continue;
    const author = resolveAuthor(r.login);
    comments.push(frozen(chatId, `r${r.id}`, author, "comment", at, body));
  }
  for (const rc of input.reviewComments) {
    const body = rc.body.trim();
    const at = validIso(rc.created_at);
    if (!body || !at) continue;
    const author = resolveAuthor(rc.login);
    comments.push(frozen(chatId, `rc${rc.id}`, author, "comment", at, body));
  }
  const all = dedupeSort([...files, ...comments]);
  const boundary = all.find((m) => m.id === input.messageId);
  const kept = boundary ? all.filter((m) => m.created_at <= boundary.created_at) : files;
  return {
    boundaryKnown: boundary !== undefined,
    ancestor: {
      chat_id: chatId,
      title: input.title,
      number: input.number,
      boundary_message_id: input.messageId,
      commit_sha: input.commitSha,
      messages: dedupeSort(kept),
    },
  };
}

export interface ChainLevel {
  ancestor: ForkAncestor;
  /** false — комментарии этого уровня не замораживались. */
  commentsFrozen: boolean;
  /** Коммита больше нет: уровень в цепочку не входит. */
  missing?: boolean;
  /** Паспорта нет и PR не говорит, есть ли предок. */
  parentUnknown?: boolean;
}

// Уровни приходят от ребёнка к корню. Наружу — от корня к непосредственному родителю.
export function assembleChain(fromParent: ChainLevel[]): { ancestors: ForkAncestor[]; complete: boolean; gaps: string[] } {
  const ancestors: ForkAncestor[] = [];
  const gaps: string[] = [];
  let complete = true;
  const seen = new Set<string>();
  for (const level of fromParent) {
    if (ancestors.length >= FORK_CHAIN_MAX) {
      gaps.push(GAP_TOO_LONG);
      complete = false;
      break;
    }
    if (seen.has(level.ancestor.chat_id)) {
      gaps.push(gapCycle(level.ancestor.chat_id));
      complete = false;
      break;
    }
    seen.add(level.ancestor.chat_id);
    if (level.missing) {
      gaps.push(gapUnavailable(level.ancestor.chat_id, level.ancestor.commit_sha));
      complete = false;
      break;
    }
    ancestors.push(level.ancestor);
    if (!level.commentsFrozen) {
      gaps.push(gapComments(level.ancestor.chat_id));
      complete = false;
    }
    if (level.parentUnknown) {
      gaps.push(gapParentUnknown(level.ancestor.chat_id));
      complete = false;
      break;
    }
  }
  ancestors.reverse();
  return { ancestors, complete, gaps };
}

function forkPoint(raw: unknown): ForkPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.chat_id !== "string" || !isChatId(p.chat_id)) return null;
  if (typeof p.message_id !== "string" || !ID_RE.test(p.message_id)) return null;
  if (typeof p.commit_sha !== "string" || !SHA_RE.test(p.commit_sha)) return null;
  return { chat_id: p.chat_id, message_id: p.message_id, commit_sha: p.commit_sha };
}

function frozenMessage(raw: unknown, origin: string): FrozenMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const at = typeof m.created_at === "string" ? validIso(m.created_at) : undefined;
  if (
    typeof m.id !== "string" || !ID_RE.test(m.id) ||
    m.origin_chat_id !== origin ||
    typeof m.author !== "string" || !m.author || m.author.length > 64 ||
    (m.source !== "file" && m.source !== "comment") ||
    typeof m.text !== "string" || m.text.length > 60_000 ||
    !at
  ) return null;
  const msg: FrozenMessage = { id: m.id, origin_chat_id: origin, author: m.author, source: m.source, created_at: at, text: m.text };
  if (m.reply_to !== undefined) {
    if (typeof m.reply_to !== "string" || !ID_RE.test(m.reply_to)) return null;
    msg.reply_to = m.reply_to;
  }
  return msg;
}

function ancestor(raw: unknown): ForkAncestor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.chat_id !== "string" || !isChatId(a.chat_id)) return null;
  if (typeof a.title !== "string" || !a.title || a.title.length > 200) return null;
  if (a.number !== null && (typeof a.number !== "number" || !Number.isInteger(a.number) || a.number <= 0)) return null;
  if (typeof a.boundary_message_id !== "string" || !ID_RE.test(a.boundary_message_id)) return null;
  if (typeof a.commit_sha !== "string" || !SHA_RE.test(a.commit_sha)) return null;
  if (!Array.isArray(a.messages) || a.messages.length > 5000) return null;
  const messages: FrozenMessage[] = [];
  for (const item of a.messages) {
    const msg = frozenMessage(item, a.chat_id);
    if (!msg) return null;
    messages.push(msg);
  }
  return {
    chat_id: a.chat_id,
    title: a.title,
    number: a.number,
    boundary_message_id: a.boundary_message_id,
    commit_sha: a.commit_sha,
    messages,
  };
}

export function parseForkContext(content: string): ForkContextFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const createdAt = typeof r.created_at === "string" ? validIso(r.created_at) : undefined;
  const parent = forkPoint(r.parent);
  if (
    r.schema_version !== 1 ||
    typeof r.chat_id !== "string" || !isChatId(r.chat_id) ||
    !createdAt ||
    typeof r.created_by !== "string" || !isAuthor(r.created_by) ||
    !parent ||
    typeof r.complete !== "boolean" ||
    !Array.isArray(r.gaps) || r.gaps.length > 40 ||
    r.gaps.some((g) => typeof g !== "string" || g.length > 300) ||
    !Array.isArray(r.ancestors) || r.ancestors.length > FORK_CHAIN_MAX
  ) return null;
  const ancestors: ForkAncestor[] = [];
  for (const item of r.ancestors) {
    const parsed = ancestor(item);
    if (!parsed) return null;
    ancestors.push(parsed);
  }
  return {
    schema_version: 1,
    chat_id: r.chat_id,
    created_at: createdAt,
    created_by: r.created_by,
    parent,
    complete: r.complete,
    gaps: r.gaps as string[],
    ancestors,
  };
}

export function inheritedItems(ancestors: readonly ForkAncestor[]): MessageItem[] {
  const seen = new Set<string>();
  const items: MessageItem[] = [];
  for (const a of ancestors) {
    for (const m of a.messages) {
      const key = `${m.origin_chat_id}\0${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item: MessageItem = {
        kind: "message",
        id: m.id,
        origin_chat_id: m.origin_chat_id,
        author: m.author,
        display: displayName(m.author),
        source: m.source,
        text: m.text,
        created_at: m.created_at,
        pending: false,
      };
      if (m.reply_to) item.reply_to = m.reply_to;
      items.push(item);
    }
  }
  items.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return items;
}
