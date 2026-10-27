import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { McpOAuth } from "../src/mcp-oauth.ts";
import { loadConfig } from "../src/config.ts";
import { SessionStore, importCookieKey, type SessionData } from "../src/session.ts";
import { FakeGitHub } from "./fake-github.ts";

const ROOT = "https://chat.0110.digital";
const CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFIER = "a".repeat(43);
const challenge = (s = VERIFIER) => createHash("sha256").update(s).digest("base64url");
const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function setup(over: Partial<SessionData> = {}) {
  const clock = { now: Date.UTC(2026, 9, 27) };
  const key = await importCookieKey(new Uint8Array(32).fill(7));
  const fake = new FakeGitHub();
  const config = loadConfig({ GITHUB_APP_CLIENT_ID: "client", GITHUB_APP_CLIENT_SECRET: "secret", GITHUB_APP_SLUG: "chat", GITHUB_WEBHOOK_SECRET: "hook", CHAT0110_COOKIE_KEY: "07".repeat(32), CHAT0110_PUBLIC_URL: ROOT });
  const sessions = new SessionStore({ key, dev: false, clientId: "client", clientSecret: "secret", fetch: fake.fetch, now: () => clock.now });
  const session: SessionData = { uid: 7, login: "Alex011082", at: "ghu_private_access", rt: "ghr_private_refresh", exp: clock.now + 8 * 3600_000, rexp: clock.now + 180 * 86400_000, ...over };
  const cookie = (await sessions.cookieFor(session)).split(";")[0]!;
  const db = new Database(":memory:"); databases.push(db);
  const oauth = new McpOAuth({ db, key, publicUrl: ROOT, sessions, config, now: () => clock.now });
  const handle = async (path: string, init?: RequestInit) => (await oauth.handle(new Request(ROOT + path, init)))!;
  const register = async (redirect = CALLBACK) => {
    const res = await handle("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
    return { res, body: await res.json() as any };
  };
  const authorizeParams = (client: string) => new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: CALLBACK, scope: "chat:agent", resource: ROOT + "/mcp", code_challenge: challenge(), code_challenge_method: "S256", state: "chatgpt-state" });
  const consent = async (params: URLSearchParams, headers: HeadersInit = { cookie }) => {
    const res = await handle("/oauth/authorize?" + params, { headers });
    const html = await res.text();
    const nonce = html.match(/name="consent_nonce" value="([^"]+)"/)?.[1] ?? "";
    const consentCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-chat0110_mcp_consent="))?.split(";")[0] ?? "";
    return { res, html, nonce, consentCookie };
  };
  const approve = async (params: URLSearchParams) => {
    const c = await consent(params);
    const body = new URLSearchParams(params); body.set("consent_nonce", c.nonce); body.set("decision", "allow");
    return handle("/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ROOT, Cookie: cookie + "; " + c.consentCookie }, body });
  };
  const token = async (params: Record<string, string>) => {
    const res = await handle("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    return { res, body: await res.json() as any };
  };
  const exchange = (client: string, code: string, extra: Record<string, string> = {}) => token({ grant_type: "authorization_code", client_id: client, code, redirect_uri: CALLBACK, resource: ROOT + "/mcp", code_verifier: VERIFIER, ...extra });
  const grant = async () => {
    const client = (await register()).body.client_id as string;
    const res = await approve(authorizeParams(client));
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    return { client, code, ...(await exchange(client, code)) };
  };
  return { oauth, db, key, clock, fake, config, sessions, session, cookie, handle, register, authorizeParams, consent, approve, token, exchange, grant };
}

test("метаданные публикуют отдельный ресурс и OAuth с PKCE, без секретов клиента", async () => {
  const f = await setup();
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    expect(await (await f.handle(path)).json()).toMatchObject({ resource: ROOT + "/mcp", authorization_servers: [ROOT], scopes_supported: ["chat:agent"] });
  }
  expect(await (await f.handle("/.well-known/oauth-authorization-server")).json()).toMatchObject({ issuer: ROOT, token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true });
  expect(await f.oauth.handle(new Request(ROOT + "/other"))).toBeNull();
});

