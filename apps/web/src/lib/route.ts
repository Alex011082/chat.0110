import { isChatId } from "@chat0110/chat-protocol";

// Адрес чата — /<owner>/<repo>/<chatId>. Роутер не нужен: History API и эти две функции.

export interface Route {
  owner: string | null;
  repo: string | null;
  chatId: string | null;
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const EMPTY: Route = { owner: null, repo: null, chatId: null };

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decode);
  const [owner, repo, chatId] = parts;
  if (!owner || !repo || !NAME_RE.test(owner) || !NAME_RE.test(repo)) return { ...EMPTY };
  return { owner, repo, chatId: chatId && isChatId(chatId) ? chatId : null };
}

export function routePath(r: Route): string {
  if (!r.owner || !r.repo) return "/";
  const base = `/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
  return r.chatId ? `${base}/${r.chatId}` : base;
}

export function splitRepo(fullName: string): { owner: string; name: string } | null {
  const [owner, name, extra] = fullName.split("/");
  if (!owner || !name || extra !== undefined || !NAME_RE.test(owner) || !NAME_RE.test(name)) return null;
  return { owner, name };
}
