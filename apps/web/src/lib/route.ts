import { isChatId } from "@chat0110/chat-protocol";

// Адрес чата — /<owner>/<repo>/<chatId>, дерево — /<owner>/<repo>/~tree?chat=<id>.
// Роутер не нужен: History API и эти функции.

export interface Route {
  owner: string | null;
  repo: string | null;
  chatId: string | null;
  /** Экран «Дерево» репозитория. */
  tree?: boolean;
  /** Выбранная в дереве ветка (?chat=<id>). */
  select?: string | null;
}

export const TREE_SEGMENT = "~tree";

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const EMPTY: Route = { owner: null, repo: null, chatId: null };

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean).map(decode);
  const [owner, repo, chatId] = parts;
  if (!owner || !repo || !NAME_RE.test(owner) || !NAME_RE.test(repo)) return { ...EMPTY };
  if (chatId === TREE_SEGMENT) {
    const select = new URLSearchParams(search).get("chat");
    return { owner, repo, chatId: null, tree: true, select: select && isChatId(select) ? select : null };
  }
  return { owner, repo, chatId: chatId && isChatId(chatId) ? chatId : null };
}

export function routePath(r: Route): string {
  if (!r.owner || !r.repo) return "/";
  const base = `/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
  if (r.tree) return `${base}/${TREE_SEGMENT}`;
  return r.chatId ? `${base}/${r.chatId}` : base;
}

/** Строка запроса: пробный режим (?mock) сохраняется, ?chat — только у дерева. */
export function routeSearch(r: Route, mock: string | null): string {
  const q = new URLSearchParams();
  if (mock) q.set("mock", mock);
  if (r.tree && r.select) q.set("chat", r.select);
  const str = q.toString();
  return str ? `?${str}` : "";
}

export function splitRepo(fullName: string): { owner: string; name: string } | null {
  const [owner, name, extra] = fullName.split("/");
  if (!owner || !name || extra !== undefined || !NAME_RE.test(owner) || !NAME_RE.test(name)) return null;
  return { owner, name };
}

/** Адрес чата по полному имени репо «owner/name». */
export function chatRoute(fullName: string, chatId: string): Route {
  const r = splitRepo(fullName);
  return r ? { owner: r.owner, repo: r.name, chatId } : { ...EMPTY };
}