test("DCR принимает только точные callback ChatGPT и ограничивает поля", async () => {
  const f = await setup();
  for (const uri of [CALLBACK, "https://chatgpt.com/connector/oauth/abc-123"]) expect((await f.register(uri)).res.status).toBe(201);
  for (const uri of ["https://evil.test/callback", "https://chatgpt.com.evil.test/connector/oauth/a", CALLBACK + "?evil=1", CALLBACK + "#x", "https://u:p@chatgpt.com/connector/oauth/a", "http://chatgpt.com/connector/oauth/a", "https://chatgpt.com/connector/oauth/../evil", "https://chatgpt.com:444/connector/oauth/a"]) expect((await f.register(uri)).res.status).toBe(400);
  const huge = await f.handle("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(17000) });
  expect(huge.status).toBe(413);
});

test("невалидный authorize отклоняется до входа, валидный сохраняет возврат к согласию", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id;
  const params = f.authorizeParams(client);
  const bad = new URLSearchParams(params); bad.set("code_challenge_method", "plain");
  expect((await f.handle("/oauth/authorize?" + bad)).status).toBe(400);
  const res = await f.handle("/oauth/authorize?" + params);
  const next = new URL(res.headers.get("location")!, ROOT);
  expect(next.pathname).toBe("/auth/login");
  expect(next.searchParams.get("next")).toBe("/oauth/authorize?" + params);
});

test("согласие явное, привязано к Origin, cookie, пользователю и неизменным параметрам", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id; const params = f.authorizeParams(client);
  const c = await f.consent(params);
  expect(c.res.status).toBe(200); expect(c.nonce).not.toBe(""); expect(c.html).toContain("Подключить ChatGPT");
  expect(c.res.headers.get("location")).toBeNull();
  const body = new URLSearchParams(params); body.set("consent_nonce", c.nonce); body.set("decision", "allow");
  const post = (origin: string, cookie: string, data = body) => f.handle("/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: cookie }, body: data });
  expect((await post("https://evil.test", f.cookie + "; " + c.consentCookie)).status).toBe(403);
  expect((await post(ROOT, f.cookie)).status).toBe(403);
  const changed = new URLSearchParams(body); changed.set("state", "changed");
  expect((await post(ROOT, f.cookie + "; " + c.consentCookie, changed)).status).toBe(403);
  const wrong = (await f.sessions.cookieFor({ ...f.session, uid: 8 })).split(";")[0]!;
  expect((await post(ROOT, wrong + "; " + c.consentCookie)).status).toBe(403);
  const res = await post(ROOT, f.cookie + "; " + c.consentCookie);
  expect(res.status).toBe(302);
  expect(new URL(res.headers.get("location")!).searchParams.get("iss")).toBe(ROOT);
  expect((await post(ROOT, f.cookie + "; " + c.consentCookie)).status).toBe(403);
});

test("HTML-согласие сохраняет Origin своей формы и не передаёт referrer другому сайту", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id;
  const c = await f.consent(f.authorizeParams(client));
  // no-referrer превращает Origin навигационного POST в null даже на своём
  // домене. Форма должна пройти строгую проверку, не разрешая Origin: null.
  expect(c.res.headers.get("Referrer-Policy")).toBe("same-origin");
  const body = new URLSearchParams(f.authorizeParams(client));
  body.set("consent_nonce", c.nonce); body.set("decision", "allow");
  const post = (origin?: string) => f.handle("/oauth/authorize", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: f.cookie + "; " + c.consentCookie, ...(origin === undefined ? {} : { Origin: origin }) }, body,
  });
  expect((await post("null")).status).toBe(403);
  expect((await post()).status).toBe(403);
  const approved = await post(ROOT);
  expect(approved.status).toBe(302);
  expect(approved.headers.get("Referrer-Policy")).toBe("no-referrer");
});

