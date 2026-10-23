// GitHub-адаптер: голый fetch от имени пользователя (user-to-server токен
// GitHub App), без Octokit. Всё, что читает и пишет чат, проходит здесь.
import {
  branchForChat,
  chatIdFromBranch,
  isChatId,
  isMessagePath,
  messagesDir,
  parsePrBody,
  type AgentPrInput,
  type ApiErrorCode,
  type CommentInput,
  type CommitInput,
  type FileInput,
  type ForkPoint,
  type RepoInfo,
  type ReviewCommentInput,
  type ReviewInput,
} from "@chat0110/chat-protocol";
import { HttpError, statusForCode } from "./errors.ts";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const GITHUB_API = "https://api.github.com";

export interface RepoRef {
  owner: string;
  name: string;
}

export class GitHubError extends HttpError {
  constructor(
    code: ApiErrorCode,
    message: string,
    // Исходный статус и текст GitHub нужны логике: «Reference already exists»
    // и «Git Repository is empty» — разные 422/409, и реагируем мы по-разному.
    readonly ghStatus: number,
    readonly ghMessage: string,
    retryAfter?: number,
  ) {
    super(statusForCode(code), code, message, retryAfter);
    this.name = "GitHubError";
  }
}

// Небольшой LRU на Map: порядок вставки = порядок давности.
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

interface EtagEntry {
  etag: string;
  body: unknown;
  link: string | null;
}

export interface GitHubCaches {
  // Ключ — (id пользователя, URL): ответ 304 не тратит лимит, а чужой ответ
  // никогда не уходит другому пользователю, даже если URL совпал.
  etag: Lru<EtagEntry>;
  // Блобы и списки добавленных файлов коммита неизменны по sha, поэтому общие
  // для всех. Безопасно: sha пользователь получил своим токеном из листинга,
  // то есть доступ к репо он уже доказал.
  blobs: Lru<string>;
  commitAdded: Lru<string[]>;
  // Сообщения чата на коммите ветвления Fork: коммит неизменен, значит и
  // снимок тоже. Ключ — (репо, sha, чат); тот же довод про доступ, что у блобов.
  // Записей меньше: в каждой — тексты всех сообщений родителя.
  snapshots: Lru<FileInput[]>;
}

export function createCaches(): GitHubCaches {
  return { etag: new Lru(5000), blobs: new Lru(20000), commitAdded: new Lru(20000), snapshots: new Lru(500) };
}

export interface GhUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
}

export interface GhRepo {
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch: string;
  can_push: boolean;
}

export interface ChatPull {
  chatId: string;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  headRef: string;
  headSha: string;
  // Родитель Fork из блока в теле PR: дерево строится из одного списка PR.
  parent: ForkPoint | null;
}

export interface MessageEntry {
  name: string;
  path: string;
  sha: string;
}

export interface PullFile {
  filename: string;
  status: string;
  sha: string;
}

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const repoPath = (r: RepoRef) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
const repoKey = (r: RepoRef) => `${r.owner}/${r.name}`.toLowerCase();

function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1]!;
  }
  return null;
}

// Сколько секунд ждать, если GitHub сказал «хватит». Retry-After главнее:
// так просит сам GitHub для вторичных лимитов.
function retryAfterOf(res: Response, message: string): number | undefined {
  const ra = res.headers.get("retry-after");
  if (ra && /^\d+$/.test(ra)) return Number(ra);
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (reset) return Math.max(1, reset - Math.floor(Date.now() / 1000));
    return 60;
  }
  if (res.status === 429 || /rate limit/i.test(message)) return 60;
  return undefined;
}

