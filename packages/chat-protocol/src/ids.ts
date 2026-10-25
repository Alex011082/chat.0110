// Идентификаторы чата и сообщений (docs/protocol.md). Всё, что попадает в путь
// файла или имя ветки, проверяется регулярками: id приходит и от агентов.

export const CHAT_ID_RE = /^\d{8}-[a-z0-9]{4}$/;
export const AUTHOR_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MESSAGE_ID_RE = /^(\d{8}T\d{6}Z)-([a-z0-9][a-z0-9_-]{0,31})-([a-z0-9]{4})$/;
const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";

export type Rand = () => string;

export function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => BASE36[b % 36]).join("");
}

export function isChatId(value: string): boolean {
  return CHAT_ID_RE.test(value);
}

export function isAuthor(value: string): boolean {
  return AUTHOR_RE.test(value);
}

export function newChatId(at: Date, rand: Rand = randomSuffix): string {
  return `${at.toISOString().slice(0, 10).replaceAll("-", "")}-${rand()}`;
}

export function branchForChat(chatId: string): string {
  return `chat/${chatId}`;
}

export function chatIdFromBranch(ref: string): string | null {
  const id = ref.replace(/^refs\/heads\//, "").match(/^chat\/(.+)$/)?.[1];
  return id && isChatId(id) ? id : null;
}

export function stampOf(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function newMessageId(at: Date, author: string, rand: Rand = randomSuffix): string {
  const who = author.toLowerCase();
  if (!isAuthor(who)) throw new Error(`недопустимый автор сообщения: ${author}`);
  return `${stampOf(at)}-${who}-${rand()}`;
}

export interface MessageIdParts {
  stamp: string;
  author: string;
  rand: string;
  date: string;
}

export function parseMessageId(id: string): MessageIdParts | null {
  const m = id.match(MESSAGE_ID_RE);
  if (!m) return null;
  const [, stamp, author, rand] = m as unknown as [string, string, string, string];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { stamp, author, rand, date: date.toISOString() };
}

/** 1 — прежний каталог chats/. 2 — Chat/conversations/ после подключения репозитория. */
export type ChatStore = 1 | 2;

function chatHome(chatId: string, store: ChatStore): string {
  return store === 2 ? `Chat/conversations/${chatId}` : `chats/${chatId}`;
}

export function messagesDir(chatId: string, store: ChatStore = 1): string {
  return `${chatHome(chatId, store)}/messages`;
}

export function messagePath(chatId: string, messageId: string, store: ChatStore = 1): string {
  return `${messagesDir(chatId, store)}/${messageId}.md`;
}

export function chatJsonPath(chatId: string, store: ChatStore = 1): string {
  return `${chatHome(chatId, store)}/chat.json`;
}

export function isChatJsonPath(chatId: string, path: string): boolean {
  return path === chatJsonPath(chatId, 1) || path === chatJsonPath(chatId, 2);
}

export function isMessagePath(chatId: string, path: string, store?: ChatStore): boolean {
  if (store) return isEventPath(messagesDir(chatId, store), path);
  return isEventPath(messagesDir(chatId, 1), path) || isEventPath(messagesDir(chatId, 2), path);
}

// События решений живут рядом с сообщениями, в тех же именах файлов:
// одно событие — один файл, поэтому параллельные пуши не конфликтуют.
// В подключённом репозитории (store 2) новые решения не пишутся.
export function decisionsDir(chatId: string, store: ChatStore = 1): string {
  return `${chatHome(chatId, store)}/decisions`;
}

export function decisionPath(chatId: string, eventId: string, store: ChatStore = 1): string {
  return `${decisionsDir(chatId, store)}/${eventId}.md`;
}

export function isDecisionPath(chatId: string, path: string, store?: ChatStore): boolean {
  if (store) return isEventPath(decisionsDir(chatId, store), path);
  return isEventPath(decisionsDir(chatId, 1), path) || isEventPath(decisionsDir(chatId, 2), path);
}

function isEventPath(dir: string, path: string): boolean {
  const prefix = `${dir}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return false;
  return parseMessageId(path.slice(prefix.length, -3)) !== null;
}