test("CSP формы разрешает возврат только к проверенному callback выбранного клиента", async () => {
  const f = await setup();
  for (const callback of [CALLBACK, "https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:4368/callback"]) {
    const client = (await f.register(callback)).body.client_id;
    const params = f.authorizeParams(client); params.set("redirect_uri", callback);
    const consent = await f.consent(params);
    expect(consent.res.status).toBe(200);
    // CSP form-action применяется также к 302 после POST: одного 'self'
    // недостаточно, иначе код выдан, но браузер не возвращается к клиенту.
    expect(consent.res.headers.get("Content-Security-Policy")).toBe(
      `default-src 'none'; form-action 'self' ${callback}; frame-ancestors 'none'; base-uri 'none'`,
    );
  }
});

test("код одноразовый, проверяет PKCE, клиента, redirect и resource", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id;
  const authorization = await f.approve(f.authorizeParams(client));
  const location = new URL(authorization.headers.get("location")!); const code = location.searchParams.get("code")!;
  expect(location.searchParams.get("state")).toBe("chatgpt-state");
  const other = (await f.register("https://chatgpt.com/connector/oauth/other")).body.client_id;
  const invalidBindings: Record<string, string>[] = [{ code_verifier: "b".repeat(43) }, { client_id: other }, { resource: ROOT + "/other" }, { redirect_uri: "https://chatgpt.com/connector/oauth/other" }];
  for (const extra of invalidBindings) {
    expect((await f.exchange(client, code, extra)).res.status).toBe(400);
  }
  const result = await f.exchange(client, code);
  expect(result.res.status).toBe(200); expect(result.body.token_type).toBe("Bearer");
  expect((await f.exchange(client, code)).res.status).toBe(400);
  const principal = await f.oauth.principal(new Request(ROOT + "/mcp", { headers: { Authorization: "Bearer " + result.body.access_token } }));
  expect(principal).toMatchObject({ connectionId: "chatgpt:7", session: { uid: 7, at: "ghu_private_access" } });
});

test("истечение кода и access проверяется, refresh ротируется, replay отзывает grant", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id;
  const auth = await f.approve(f.authorizeParams(client)); const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  f.clock.now += 6 * 60_000; expect((await f.exchange(client, code)).res.status).toBe(400);
  const g = await f.grant();
  f.clock.now += 3600_000 + 1;
  const req = () => new Request(ROOT + "/mcp", { headers: { Authorization: "Bearer " + g.body.access_token } });
  expect(await f.oauth.principal(req())).toBeNull();
  const refresh = () => f.token({ grant_type: "refresh_token", client_id: g.client, refresh_token: g.body.refresh_token, resource: ROOT + "/mcp" });
  const rotated = await refresh(); expect(rotated.res.status).toBe(200); expect(rotated.body.refresh_token).not.toBe(g.body.refresh_token);
  expect((await f.oauth.principal(new Request(ROOT + "/mcp", { headers: { Authorization: "Bearer " + rotated.body.access_token } })))?.connectionId).toBe("chatgpt:7");
  expect((await refresh()).res.status).toBe(400);
  expect(await f.oauth.connection("chatgpt:7")).toBeNull();
});

test("refresh привязан к клиенту и ресурсу, срок подключения ограничен", async () => {
  const f = await setup(); const g = await f.grant(); const other = (await f.register("https://chatgpt.com/connector/oauth/other")).body.client_id;
  for (const over of [{ client_id: other }, { resource: ROOT + "/other" }]) expect((await f.token({ grant_type: "refresh_token", client_id: g.client, refresh_token: g.body.refresh_token, resource: ROOT + "/mcp", ...over })).res.status).toBe(400);
  expect(await f.oauth.connection("chatgpt:7")).not.toBeNull();
  f.clock.now += 31 * 86400_000;
  expect(await f.oauth.connection("chatgpt:7")).toBeNull();
});

