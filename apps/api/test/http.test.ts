import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/http.ts";
import { SessionStore, importCookieKey, type SessionData } from "../src/session.ts";
import { SseHub } from "../src/sse.ts";
import { FakeGitHub } from "./fake-github.ts";

const PUBLIC = "https://chat.0110.digital";
const R = "/repos/Alex011082/chat.0110";
let dist = "";

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "chat0110-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>chat.0110</title>");
  writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(join(dist, "favicon.svg"), "<svg/>");
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const repoBody = { full_name: "Alex011082/chat.0110", name: "chat.0110", owner: { login: "Alex011082" }, private: false, default_branch: "main", permissions: { push: true } };

async function setup(opts: { allowed?: string; webDist?: string } = {}) {
  const config = loadConfig({
    CHAT0110_PUBLIC_URL: PUBLIC,
    GITHUB_APP_CLIENT_ID: "cid",
    GITHUB_APP_CLIENT_SECRET: "csec",
    GITHUB_APP_SLUG: "chat0110-app",
    GITHUB_WEBHOOK_SECRET: "wh",
    CHAT0110_COOKIE_KEY: "c".repeat(64),
    CHAT0110_WEB_DIST: opts.webDist ?? dist,
    ...(opts.allowed ? { CHAT0110_ALLOWED_LOGINS: opts.allowed } : {}),
  });
  const fake = new FakeGitHub()
    .on("GET", "/user", { body: { login: "Alex011082", id: 7, name: "Alex", avatar_url: "https://avatars.githubusercontent.com/u/7" } })
    .on("GET", R, { body: repoBody });
  const sessions = new SessionStore({ key: await importCookieKey(config.cookieKey), dev: false, clientId: "cid", clientSecret: "csec", fetch: fake.fetch });
  const hub = new SseHub();
  const app = await createApp({ config, fetch: fake.fetch, sessions, hub, now: () => new Date("2026-10-23T10:02:03Z"), rand: () => "m3p8" });
  const session: SessionData = { uid: 7, login: "Alex011082", at: "ghu_x", rt: "ghr_x", exp: Date.now() + 3600_000, rexp: Date.now() + 86400_000 };
  const cookie = (await sessions.cookieFor(session)).split(";")[0]!;
  return { app, fake, cookie, sessions, hub };
}

const get = (path: string, cookie?: string) => new Request(PUBLIC + path, cookie ? { headers: { cookie } } : {});
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(PUBLIC + path, { method: "POST", body: JSON.stringify(body), headers: { origin: PUBLIC, "content-type": "application/json", ...headers } });