async function toError(res: Response): Promise<GitHubError> {
  let message = "";
  try {
    const data = (await res.json()) as { message?: string; errors?: { message?: string }[] };
    message = [data.message, ...(data.errors ?? []).map((e) => e.message)].filter(Boolean).join(": ");
  } catch {
    // тело не JSON — хватит статуса
  }
  const s = res.status;
  const retry = s === 403 || s === 429 ? retryAfterOf(res, message) : undefined;
  if (retry !== undefined) {
    return new GitHubError("rate_limited", `GitHub просит подождать ${retry} с: исчерпан лимит запросов`, s, message, retry);
  }
  const [code, text]: [ApiErrorCode, string] =
    s === 401 ? ["unauthorized", "GitHub не принял токен — войдите заново"]
    : s === 403 ? ["forbidden", "GitHub не дал доступа"]
    : s === 404 ? ["not_found", "GitHub не нашёл объект (или к нему нет доступа)"]
    // 405 на слиянии значит «PR нельзя слить» — для пользователя это тот же конфликт.
    : s === 405 || s === 409 || s === 422 ? ["conflict", "GitHub отклонил изменение"]
    : ["github_error", `GitHub ответил ошибкой ${s}`];
  return new GitHubError(code, message ? `${text} (${message})` : text, s, message);
}

export class GitHubClient {
  private readonly token: string;
  private readonly userId: number;
  private readonly fetcher: Fetch;
  private readonly caches: GitHubCaches | null;
  private readonly api: string;

