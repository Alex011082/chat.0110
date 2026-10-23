import { describe, expect, test } from "bun:test";
import { GitHubClient, GitHubError, createCaches } from "../src/github.ts";
import { FakeGitHub, b64 } from "./fake-github.ts";

const API = "https://api.github.com";
const REPO = { owner: "Alex011082", name: "chat.0110" };

function client(fake: FakeGitHub, over: { token?: string; userId?: number; caches?: ReturnType<typeof createCaches> } = {}) {
  return new GitHubClient({ token: over.token ?? "ghu_1", userId: over.userId ?? 1, fetch: fake.fetch, caches: over.caches ?? createCaches() });
}

describe("запросы к GitHub", () => {
  test("заголовки: токен пользователя, версия API, User-Agent", async () => {
    const fake = new FakeGitHub().on("GET", "/user", { body: { login: "Alex011082", id: 7, name: "Alex", avatar_url: "a" } });
    const me = await client(fake).getUser();
    expect(me).toEqual({ login: "Alex011082", id: 7, name: "Alex", avatar_url: "a" });
    const h = fake.calls[0]!.headers;
    expect(h.get("authorization")).toBe("Bearer ghu_1");
    expect(h.get("accept")).toBe("application/vnd.github+json");
    expect(h.get("x-github-api-version")).toBe("2022-11-28");
    expect(h.get("user-agent")).toBe("chat0110");
  });

  test("пагинация массивов по заголовку Link", async () => {
    const fake = new FakeGitHub()
      .on("GET", "/repos/o/r/issues/5/comments?per_page=100", {
        body: [{ id: 1 }, { id: 2 }],
        headers: { link: `<${API}/repos/o/r/issues/5/comments?per_page=100&page=2>; rel="next", <${API}/repos/o/r/issues/5/comments?per_page=100&page=2>; rel="last"` },
      })
      .on("GET", "/repos/o/r/issues/5/comments?per_page=100&page=2", { body: [{ id: 3 }] });
    const items = await client(fake).paginate<{ id: number }>("/repos/o/r/issues/5/comments?per_page=100");
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  test("пагинация не уходит по Link на чужой хост", async () => {
    const fake = new FakeGitHub().on("GET", "/x", { body: [{ id: 1 }], headers: { link: `<https://evil.example/x?page=2>; rel="next"` } });
    expect((await client(fake).paginate("/x")).length).toBe(1);
  });

  test("обёрнутые ответы {installations} и {repositories} → RepoInfo", async () => {
    const fake = new FakeGitHub()
      .on("GET", "/user/installations?per_page=100", {
        body: { total_count: 2, installations: [{ id: 11 }] },
        headers: { link: `<${API}/user/installations?per_page=100&page=2>; rel="next"` },
      })
      .on("GET", "/user/installations?per_page=100&page=2", { body: { total_count: 2, installations: [{ id: 12 }] } })
      .on("GET", "/user/installations/11/repositories?per_page=100", {
        body: { repositories: [{ full_name: "Alex011082/chat.0110", name: "chat.0110", owner: { login: "Alex011082" }, private: false, default_branch: "main", permissions: { push: true } }] },
      })
      .on("GET", "/user/installations/12/repositories?per_page=100", {
        body: { repositories: [{ full_name: "acme/app", name: "app", owner: { login: "acme" }, private: true, default_branch: "trunk", permissions: { push: false, pull: true } }] },
      });
    const repos = await client(fake).listRepos();
    expect(repos).toEqual([
      { full_name: "acme/app", owner: "acme", name: "app", private: true, default_branch: "trunk", can_push: false, installation_id: 12 },
      { full_name: "Alex011082/chat.0110", owner: "Alex011082", name: "chat.0110", private: false, default_branch: "main", can_push: true, installation_id: 11 },
    ]);
  });

  test("ETag: повторный запрос шлёт If-None-Match и берёт тело из кеша на 304", async () => {
    let n = 0;
    const fake = new FakeGitHub().on("GET", "/user", (call) => {
      n++;
      if (call.headers.get("if-none-match") === `"v1"`) return { status: 304 };
      return { body: { login: "a", id: 1, name: null, avatar_url: "x" }, headers: { etag: `"v1"` } };
    });
    const caches = createCaches();
    const gh = client(fake, { caches });
    await gh.getUser();
    const again = await gh.getUser();
    expect(n).toBe(2);
    expect(fake.calls[1]!.headers.get("if-none-match")).toBe(`"v1"`);
    expect(again.login).toBe("a");
  });

  test("ETag-кеш свой у каждого пользователя: чужой ответ никому не отдаётся", async () => {
    const fake = new FakeGitHub().on("GET", "/repos/o/r", { body: { full_name: "o/r" }, headers: { etag: `"r1"` } });
    const caches = createCaches();
    await client(fake, { caches, userId: 1 }).get("/repos/o/r");
    await client(fake, { caches, userId: 2, token: "ghu_2" }).get("/repos/o/r");
    expect(fake.calls[1]!.headers.get("if-none-match")).toBeNull();
  });

  test("ETag на пагинации помнит и Link следующей страницы", async () => {
    const fake = new FakeGitHub()
      .on("GET", "/p?per_page=100", (c) =>
        c.headers.get("if-none-match") === `"p1"`
          ? { status: 304 }
          : { body: [{ id: 1 }], headers: { etag: `"p1"`, link: `<${API}/p?per_page=100&page=2>; rel="next"` } })
      .on("GET", "/p?per_page=100&page=2", { body: [{ id: 2 }] });
    const gh = client(fake);
    await gh.paginate("/p?per_page=100");
    const again = await gh.paginate<{ id: number }>("/p?per_page=100");
    expect(again.map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("ошибки GitHub → коды ApiError", () => {
  async function failWith(status: number, headers: Record<string, string> = {}, message = "boom") {
    const fake = new FakeGitHub().on("GET", "/x", { status, body: { message }, headers });
    try {
      await client(fake).get("/x");
    } catch (e) {
      return e as GitHubError;
    }
    throw new Error("ожидалась ошибка");
  }

  test("401, 403, 404, 409, 422, 500", async () => {
    expect((await failWith(401)).code).toBe("unauthorized");
    expect((await failWith(403)).code).toBe("forbidden");
    expect((await failWith(404)).code).toBe("not_found");
    expect((await failWith(409)).code).toBe("conflict");
    expect((await failWith(422)).code).toBe("conflict");
    expect((await failWith(500)).code).toBe("github_error");
    const e = await failWith(422, {}, "Reference already exists");
    expect(e.ghMessage).toBe("Reference already exists");
    expect(e.status).toBe(409);
    expect(e.ghStatus).toBe(422);
  });

  test("лимит: 403 с x-ratelimit-remaining=0 → rate_limited и сколько ждать", async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    const e = await failWith(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) });
    expect(e.code).toBe("rate_limited");
    expect(e.status).toBe(429);
    expect(e.retryAfter).toBeGreaterThanOrEqual(110);
    expect(e.retryAfter).toBeLessThanOrEqual(121);
  });

  test("лимит: Retry-After на 403 и 429", async () => {
    expect((await failWith(403, { "retry-after": "30" })).retryAfter).toBe(30);
    const e = await failWith(429, { "retry-after": "7" });
    expect(e.code).toBe("rate_limited");
    expect(e.retryAfter).toBe(7);
  });
});

describe("неизменяемые кеши по sha", () => {
  test("блоб читается один раз на всех пользователей и декодируется из base64", async () => {
    const fake = new FakeGitHub().on("GET", "/repos/Alex011082/chat.0110/git/blobs/abc", { body: { content: b64("Привет\n"), encoding: "base64" } });
    const caches = createCaches();
    expect(await client(fake, { caches }).getBlob(REPO, "abc")).toBe("Привет\n");
    expect(await client(fake, { caches, userId: 2 }).getBlob(REPO, "abc")).toBe("Привет\n");
    expect(fake.calls.length).toBe(1);
  });

  test("добавленные файлы коммита кешируются навсегда", async () => {
    const fake = new FakeGitHub().on("GET", "/repos/Alex011082/chat.0110/commits/c1", {
      body: { files: [{ filename: "a.md", status: "added" }, { filename: "b.md", status: "modified" }] },
    });
    const caches = createCaches();
    expect(await client(fake, { caches }).getCommitAdded(REPO, "c1")).toEqual(["a.md"]);
    expect(await client(fake, { caches, userId: 9 }).getCommitAdded(REPO, "c1")).toEqual(["a.md"]);
    expect(fake.calls.length).toBe(1);
  });
});

describe("данные чата", () => {
  const pr = (n: number, ref: string, body: string | null, extra: object = {}) => ({
    number: n, title: `Чат ${n}`, body, state: "open", draft: true, html_url: `https://github.com/pr/${n}`,
    created_at: "2026-10-23T10:00:00Z", updated_at: "2026-10-23T11:00:00Z", user: { login: "Alex011082" },
    head: { ref, sha: `h${n}`, repo: { full_name: "Alex011082/chat.0110" } }, base: { ref: "main" }, ...extra,
  });

  test("PR чатов: ветка chat/<id> и блок в теле с тем же id", async () => {
    const block = (id: string) => `текст\n<!-- chat0110\nchat_id: ${id}\nschema_version: 1\n-->`;
    const fake = new FakeGitHub().on("GET", /^\/repos\/Alex011082\/chat\.0110\/pulls\?/, {
      body: [
        pr(1, "chat/20261023-k7q2", block("20261023-k7q2")),
        pr(2, "feature/x", block("20261023-aaaa")),
        pr(3, "chat/20261023-bbbb", "без блока"),
        pr(4, "chat/20261023-cccc", block("20261023-dddd")),
        pr(5, "chat/20261023-eeee", block("20261023-eeee"), { head: { ref: "chat/20261023-eeee", sha: "h5", repo: { full_name: "someone/fork" } } }),
      ],
    });
    const prs = await client(fake).listChatPulls(REPO);
    expect(prs.map((p) => p.chatId)).toEqual(["20261023-k7q2"]);
    expect(fake.calls[0]!.url.searchParams.get("state")).toBe("all");
  });

  test("коммиты ветки: до merge-base, с пагинацией, от старых к новым", async () => {
    const commit = (sha: string, login: string | null) => ({
      sha, html_url: `u/${sha}`, author: login ? { login } : null,
      commit: { message: `m ${sha}`, author: { name: `N ${sha}`, date: "2026-10-23T10:00:00Z" }, committer: { date: `2026-10-23T10:0${sha.slice(1)}:00Z` } },
    });
    const fake = new FakeGitHub()
      .on("GET", "/repos/Alex011082/chat.0110/compare/main...chat/20261023-k7q2", { body: { merge_base_commit: { sha: "base" } } })
      .on("GET", /\/commits\?sha=chat%2F20261023-k7q2&per_page=100$/, {
        body: [commit("c4", "claude[bot]"), commit("c3", null)],
        headers: { link: `<${API}/repos/Alex011082/chat.0110/commits?sha=chat%2F20261023-k7q2&per_page=100&page=2>; rel="next"` },
      })
      .on("GET", /\/commits\?sha=chat%2F20261023-k7q2&per_page=100&page=2$/, {
        body: [commit("c2", "Alex011082"), commit("base", "x"), commit("old", "x")],
        headers: { link: `<${API}/repos/Alex011082/chat.0110/commits?sha=chat%2F20261023-k7q2&per_page=100&page=3>; rel="next"` },
      })
      .on("GET", /\/commits\/c\d$/, (c) => ({ body: { files: [{ filename: `f-${c.url.pathname.slice(-2)}.md`, status: "added" }] } }));
    const commits = await client(fake).listBranchCommits(REPO, "main", "20261023-k7q2");
    expect(commits.map((c) => c.sha)).toEqual(["c2", "c3", "c4"]);
    expect(commits[0]).toEqual({ sha: "c2", message: "m c2", login: "Alex011082", name: "N c2", date: "2026-10-23T10:02:00Z", added: ["f-c2.md"], url: "u/c2" });
    expect(commits[1]!.login).toBeNull();
    // Третью страницу не просили: merge-base найден на второй.
    expect(fake.find("GET", /page=3/).length).toBe(0);
  });

  test("папки сообщений нет (404) — пустой список", async () => {
    const fake = new FakeGitHub().on("GET", "/repos/Alex011082/chat.0110/contents/chats/20261023-k7q2/messages", { status: 404, body: { message: "Not Found" } });
    expect(await client(fake).listMessageFiles(REPO, "20261023-k7q2")).toEqual([]);
    expect(fake.calls[0]!.url.searchParams.get("ref")).toBe("chat/20261023-k7q2");
  });
});
