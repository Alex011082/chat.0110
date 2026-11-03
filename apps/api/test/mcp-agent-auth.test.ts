import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/http.ts";
import { loadConfig } from "../src/config.ts";
import { importCookieKey, SessionStore } from "../src/session.ts";
import { testPrivacy } from "./privacy-fixture.ts";
import { FakeGitHub } from "./fake-github.ts";
import { McpCredentials } from "../../cli/src/mcp-auth.ts";

test("agent API принимает наш OAuth, отзыв не утекает в GitHub fallback; legacy gh работает", async () => {
  const base = "https://chat.0110.digital", repo = "Alex011082/chat.0110", chat = "20261023-k7q2";
  const config = loadConfig({ CHAT0110_PUBLIC_URL: base, GITHUB_APP_CLIENT_ID: "client", GITHUB_APP_CLIENT_SECRET: "fixture", GITHUB_APP_SLUG: "chat", GITHUB_WEBHOOK_SECRET: "hook", CHAT0110_COOKIE_KEY: "07".repeat(32) });
  const db = new Database(":memory:"), root = mkdtempSync(join(tmpdir(), "chat0110-mcp-api-"));
  const fake = new FakeGitHub()
    .on("GET", "/user", { body: { login: "Alex011082", id: 7 } })
    .on("GET", /\/repos\/Alex011082\/chat\.0110$/i, { body: { full_name: repo, name: "chat.0110", owner: { login: "Alex011082" }, default_branch: "main", permissions: { push: true } } })
    .on("GET", /\/pulls\?state=all&head=/, { body: [{ number: 1, title: "Chat", body: `<!-- chat0110\nchat_id: ${chat}\n-->`, state: "open", draft: true, head: { ref: `chat/${chat}`, sha: "h", repo: { full_name: repo } }, base: { ref: "main" }, user: { login: "Alex011082" } }] });
  const sessions = new SessionStore({ key: await importCookieKey(config.cookieKey), dev: false, clientId: "client", clientSecret: "fixture", fetch: fake.fetch });
  const cookie = (await sessions.cookieFor({ uid: 7, login: "Alex011082", at: "ghu_fixture", rt: "", exp: Date.now() + 3600000, rexp: Date.now() + 86400000 })).split(";")[0]!;
  const app = await createApp({ config, stateDb: db, sessions, privacy: testPrivacy, fetch: fake.fetch });
  const localFetch = (async (url: any, init?: RequestInit) => app(new Request(url, init))) as typeof fetch;
  const credentials = new McpCredentials(join(root, "oauth.json"), base, localFetch);
  try {
    await credentials.login(async (url) => {
      const consent = await app(new Request(url, { headers: { cookie } }));
      const html = await consent.text();
      const nonce = html.match(/name="consent_nonce" value="([^"]+)"/)![1]!;
      const params = new URLSearchParams(url.search);
      params.set("consent_nonce", nonce); params.set("decision", "allow");
      const allowed = await app(new Request(base + "/oauth/authorize", { method: "POST", headers: { cookie: cookie + "; " + consent.headers.getSetCookie()[0]!.split(";")[0], origin: base, "content-type": "application/x-www-form-urlencoded" }, body: params }));
      expect(allowed.status).toBe(302);
      expect((await fetch(allowed.headers.get("location")!)).status).toBe(200);
    });
    const token = await credentials.token();
    const call = (body: unknown, auth = token, path = "register", kind = "oauth") => app(new Request(`${base}/api/agent/${path}`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json", "x-chat0110-auth": kind }, body: JSON.stringify(body) }));
    const result = await call({ repo, chat_id: chat, session_id: "new-local", alias: "codex-local", name: "Codex", author: "codex" });
    expect(result.status).toBe(200);
    expect(fake.calls.every(c => c.headers.get("authorization") === "Bearer ghu_fixture")).toBe(true);
    const id = (await result.json()).id;
    expect((await call({ session_id: id }, token, "status")).status).toBe(200);
    const count = fake.calls.length;
    for (const bad of ["bad-mcp-token", "x".repeat(43)]) expect((await call({}, bad)).status).toBe(401);
    expect(fake.calls.length).toBe(count);
    db.exec("DELETE FROM mcp_oauth_grants");
    expect((await call({}, token)).status).toBe(401);
    expect(fake.calls.length).toBe(count);
    expect((await call({ repo, chat_id: chat, session_id: "legacy", alias: "legacy", name: "Legacy", author: "codex" }, "ghu_fixture", "register", "legacy")).status).toBe(200);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