  constructor(opts: { token: string; userId: number; fetch?: Fetch; caches?: GitHubCaches; apiBase?: string }) {
    this.token = opts.token;
    this.userId = opts.userId;
    this.fetcher = opts.fetch ?? fetch;
    this.caches = opts.caches ?? null;
    this.api = opts.apiBase ?? GITHUB_API;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "chat0110",
      ...extra,
    };
  }

  // Изменяющие запросы: без кеша, тело — JSON.
  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: this.headers(body === undefined ? {} : { "Content-Type": "application/json" }) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetcher(this.api + path, init);
    if (!res.ok) throw await toError(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  // GET с ETag. Возвращает и Link, чтобы пагинация работала и на 304.
  private async getRaw(url: string): Promise<{ body: unknown; link: string | null }> {
    const key = `${this.userId} ${url}`;
    const cached = this.caches?.etag.get(key);
    const res = await this.fetcher(url, { headers: this.headers(cached ? { "If-None-Match": cached.etag } : {}) });
    if (res.status === 304 && cached) return { body: cached.body, link: cached.link };
    if (!res.ok) throw await toError(res);
    const body = await res.json();
    const link = res.headers.get("link");
    const etag = res.headers.get("etag");
    if (etag && this.caches) this.caches.etag.set(key, { etag, body, link });
    return { body, link };
  }

  async get<T = any>(path: string): Promise<T> {
    return (await this.getRaw(this.api + path)).body as T;
  }

  // Пагинация по Link. Понимает и массивы, и обёртки {installations},
  // {repositories}. `until` останавливает обход, когда нужный элемент найден
  // (элемент и всё после него не попадают в результат).
  async paginate<T = any>(path: string, opts: { until?: (item: T) => boolean; maxPages?: number } = {}): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = this.api + path;
    for (let page = 0; url && page < (opts.maxPages ?? 50); page++) {
      const { body, link } = await this.getRaw(url);
      const items = unwrap<T>(body);
      for (const item of items) {
        if (opts.until?.(item)) return out;
        out.push(item);
      }
      const next = nextLink(link);
      // Идём только по ссылкам самого API: Link приходит из ответа, и токен
      // пользователя не должен уехать на чужой хост.
      url = next && next.startsWith(this.api + "/") ? next : null;
    }
    return out;
  }

  // ——— Пользователь и репо ———

  async getUser(): Promise<GhUser> {
    const u = await this.get("/user");
    return { login: u.login, id: u.id, name: u.name ?? null, avatar_url: u.avatar_url };
  }

  // Репо, где стоит App и куда у пользователя есть доступ. Сначала те, куда
  // пушили последними: новичок попадает в репо с живыми чатами, а не в
  // первое по алфавиту. Пустые репо (pushed_at = null) — в конце.
  async listRepos(): Promise<RepoInfo[]> {
    const installations = await this.paginate<{ id: number }>("/user/installations?per_page=100");
    const lists = await Promise.all(
      installations.map(async (inst) => {
        const repos = await this.paginate<any>(`/user/installations/${inst.id}/repositories?per_page=100`);
        return repos.map((r): { info: RepoInfo; pushed: string } => ({
          info: {
            full_name: r.full_name,
            owner: r.owner?.login ?? r.full_name.split("/")[0],
            name: r.name,
            private: r.private === true,
            default_branch: r.default_branch,
            can_push: r.permissions?.push === true,
            installation_id: inst.id,
          },
          pushed: typeof r.pushed_at === "string" ? r.pushed_at : "",
        }));
      }),
    );
    const seen = new Set<string>();
    const key = (r: RepoInfo) => r.full_name.toLowerCase();
    return lists
      .flat()
      .filter((r) => !seen.has(key(r.info)) && seen.add(key(r.info)))
      .sort((a, b) => (a.pushed < b.pushed ? 1 : a.pushed > b.pushed ? -1 : key(a.info).localeCompare(key(b.info))))
      .map((r) => r.info);
  }

  async getRepo(repo: RepoRef): Promise<GhRepo> {
    const r = await this.get(repoPath(repo));
    return {
      full_name: r.full_name,
      owner: r.owner?.login ?? repo.owner,
      name: r.name ?? repo.name,
      private: r.private === true,
      default_branch: r.default_branch,
      can_push: r.permissions?.push === true,
    };
  }

  // ——— Чаты ———

  // Чат = PR из ветки chat/<id> этого же репо с блоком chat0110 в теле.
  // Сортировка по обновлению: активные чаты наверху, и 10 страниц хватает
  // даже в шумном репо.
  async listChatPulls(repo: RepoRef): Promise<ChatPull[]> {
    const prs = await this.paginate<any>(`${repoPath(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100`, { maxPages: 10 });
    return prs.map((p) => toChatPull(repo, p)).filter((p): p is ChatPull => p !== null);
  }

  async findChatPull(repo: RepoRef, chatId: string): Promise<ChatPull | null> {
    const head = encodeURIComponent(`${repo.owner}:${branchForChat(chatId)}`);
    const prs = await this.paginate<any>(`${repoPath(repo)}/pulls?state=all&head=${head}&per_page=100`, { maxPages: 2 });
    return prs.map((p) => toChatPull(repo, p)).find((p) => p?.chatId === chatId) ?? null;
  }

  // Файлы-сообщения чата на ветке чата или на конкретном коммите (ref = sha).
  async listMessageFiles(repo: RepoRef, chatId: string, ref: string = branchForChat(chatId)): Promise<MessageEntry[]> {
    try {
      const list = await this.get<any[]>(`${repoPath(repo)}/contents/${enc(messagesDir(chatId))}?ref=${encodeURIComponent(ref)}`);
      if (!Array.isArray(list)) return [];
      return list
        .filter((e) => e.type === "file" && isMessagePath(chatId, e.path))
        .map((e) => ({ name: e.name, path: e.path, sha: e.sha }));
    } catch (e) {
      if (e instanceof GitHubError && e.code === "not_found") return [];
      throw e;
    }
  }

  // Содержимое файла на ветке или null, если его нет. Для chat.json и для
  // проверки, есть ли в репо chats/AGENTS.md.
  async getFileText(repo: RepoRef, path: string, ref: string): Promise<string | null> {
    try {
      const f = await this.get(`${repoPath(repo)}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      if (!f || Array.isArray(f) || typeof f.content !== "string") return null;
      return Buffer.from(f.content, "base64").toString("utf8");
    } catch (e) {
      if (e instanceof GitHubError && e.code === "not_found") return null;
      throw e;
    }
  }

  // Сообщения чата с текстами на неизменном коммите — для истории родителя
  // в дочернем чате. Всё, что лежит на коммите ветвления, по построению не
  // позже точки Fork, поэтому снимок кешируется навсегда.
  async getMessageFilesAt(repo: RepoRef, chatId: string, sha: string): Promise<FileInput[]> {
    const key = `${repoKey(repo)}@${sha}:${chatId}`;
    const hit = this.caches?.snapshots.get(key);
    if (hit) return hit;
    const entries = await this.listMessageFiles(repo, chatId, sha);
    const files = await mapLimit(entries, 8, async (e) => ({ name: e.name, content: await this.getBlob(repo, e.sha) }));
    this.caches?.snapshots.set(key, files);
    return files;
  }

  async getBlob(repo: RepoRef, sha: string): Promise<string> {
    const key = `${repoKey(repo)}@${sha}`;
    const hit = this.caches?.blobs.get(key);
    if (hit !== undefined) return hit;
    const b = await this.request("GET", `${repoPath(repo)}/git/blobs/${encodeURIComponent(sha)}`);
    const text = Buffer.from(String(b.content ?? ""), b.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    this.caches?.blobs.set(key, text);
    return text;
  }

  async getCommitAdded(repo: RepoRef, sha: string): Promise<string[]> {
    const key = `${repoKey(repo)}@${sha}`;
    const hit = this.caches?.commitAdded.get(key);
    if (hit) return hit;
    const c = await this.request("GET", `${repoPath(repo)}/commits/${encodeURIComponent(sha)}`);
    const added = ((c.files ?? []) as { filename: string; status: string }[])
      .filter((f) => f.status === "added")
      .map((f) => f.filename);
    this.caches?.commitAdded.set(key, added);
    return added;
  }

  // Коммиты ветки чата от merge-base до головы, от старых к новым.
  // Не pulls/:n/commits — тот обрезан на 250 коммитах.
  // forkSha — коммит ветвления дочернего чата: ниже него история родителя,
  // а не события этого чата. Merge-base с основной веткой остаётся пределом
  // обхода, если sha из тела PR вдруг не предок ветки.
  async listBranchCommits(repo: RepoRef, defaultBranch: string, chatId: string, forkSha?: string): Promise<CommitInput[]> {
    const branch = branchForChat(chatId);
    let mergeBase: string | null = null;
    try {
      // per_page=1: нам нужен только merge_base_commit, а не список коммитов сравнения.
      const cmp = await this.get(`${repoPath(repo)}/compare/${enc(defaultBranch)}...${enc(branch)}?per_page=1`);
      mergeBase = cmp?.merge_base_commit?.sha ?? null;
    } catch (e) {
      // Ветки нет (чат закрыт, ветку удалили) — коммитов просто нет.
      if (e instanceof GitHubError && e.code === "not_found") return [];
      throw e;
    }
    const raw = await this.paginate<any>(`${repoPath(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=100`, {
      // startsWith: в теле PR sha может быть сокращённым (протокол допускает от 7 символов).
      until: (c) => c.sha === mergeBase || (forkSha !== undefined && String(c.sha).startsWith(forkSha)),
      // Без merge-base обходим немного: иначе прочитали бы всю историю репо.
      maxPages: mergeBase ? 50 : 3,
    });
    const ordered = raw.reverse();
    const added = await mapLimit(ordered, 8, (c) => this.getCommitAdded(repo, c.sha));
    return ordered.map((c, i): CommitInput => ({
      sha: c.sha,
      message: c.commit?.message ?? "",
      login: c.author?.login ?? null,
      name: c.commit?.author?.name ?? "",
      date: c.commit?.committer?.date ?? c.commit?.author?.date ?? "",
      added: added[i]!,
      url: c.html_url,
    }));
  }

  async listComments(repo: RepoRef, number: number): Promise<CommentInput[]> {
    const raw = await this.paginate<any>(`${repoPath(repo)}/issues/${number}/comments?per_page=100`);
    return raw.map((c) => ({ id: c.id, login: c.user?.login ?? "ghost", body: c.body ?? "", created_at: c.created_at, url: c.html_url }));
  }

  async listReviews(repo: RepoRef, number: number): Promise<ReviewInput[]> {
    const raw = await this.paginate<any>(`${repoPath(repo)}/pulls/${number}/reviews?per_page=100`);
    // PENDING-ревью ещё не отправлено: у него нет даты, и видит его только автор.
    return raw
      .filter((r) => r.submitted_at)
      .map((r) => ({ id: r.id, login: r.user?.login ?? "ghost", body: r.body ?? "", state: r.state, submitted_at: r.submitted_at, url: r.html_url }));
  }

  async listReviewComments(repo: RepoRef, number: number): Promise<ReviewCommentInput[]> {
    const raw = await this.paginate<any>(`${repoPath(repo)}/pulls/${number}/comments?per_page=100`);
    return raw.map((c) => ({
      id: c.id,
      login: c.user?.login ?? "ghost",
      body: c.body ?? "",
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      diff_hunk: c.diff_hunk,
      created_at: c.created_at,
      url: c.html_url,
    }));
  }

  async listPullFiles(repo: RepoRef, number: number): Promise<PullFile[]> {
    const raw = await this.paginate<any>(`${repoPath(repo)}/pulls/${number}/files?per_page=100`);
    return raw.map((f) => ({ filename: f.filename, status: f.status, sha: f.sha }));
  }

  // PR агентов в ветку чата. Их файлы-сообщения показываются «не влитыми».
  // PR из ветки chat/<id> этого же репо — дочерний чат (Fork), а не ответ
  // агента. Ветка chat/<id> в чужом форке — это агент без права пуша, он остаётся.
  async listAgentPulls(repo: RepoRef, chatId: string): Promise<AgentPrInput[]> {
    const base = encodeURIComponent(branchForChat(chatId));
    const all = await this.paginate<any>(`${repoPath(repo)}/pulls?state=all&base=${base}&per_page=100`, { maxPages: 5 });
    const prs = all.filter(
      (p) => !(chatIdFromBranch(String(p.head?.ref ?? "")) && String(p.head?.repo?.full_name ?? "").toLowerCase() === repoKey(repo)),
    );
    return mapLimit(prs, 4, async (p): Promise<AgentPrInput> => {
      const open = p.state === "open";
      const files = (await this.listPullFiles(repo, p.number)).filter((f) => f.status === "added" && isMessagePath(chatId, f.filename));
      const headRepo = parseFullName(p.head?.repo?.full_name);
      return {
        number: p.number,
        title: p.title ?? "",
        login: p.user?.login ?? "ghost",
        state: open ? "open" : "closed",
        merged: Boolean(p.merged_at),
        created_at: p.created_at,
        url: p.html_url,
        files: await mapLimit(files, 8, async (f) => ({
          name: f.filename.slice(f.filename.lastIndexOf("/") + 1),
          // Текст нужен только у открытых PR: влитое уже лежит в ветке,
          // а отвергнутое в ленту не попадает — хватит имени файла.
          content: open ? await this.blobFromPr(repo, headRepo, f.sha) : "",
        })),
      };
    });
  }

  // Блоб из PR форка обычно доступен и через базовое репо (общее хранилище
  // сети форков), но не всегда — тогда спрашиваем сам форк.
  private async blobFromPr(repo: RepoRef, headRepo: RepoRef | null, sha: string): Promise<string> {
    try {
      return await this.getBlob(repo, sha);
    } catch (e) {
      if (headRepo && e instanceof GitHubError && e.code === "not_found" && repoKey(headRepo) !== repoKey(repo)) {
        return this.getBlob(headRepo, sha);
      }
      throw e;
    }
  }

  // ——— Запись ———

  async getBranchHead(repo: RepoRef, branch: string): Promise<string> {
    const ref = await this.request("GET", `${repoPath(repo)}/git/ref/heads/${enc(branch)}`);
    return ref.object.sha;
  }

  async getCommitTree(repo: RepoRef, sha: string): Promise<string> {
    const c = await this.request("GET", `${repoPath(repo)}/git/commits/${encodeURIComponent(sha)}`);
    return c.tree.sha;
  }

  async createTree(repo: RepoRef, baseTree: string, files: { path: string; content: string }[]): Promise<string> {
    const t = await this.request("POST", `${repoPath(repo)}/git/trees`, {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    });
    return t.sha;
  }

  async createCommit(repo: RepoRef, message: string, tree: string, parents: string[]): Promise<string> {
    const c = await this.request("POST", `${repoPath(repo)}/git/commits`, { message, tree, parents });
    return c.sha;
  }

  async createBranch(repo: RepoRef, branch: string, sha: string): Promise<void> {
    await this.request("POST", `${repoPath(repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  async deleteBranch(repo: RepoRef, branch: string): Promise<void> {
    await this.request("DELETE", `${repoPath(repo)}/git/refs/heads/${enc(branch)}`);
  }

  async putFile(
    repo: RepoRef,
    path: string,
    opts: { message: string; content: string; branch?: string },
  ): Promise<{ commitSha: string; commitUrl: string }> {
    const body: Record<string, string> = { message: opts.message, content: Buffer.from(opts.content, "utf8").toString("base64") };
    if (opts.branch) body.branch = opts.branch;
    const r = await this.request("PUT", `${repoPath(repo)}/contents/${enc(path)}`, body);
    return { commitSha: r.commit.sha, commitUrl: r.commit.html_url };
  }

  async createPull(repo: RepoRef, data: { title: string; head: string; base: string; body: string; draft: boolean }): Promise<any> {
    return this.request("POST", `${repoPath(repo)}/pulls`, data);
  }

  async getPull(repo: RepoRef, number: number): Promise<any> {
    return this.request("GET", `${repoPath(repo)}/pulls/${number}`);
  }

  async mergePull(repo: RepoRef, number: number, sha: string): Promise<string> {
    const r = await this.request("PUT", `${repoPath(repo)}/pulls/${number}/merge`, { merge_method: "merge", sha });
    return r.sha;
  }

  async ensureLabel(repo: RepoRef, label: { name: string; color: string; description: string }): Promise<void> {
    try {
      await this.request("POST", `${repoPath(repo)}/labels`, label);
    } catch (e) {
      // 422 — метка уже есть, это нормально.
      if (!(e instanceof GitHubError && e.ghStatus === 422)) throw e;
    }
  }

  async addLabels(repo: RepoRef, number: number, labels: string[]): Promise<void> {
    await this.request("POST", `${repoPath(repo)}/issues/${number}/labels`, { labels });
  }
}

function unwrap<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const key of ["installations", "repositories", "items"]) {
      if (Array.isArray(b[key])) return b[key] as T[];
    }
  }
  return [];
}

function parseFullName(fullName: unknown): RepoRef | null {
  if (typeof fullName !== "string") return null;
  const [owner, name] = fullName.split("/");
  return owner && name ? { owner, name } : null;
}

function toChatPull(repo: RepoRef, p: any): ChatPull | null {
  const ref: string = p.head?.ref ?? "";
  const id = ref.startsWith("chat/") ? ref.slice(5) : "";
  if (!isChatId(id)) return null;
  // Ветка чата живёт в этом же репо: PR из форка с похожим именем — не наш чат.
  if (String(p.head?.repo?.full_name ?? "").toLowerCase() !== repoKey(repo)) return null;
  const meta = parsePrBody(p.body);
  if (meta?.chat_id !== id) return null;
  return {
    chatId: id,
    number: p.number,
    title: p.title ?? "",
    state: p.state === "open" ? "open" : "closed",
    draft: p.draft === true,
    url: p.html_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    author: p.user?.login ?? "ghost",
    headRef: ref,
    headSha: p.head?.sha ?? "",
    parent: meta.parent ?? null,
  };
}

// Параллельно, но не больше limit запросов разом: GitHub наказывает за
// всплески вторичным лимитом.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
