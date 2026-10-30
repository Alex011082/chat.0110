import { describe, expect, test } from "bun:test";
import { createAuth } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { SessionStore, importCookieKey } from "../src/session.ts";
import { FakeGitHub } from "./fake-github.ts";

const PUBLIC = "https://chat.0110.digital";

async function setup(over: Record<string, string> = {}) {
  const config = loadConfig({
    CHAT0110_PUBLIC_URL: PUBLIC,
    GITHUB_APP_CLIENT_ID: "Iv1.cid",
    GITHUB_APP_CLIENT_SECRET: "csec",
    GITHUB_APP_SLUG: "chat0110",
    GITHUB_WEBHOOK_SECRET: "wh",
    CHAT0110_COOKIE_KEY: "b".repeat(64),
    ...over,
  });
  const fake = new FakeGitHub()
    .on("POST", "/login/oauth/access_token", { body: { access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_x", refresh_token_expires_in: 15897600 } })
    .on("GET", "/user", { body: { login: "Alex011082", id: 7, name: "Alex", avatar_url: "a" } });
  const sessions = new SessionStore({ key: await importCookieKey(config.cookieKey), dev: false, clientId: config.clientId, clientSecret: config.clientSecret, fetch: fake.fetch });
  const auth = createAuth({ config, sessions, fetch: fake.fetch });
  return { auth, fake, sessions };
}

const setCookies = (res: Response) => res.headers.getSetCookie();

async function startLogin(auth: Awaited<ReturnType<typeof setup>>["auth"]) {
  const res = auth.login();
  const loc = new URL(res.headers.get("location")!);
  const state = loc.searchParams.get("state")!;
  const cookie = setCookies(res)[0]!.split(";")[0]!;
  return { res, loc, state, cookie };
}

describe("вход через GitHub", () => {
  test("/auth/login: state в cookie и редирект на authorize", async () => {
    const { auth } = await setup();
    const { res, loc, state, cookie } = await startLogin(auth);
    expect(res.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("Iv1.cid");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${PUBLIC}/auth/callback`);
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(cookie).toBe(`__Host-chat0110_state=${state}`);
    expect(setCookies(res)[0]).toContain("Max-Age=600");
  });

  test("callback с верным state: обмен кода, сессия, редирект на /", async () => {
    const { auth, fake, sessions } = await setup();
    const { state, cookie } = await startLogin(auth);
    const res = await auth.callback(new Request(`${PUBLIC}/auth/callback?code=abc&state=${state}`, { headers: { cookie } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const exchange = new URLSearchParams(fake.find("POST", "/login/oauth/access_token")[0]!.body);
    expect(exchange.get("code")).toBe("abc");
    expect(exchange.get("redirect_uri")).toBe(`${PUBLIC}/auth/callback`);
    const session = setCookies(res).find((c) => c.startsWith("__Host-chat0110="))!;
    expect(setCookies(res).some((c) => c.startsWith("__Host-chat0110_state=;"))).toBe(true);
    const got = await sessions.read(new Request(PUBLIC, { headers: { cookie: session.split(";")[0]! } }));
    expect(got?.session).toMatchObject({ uid: 7, login: "Alex011082", at: "ghu_x", rt: "ghr_x" });
  });

  test("возврат после установки App без state — на /auth/login, код не обменивается", async () => {
    const { auth, fake } = await setup();
    const res = await auth.callback(new Request(`${PUBLIC}/auth/callback?code=abc&installation_id=5&setup_action=install`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
    expect(fake.calls.length).toBe(0);
  });

  test("state не совпал — 400, код не обменивается (login CSRF)", async () => {
    const { auth, fake } = await setup();
    const { cookie } = await startLogin(auth);
    const res = await auth.callback(new Request(`${PUBLIC}/auth/callback?code=abc&state=чужой`, { headers: { cookie } }));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(fake.calls.length).toBe(0);
  });

  test("логина нет в списке — 403 по-русски, сессии нет", async () => {
    const { auth } = await setup({ CHAT0110_ALLOWED_LOGINS: "someone" });
    const { state, cookie } = await startLogin(auth);
    const res = await auth.callback(new Request(`${PUBLIC}/auth/callback?code=abc&state=${state}`, { headers: { cookie } }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Alex011082");
    expect(setCookies(res).some((c) => c.startsWith("__Host-chat0110=v1."))).toBe(false);
  });

  test("GitHub вернул error в теле токен-эндпоинта — 400, без сессии", async () => {
    const { auth, fake } = await setup();
    fake.on("POST", "/login/oauth/access_token", { body: { error: "bad_verification_code" } });
    const { state, cookie } = await startLogin(auth);
    const res = await auth.callback(new Request(`${PUBLIC}/auth/callback?code=abc&state=${state}`, { headers: { cookie } }));
    expect(res.status).toBe(400);
    expect(fake.find("GET", "/user").length).toBe(0);
  });

  test("пользователь отказался на GitHub — понятная страница", async () => {
    const { auth, fake } = await setup();
    const { state, cookie } = await startLogin(auth);
    const res = await auth.callback(new Request(`${PUBLIC}/auth/callback?error=access_denied&state=${state}`, { headers: { cookie } }));
    expect(res.status).toBe(400);
    expect(fake.calls.length).toBe(0);
  });

  test("logout стирает cookie", async () => {
    const { auth } = await setup();
    const res = auth.logout();
    expect(res.status).toBe(200);
    expect(setCookies(res)[0]).toStartWith("__Host-chat0110=;");
    expect(setCookies(res)[0]).toContain("Max-Age=0");
  });
});

test("OAuth возвращает в чат/дерево и отклоняет внешний или служебный next",async()=>{
 for(const [next,want] of [["/Alex011082/Y-TNG/20261030-pp11","/Alex011082/Y-TNG/20261030-pp11"],["/Alex011082/Y-TNG/~tree?chat=20261030-pp11","/Alex011082/Y-TNG/~tree?chat=20261030-pp11"],["//evil.example/","/"],["/\\evil.example/x","/"],["/api/chats","/"],["/auth/logout","/"],["/A/B/invalid","/"],["/A/B/20261030-pp11%0d%0aX:1","/"]]){
  const {auth}=await setup();const start=auth.login(new Request(`${PUBLIC}/auth/login?next=${encodeURIComponent(next!)}`));
  const state=new URL(start.headers.get("location")!).searchParams.get("state");const cookie=start.headers.getSetCookie().map(x=>x.split(";")[0]).join("; ");
  const response=await auth.callback(new Request(`${PUBLIC}/auth/callback?code=fixture&state=${state}`,{headers:{cookie}}));
  expect(response.headers.get("location")).toBe(want!);
 }
});