test("GitHub credentials зашифрованы, OAuth credentials лежат только хэшами", async () => {
  const f = await setup(); const g = await f.grant();
  const tables = f.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mcp_oauth_%'").all();
  const dump = JSON.stringify(tables.map(({ name }) => f.db.query(`SELECT * FROM ${name}`).all()));
  for (const secret of [f.session.at, f.session.rt, g.body.access_token, g.body.refresh_token, g.code]) expect(dump).not.toContain(secret);
  expect(dump).toContain("v1.");
});

test("connection обновляет GitHub сессию и переживает перезапуск, allowlist применяется заново", async () => {
  const f = await setup(); await f.grant();
  f.fake.on("POST", "/login/oauth/access_token", { body: { access_token: "ghu_fresh", expires_in: 28800, refresh_token: "ghr_fresh", refresh_token_expires_in: 15897600 } });
  f.clock.now += 8 * 3600_000 - 60_000;
  expect((await f.oauth.connection("chatgpt:7"))?.session.at).toBe("ghu_fresh");
  expect(f.fake.calls.length).toBe(1);
  const restarted = new McpOAuth({ db: f.db, key: f.key, publicUrl: ROOT, sessions: f.sessions, config: f.config, now: () => f.clock.now });
  expect((await restarted.connection("chatgpt:7"))?.session.rt).toBe("ghr_fresh");
  expect(f.fake.calls.length).toBe(1);
  f.config.allowedLogins = new Set(["another"]);
  expect(await f.oauth.connection("chatgpt:7")).toBeNull();
});

test("отзыв и disconnect отключают bearer, повторное подключение сохраняет connectionId", async () => {
  const f = await setup(); const g = await f.grant();
  const res = await f.handle("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: g.client, token: g.body.refresh_token }) });
  expect(res.status).toBe(200); expect(await f.oauth.connection("chatgpt:7")).toBeNull();
  await f.grant(); expect((await f.oauth.connection("chatgpt:7"))?.connectionId).toBe("chatgpt:7");
  await f.oauth.disconnect("chatgpt:7"); expect(await f.oauth.connection("chatgpt:7")).toBeNull();
});

test("DCR поддерживает доверенные Claude/Grok и loopback MCP CLI без открытого redirect", async () => {
  const f = await setup();
  for (const uri of ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "https://grok.com/oauth/mcp/callback", "http://127.0.0.1:41937/callback", "http://localhost:41938/oauth/callback"]) expect((await f.register(uri)).res.status).toBe(201);
  for (const uri of ["https://claude.ai/other", "https://grok.com.evil.test/callback", "https://grok.com/callback?next=https://evil.test", "http://127.0.0.2:41937/callback", "http://localhost.evil.test:41937/callback", "http://localhost/callback", "http://localhost:41937/other", "http://127.0.0.1:41937/callback#x"]) expect((await f.register(uri)).res.status).toBe(400);
});

test("параллельный обмен кода выдаёт ровно одну пару токенов", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id;
  const res = await f.approve(f.authorizeParams(client)); const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const result = await Promise.all([f.exchange(client, code), f.exchange(client, code)]);
  expect(result.map((r) => r.res.status).sort()).toEqual([200, 400]);
});

test("отмена согласия не выдаёт код и возвращает state вместе с issuer", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id; const params = f.authorizeParams(client); const c = await f.consent(params);
  params.set("consent_nonce", c.nonce); params.set("decision", "deny");
  const res = await f.handle("/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ROOT, Cookie: f.cookie + "; " + c.consentCookie }, body: params });
  const location = new URL(res.headers.get("location")!);
  expect(location.searchParams.get("error")).toBe("access_denied"); expect(location.searchParams.get("state")).toBe("chatgpt-state"); expect(location.searchParams.get("iss")).toBe(ROOT); expect(location.searchParams.has("code")).toBe(false);
});

test("истёкшее согласие и параметры с дублями отклоняются", async () => {
  const f = await setup(); const client = (await f.register()).body.client_id; const params = f.authorizeParams(client); const c = await f.consent(params);
  f.clock.now += 11 * 60_000;
  params.set("consent_nonce", c.nonce); params.set("decision", "allow");
  const res = await f.handle("/oauth/authorize", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ROOT, Cookie: f.cookie + "; " + c.consentCookie }, body: params });
  expect(res.status).toBe(403);
  const dup = f.authorizeParams(client); dup.append("resource", ROOT + "/other");
  expect((await f.handle("/oauth/authorize?" + dup)).status).toBe(400);
  const malformed = await f.handle("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect(malformed.status).toBe(400);
});