describe("маршруты", () => {
  test("GET /health", async () => {
    const { app } = await setup();
    const res = await app(get("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("GET /api/me без сессии — 401 JSON", async () => {
    const { app } = await setup();
    const res = await app(get("/api/me"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  test("GET /api/me с сессией — Me, без кеширования", async () => {
    const { app, cookie, fake } = await setup();
    const res = await app(get("/api/me", cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: "Alex011082", id: 7, name: "Alex", avatar_url: "https://avatars.githubusercontent.com/u/7" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fake.calls[0]!.headers.get("authorization")).toBe("Bearer ghu_x");
  });

  test("логин убрали из списка — сессия больше не работает", async () => {
    const { app, cookie } = await setup({ allowed: "someone" });
    const res = await app(get("/api/me", cookie));
    expect(res.status).toBe(403);
  });

  test("GET /api/config — slug и ссылка на установку App", async () => {
    const { app } = await setup();
    expect(await (await app(get("/api/config"))).json()).toEqual({
      app_slug: "chat0110-app",
      install_url: "https://github.com/apps/chat0110-app/installations/new",
    });
  });

  test("кривые owner/repo/chatId отвергаются до запроса в GitHub", async () => {
    const { app, cookie, fake } = await setup();
    for (const path of [
      "/api/chats/Alex011082/chat.0110/../../x",
      "/api/chats/Alex011082/chat.0110/not-an-id",
      "/api/chats/bad%2Fowner/chat.0110/20261023-k7q2",
      "/api/chats/Alex011082/../20261023-k7q2",
      "/api/chats?repo=Alex011082",
      "/api/chats?repo=a/b/c",
      "/api/events?repo=%2E%2E/x",
    ]) {
      const res = await app(get(path, cookie));
      expect([400, 404]).toContain(res.status);
    }
    expect(fake.calls.length).toBe(0);
  });

  test("GET /api/chats/:owner/:repo/:chatId и …/timeline ведут в ленту", async () => {
    const { app, cookie, fake } = await setup();
    fake.on("GET", /\/pulls\?state=all&head=/, { body: [] });
    for (const path of ["/api/chats/Alex011082/chat.0110/20261023-k7q2", "/api/chats/Alex011082/chat.0110/20261023-k7q2/timeline"]) {
      const res = await app(get(path, cookie));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "not_found" });
    }
  });

  test("POST …/messages — 201 и MessageItem", async () => {
    const { app, cookie, fake } = await setup();
    fake.on("PUT", /\/contents\/chats\/20261023-k7q2\/messages\//, { status: 201, body: { commit: { sha: "c", html_url: "u" } } });
    const res = await app(post("/api/chats/Alex011082/chat.0110/20261023-k7q2/messages", { text: "Привет" }, { cookie }));
    expect(res.status).toBe(201);
    expect((await res.json()).item).toMatchObject({ id: "20261023T100203Z-alex011082-m3p8", text: "Привет", commit_sha: "c" });
  });

  test("лимит GitHub — 429 с Retry-After", async () => {
    const { app, cookie, fake } = await setup();
    fake.on("GET", "/user/installations", { status: 403, body: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-remaining": "0", "retry-after": "42" } });
    const res = await app(get("/api/repos", cookie));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await res.json()).toMatchObject({ code: "rate_limited", retry_after: 42 });
  });

  test("GitHub не принял токен — 401 и cookie стирается", async () => {
    const { app, cookie, fake } = await setup();
    fake.on("GET", "/user", { status: 401, body: { message: "Bad credentials" } });
    const res = await app(get("/api/me", cookie));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  test("неизвестный /api — 404 JSON", async () => {
    const { app, cookie } = await setup();
    const res = await app(get("/api/nope", cookie));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });
});

describe("CSRF", () => {
  test("без Origin, с чужим Origin или не-JSON — отказ", async () => {
    const { app, cookie, fake } = await setup();
    const body = JSON.stringify({ repo: "Alex011082/chat.0110", title: "x" });
    const noOrigin = new Request(PUBLIC + "/api/chats", { method: "POST", body, headers: { cookie, "content-type": "application/json" } });
    expect((await app(noOrigin)).status).toBe(403);
    const evil = new Request(PUBLIC + "/api/chats", { method: "POST", body, headers: { cookie, origin: "https://evil.example", "content-type": "application/json" } });
    expect((await app(evil)).status).toBe(403);
    const form = new Request(PUBLIC + "/api/chats", { method: "POST", body, headers: { cookie, origin: PUBLIC, "content-type": "text/plain" } });
    expect((await app(form)).status).toBe(415);
    const logout = new Request(PUBLIC + "/auth/logout", { method: "POST", headers: { cookie, origin: "https://evil.example" } });
    expect((await app(logout)).status).toBe(403);
    expect(fake.calls.length).toBe(0);
  });

  test("logout с правильным Origin стирает cookie", async () => {
    const { app, cookie } = await setup();
    const res = await app(post("/auth/logout", {}, { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toStartWith("__Host-chat0110=;");
  });

  test("вебхук исключён из проверки Origin (решает подпись)", async () => {
    const { app } = await setup();
    const body = JSON.stringify({ zen: "x" });
    const sig = "sha256=" + createHmac("sha256", "wh").update(body).digest("hex");
    const res = await app(new Request(PUBLIC + "/api/github/webhook", { method: "POST", body, headers: { "x-github-event": "ping", "x-github-delivery": "d", "x-hub-signature-256": sig } }));
    expect(res.status).toBe(200);
    const bad = await app(new Request(PUBLIC + "/api/github/webhook", { method: "POST", body, headers: { "x-github-event": "ping", "x-hub-signature-256": "sha256=00" } }));
    expect(bad.status).toBe(401);
  });
});

describe("SSE /api/events", () => {
  test("без сессии — 401; без доступа к репо — 404 до подписки", async () => {
    const { app, cookie, fake, hub } = await setup();
    expect((await app(get("/api/events?repo=Alex011082/chat.0110"))).status).toBe(401);
    fake.on("GET", "/repos/acme/secret", { status: 404, body: { message: "Not Found" } });
    expect((await app(get("/api/events?repo=acme/secret", cookie))).status).toBe(404);
    expect(hub.count("acme/secret")).toBe(0);
  });

  test("с доступом — поток и timeout(0)", async () => {
    const { app, cookie, hub, fake } = await setup();
    // GitHub не различает регистр в имени репо; канонический full_name берём из ответа.
    fake.on("GET", "/repos/alex011082/chat.0110", { body: repoBody });
    const ctrl = new AbortController();
    const timeouts: number[] = [];
    const req = new Request(PUBLIC + "/api/events?repo=alex011082/chat.0110", { headers: { cookie }, signal: ctrl.signal });
    const res = await app(req, { timeout: (_r, s) => timeouts.push(s) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(timeouts).toEqual([0]);
    expect(hub.count("Alex011082/chat.0110")).toBe(1);
    ctrl.abort();
  });
});

describe("раздача интерфейса", () => {
  test("SPA-маршрут → index.html с CSP и без кеша", async () => {
    const { app } = await setup();
    const res = await app(get("/Alex011082/chat.0110/20261023-k7q2"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>chat.0110</title>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self' https://github.com");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
  });

  test("/assets/* — навсегда в кеш; несуществующий — 404; выход из папки — нет", async () => {
    const { app } = await setup();
    const res = await app(get("/assets/app-abc.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await app(get("/assets/nope.js"))).status).toBe(404);
    expect((await app(get("/assets/..%2F..%2Fetc%2Fpasswd"))).status).toBe(404);
  });

  test("файл из корня сборки отдаётся как есть", async () => {
    const { app } = await setup();
    const res = await app(get("/favicon.svg"));
    expect(await res.text()).toBe("<svg/>");
  });

  test("нет сборки — 503 по-русски", async () => {
    const { app } = await setup({ webDist: join(dist, "missing") });
    const res = await app(get("/"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Интерфейс");
  });
});
