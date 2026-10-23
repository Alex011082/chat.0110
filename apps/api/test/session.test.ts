import { describe, expect, test } from "bun:test";
import { HttpError } from "../src/errors.ts";
import { SessionStore, exchangeToken, importCookieKey, seal, unseal, type SessionData } from "../src/session.ts";
import { FakeGitHub } from "./fake-github.ts";

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 9, 23, 10, 0, 0);
const keyBytes = new Uint8Array(32).fill(7);

const data = (over: Partial<SessionData> = {}): SessionData => ({
  uid: 7, login: "Alex011082", at: "ghu_old", rt: "ghr_old", exp: T0 + 8 * HOUR, rexp: T0 + 180 * 24 * HOUR, ...over,
});

async function store(fake: FakeGitHub, clock: { now: number }, dev = false) {
  return new SessionStore({
    key: await importCookieKey(keyBytes), dev, clientId: "cid", clientSecret: "csec", fetch: fake.fetch, now: () => clock.now,
  });
}

function reqWith(cookie: string): Request {
  return new Request("https://chat.0110.digital/api/me", { headers: { cookie } });
}

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

describe("запечатанная cookie", () => {
  test("seal → unseal возвращает те же данные", async () => {
    const key = await importCookieKey(keyBytes);
    const sealed = await seal(key, data());
    expect(sealed).not.toContain("ghu_old");
    expect(await unseal(key, sealed, T0)).toEqual(data());
  });

  test("подделка, чужой ключ и мусор — нет сессии", async () => {
    const key = await importCookieKey(keyBytes);
    const sealed = await seal(key, data());
    const i = sealed.length - 5;
    const tampered = sealed.slice(0, i) + (sealed[i] === "A" ? "B" : "A") + sealed.slice(i + 1);
    expect(await unseal(key, tampered, T0)).toBeNull();
    expect(await unseal(await importCookieKey(new Uint8Array(32).fill(8)), sealed, T0)).toBeNull();
    expect(await unseal(key, "мусор", T0)).toBeNull();
    expect(await unseal(key, "", T0)).toBeNull();
  });

  test("истёк refresh — нет сессии", async () => {
    const key = await importCookieKey(keyBytes);
    const sealed = await seal(key, data({ rexp: T0 - 1 }));
    expect(await unseal(key, sealed, T0)).toBeNull();
  });

  test("атрибуты cookie: прод — __Host- и Secure, localhost — без них", async () => {
    const clock = { now: T0 };
    const prod = await store(new FakeGitHub(), clock);
    const c = await prod.cookieFor(data());
    expect(c).toStartWith("__Host-chat0110=");
    expect(c).toContain("; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000");
    const dev = await store(new FakeGitHub(), clock, true);
    const d = await dev.cookieFor(data());
    expect(d).toStartWith("chat0110_dev=");
    expect(d).not.toContain("Secure");
    expect(dev.clearCookie()).toContain("Max-Age=0");
  });
});

describe("обмен и обновление токена", () => {
  test("токен-эндпоинт отвечает 200 с error в теле — это ошибка", async () => {
    const fake = new FakeGitHub().on("POST", "/login/oauth/access_token", { body: { error: "bad_verification_code", error_description: "The code passed is incorrect" } });
    const err = await exchangeToken(fake.fetch, { client_id: "c", code: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(String(err.message)).toContain("bad_verification_code");
    expect(fake.calls[0]!.headers.get("accept")).toBe("application/json");
  });

  test("свежий токен не обновляется", async () => {
    const fake = new FakeGitHub();
    const clock = { now: T0 };
    const s = await store(fake, clock);
    const got = await s.read(reqWith(cookiePair(await s.cookieFor(data()))));
    expect(got?.session.at).toBe("ghu_old");
    expect(got?.setCookie).toBeUndefined();
    expect(fake.calls.length).toBe(0);
  });

  test("за 5 минут до истечения — обновление, новая cookie", async () => {
    const fake = new FakeGitHub().on("POST", "/login/oauth/access_token", {
      body: { access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new", refresh_token_expires_in: 15897600 },
    });
    const clock = { now: T0 + 8 * HOUR - 60_000 };
    const s = await store(fake, clock);
    const cookie = cookiePair(await s.cookieFor(data()));
    const got = await s.read(reqWith(cookie));
    expect(got?.session).toMatchObject({ at: "ghu_new", rt: "ghr_new", uid: 7, login: "Alex011082", exp: clock.now + 28800_000 });
    expect(got?.setCookie).toStartWith("__Host-chat0110=");
    const sent = new URLSearchParams(fake.calls[0]!.body);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("ghr_old");
    expect(sent.get("client_secret")).toBe("csec");
  });

  test("параллельные запросы со старой cookie: одно обновление на всех", async () => {
    let calls = 0;
    const fake = new FakeGitHub().on("POST", "/login/oauth/access_token", async () => {
      calls++;
      await Bun.sleep(10);
      return { body: { access_token: `ghu_new${calls}`, expires_in: 28800, refresh_token: `ghr_new${calls}`, refresh_token_expires_in: 15897600 } };
    });
    const clock = { now: T0 + 8 * HOUR - 60_000 };
    const s = await store(fake, clock);
    const cookie = cookiePair(await s.cookieFor(data()));
    const [a, b] = await Promise.all([s.read(reqWith(cookie)), s.read(reqWith(cookie))]);
    expect(calls).toBe(1);
    expect(a?.session.at).toBe("ghu_new1");
    expect(b?.session.at).toBe("ghu_new1");
  });

  test("старая cookie после обновления: в течение минуты отдаётся новая пара", async () => {
    let calls = 0;
    const fake = new FakeGitHub().on("POST", "/login/oauth/access_token", () => {
      calls++;
      // Refresh-токен одноразовый: второй обмен того же ghr_old GitHub бы отверг.
      if (calls > 1) return { body: { error: "bad_refresh_token" } };
      return { body: { access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new", refresh_token_expires_in: 15897600 } };
    });
    const clock = { now: T0 + 8 * HOUR - 60_000 };
    const s = await store(fake, clock);
    const oldCookie = cookiePair(await s.cookieFor(data()));
    await s.read(reqWith(oldCookie));
    clock.now += 30_000;
    const again = await s.read(reqWith(oldCookie));
    expect(calls).toBe(1);
    expect(again?.session.at).toBe("ghu_new");
    expect(again?.setCookie).toBeDefined();
  });

  test("обновление не удалось: пока access жив — работаем с ним, истёк — выход", async () => {
    const fake = new FakeGitHub().on("POST", "/login/oauth/access_token", { body: { error: "bad_refresh_token" } });
    const clock = { now: T0 + 8 * HOUR - 60_000 };
    const s = await store(fake, clock);
    const cookie = cookiePair(await s.cookieFor(data()));
    expect((await s.read(reqWith(cookie)))?.session.at).toBe("ghu_old");
    clock.now = T0 + 8 * HOUR + 1;
    expect(await s.read(reqWith(cookie))).toBeNull();
  });

  test("нет cookie или она битая — нет сессии", async () => {
    const s = await store(new FakeGitHub(), { now: T0 });
    expect(await s.read(new Request("https://x/"))).toBeNull();
    expect(await s.read(reqWith("__Host-chat0110=abc"))).toBeNull();
  });
});