test("параллельный refresh не выдаёт две пары; cookie GitHub и чужой bearer не подходят для MCP", async () => {
  const f = await setup(); const g = await f.grant();
  const refresh = () => f.token({ grant_type: "refresh_token", client_id: g.client, refresh_token: g.body.refresh_token, resource: ROOT + "/mcp" });
  const result = await Promise.all([refresh(), refresh()]);
  expect(result.map((r) => r.res.status).sort()).toEqual([200, 400]);
  for (const req of [new Request(ROOT + "/mcp", { headers: { Cookie: f.cookie } }), new Request(ROOT + "/mcp", { headers: { Authorization: "Bearer " + "x".repeat(43) } }), new Request(ROOT + "/mcp", { headers: { Authorization: "Bearer " + f.session.at } })]) expect(await f.oauth.principal(req)).toBeNull();
});

test("повторы DCR занимают одну строку, неавторизованные клиенты истекают через час", async () => {
  const f = await setup(); const first = await f.register();
  for (let i = 0; i < 100; i++) await f.register();
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_clients").get()!.n).toBe(1);
  f.clock.now += 61 * 60_000;
  const fresh = await f.register();
  expect(fresh.res.status).toBe(201); expect(fresh.body.client_id).not.toBe(first.body.client_id);
});

test("отзыв чужим клиентом не отключает grant; исходный срок GitHub ограничивает OAuth", async () => {
  const f = await setup({ rexp: Date.UTC(2026, 9, 27) + 60 * 60_000 }); const g = await f.grant(); const other = (await f.register("https://chatgpt.com/connector/oauth/other")).body.client_id;
  await f.handle("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: other, token: g.body.refresh_token }) });
  expect(await f.oauth.connection("chatgpt:7")).not.toBeNull();
  f.clock.now += 61 * 60_000;
  expect(await f.oauth.connection("chatgpt:7")).toBeNull();
  expect((await f.token({ grant_type: "refresh_token", client_id: g.client, refresh_token: g.body.refresh_token, resource: ROOT + "/mcp" })).res.status).toBe(400);
});

test("браузер обновляет GitHub раньше MCP: устаревшая копия не тратит refresh повторно после минуты", async () => {
  const f = await setup(); await f.grant();
  const used = new Set<string>();
  f.fake.on("POST", "/login/oauth/access_token", (call) => {
    const rt = new URLSearchParams(call.body).get("refresh_token")!;
    if (used.has(rt)) return { body: { error: "bad_refresh_token" } };
    used.add(rt);
    return { body: { access_token: "ghu_browser_new", expires_in: 28800, refresh_token: "ghr_browser_new", refresh_token_expires_in: 15897600 } };
  });
  f.clock.now += 8 * 3600_000 - 60_000;
  const browser = await f.sessions.read(new Request(ROOT, { headers: { Cookie: f.cookie } }));
  expect(browser?.session.at).toBe("ghu_browser_new");
  f.clock.now += 121_000;
  expect((await f.oauth.connection("chatgpt:7"))?.session.at).toBe("ghu_browser_new");
  expect(f.fake.calls.length).toBe(1);
});

test("MCP обновляет GitHub раньше браузера: старая cookie восстанавливается из SQLite после перезапуска", async () => {
  const f = await setup(); await f.grant();
  f.fake.on("POST", "/login/oauth/access_token", (call) => {
    if (new URLSearchParams(call.body).get("refresh_token") !== "ghr_private_refresh" || f.fake.calls.length > 1) return { body: { error: "bad_refresh_token" } };
    return { body: { access_token: "ghu_mcp_new", expires_in: 28800, refresh_token: "ghr_mcp_new", refresh_token_expires_in: 15897600 } };
  });
  f.clock.now += 8 * 3600_000 - 60_000;
  expect((await f.oauth.connection("chatgpt:7"))?.session.at).toBe("ghu_mcp_new");
  f.clock.now += 121_000;
  const sessions = new SessionStore({ key: f.key, dev: false, clientId: "client", clientSecret: "secret", fetch: f.fake.fetch, now: () => f.clock.now });
  new McpOAuth({ db: f.db, key: f.key, publicUrl: ROOT, sessions, config: f.config, now: () => f.clock.now });
  const browser = await sessions.read(new Request(ROOT, { headers: { Cookie: f.cookie } }));
  expect(browser?.session.at).toBe("ghu_mcp_new");
  expect(browser?.setCookie).toBeDefined();
  expect(f.fake.calls.length).toBe(1);
});

test("DCR повтор одинаковых метаданных идемпотентен, мусор не блокирует новые регистрации", async () => {
  const f = await setup(); const first = await f.register();
  expect((await f.register()).body.client_id).toBe(first.body.client_id);
  for (let i = 0; i < 1000; i++) await f.register("https://chatgpt.com/connector/oauth/client-" + i);
  expect((await f.register("https://chatgpt.com/connector/oauth/legitimate")).res.status).toBe(201);
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_clients").get()!.n).toBeLessThanOrEqual(1000);
});

test("публичный поток DCR не вытесняет авторизованный клиент, короткий TTL касается только неиспользованных", async () => {
  const f = await setup(); const g = await f.grant();
  for (let i = 0; i < 1000; i++) await f.register("https://chatgpt.com/connector/oauth/noise-" + i);
  expect(await f.oauth.connection("chatgpt:7")).not.toBeNull();
  expect(f.db.query("SELECT id FROM mcp_oauth_clients WHERE id = ?").get(g.client)).not.toBeNull();
  f.clock.now += 61 * 60_000;
  await f.register("https://chatgpt.com/connector/oauth/next");
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_clients").get()!.n).toBe(2);
  expect(await f.oauth.connection("chatgpt:7")).not.toBeNull();
});

test("сохранение cookie не создаёт серверную сессию без согласия и не перезаписывает более свежую", async () => {
  const f = await setup();
  await f.sessions.cookieFor({ ...f.session, uid: 8 });
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_accounts").get()!.n).toBe(0);
  await f.grant();
  const newer = { ...f.session, at: "ghu_latest", rt: "ghr_latest", exp: f.session.exp + 7200_000 };
  await Promise.all([
    f.sessions.cookieFor({ ...f.session, at: "ghu_intermediate", rt: "ghr_intermediate", exp: f.session.exp + 3600_000 }),
    f.sessions.cookieFor(newer),
  ]);
  await f.sessions.cookieFor(f.session);
  expect((await f.oauth.connection("chatgpt:7"))?.session.at).toBe("ghu_latest");
  await f.sessions.cookieFor({ ...newer, uid: 8 });
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_accounts").get()!.n).toBe(1);
});

test("disconnect прекращает MCP, но оставляет свежую серверную сессию для старой cookie браузера", async () => {
  const f = await setup(); await f.grant();
  const newest = { ...f.session, at: "ghu_after_refresh", rt: "ghr_after_refresh", exp: f.session.exp + 3600_000 };
  await f.sessions.cookieFor(newest);
  await f.oauth.disconnect("chatgpt:7");
  expect(await f.oauth.connection("chatgpt:7")).toBeNull();
  await f.register("https://chatgpt.com/connector/oauth/cleanup-trigger");
  const browser = await f.sessions.read(new Request(ROOT, { headers: { Cookie: f.cookie } }));
  expect(browser?.session.at).toBe("ghu_after_refresh");
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_accounts").get()!.n).toBe(1);
  f.clock.now = newest.rexp + 1;
  await f.register("https://chatgpt.com/connector/oauth/expiry-cleanup");
  expect(f.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mcp_oauth_accounts").get()!.n).toBe(0);
});
