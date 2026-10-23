import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";

const KEY = "a".repeat(64);

function env(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    CHAT0110_PUBLIC_URL: "https://chat.0110.digital",
    GITHUB_APP_CLIENT_ID: "Iv1.test",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_SLUG: "chat0110",
    GITHUB_WEBHOOK_SECRET: "whsec",
    CHAT0110_COOKIE_KEY: KEY,
    ...over,
  };
}

describe("конфигурация", () => {
  test("значения по умолчанию", () => {
    const c = loadConfig(env());
    expect(c.port).toBe(4340);
    expect(c.publicUrl).toBe("https://chat.0110.digital");
    expect(c.publicOrigin).toBe("https://chat.0110.digital");
    expect(c.devCookies).toBe(false);
    expect(c.cookieKey.length).toBe(32);
    expect(c.allowedLogins).toEqual(new Set(["alex011082"]));
    expect(c.webDist).toBe(resolve(import.meta.dir, "../../web/dist"));
    expect(c.appSlug).toBe("chat0110");
  });

  test("порт, список логинов, localhost и хвостовой слэш", () => {
    const c = loadConfig(env({
      CHAT0110_PORT: "5000",
      CHAT0110_PUBLIC_URL: "http://localhost:4340/",
      CHAT0110_ALLOWED_LOGINS: " Alex011082, Bob ,,",
      CHAT0110_WEB_DIST: "/srv/web",
    }));
    expect(c.port).toBe(5000);
    expect(c.publicUrl).toBe("http://localhost:4340");
    expect(c.devCookies).toBe(true);
    expect(c.allowedLogins).toEqual(new Set(["alex011082", "bob"]));
    expect(c.webDist).toBe("/srv/web");
  });

  test("пустой список логинов — значение по умолчанию, а не «никого»", () => {
    expect(loadConfig(env({ CHAT0110_ALLOWED_LOGINS: " " })).allowedLogins).toEqual(new Set(["alex011082"]));
  });

  test("звёздочка открывает вход всем", () => {
    expect(loadConfig(env({ CHAT0110_ALLOWED_LOGINS: "*" })).allowedLogins).toBe("*");
  });

  test("нет секретов — одна понятная ошибка со всеми именами", () => {
    expect(() => loadConfig({})).toThrow(/GITHUB_APP_CLIENT_ID.*GITHUB_APP_CLIENT_SECRET.*GITHUB_APP_SLUG.*GITHUB_WEBHOOK_SECRET.*CHAT0110_COOKIE_KEY.*CHAT0110_PUBLIC_URL/s);
  });

  test("ключ cookie — ровно 64 hex-символа", () => {
    expect(() => loadConfig(env({ CHAT0110_COOKIE_KEY: "abc" }))).toThrow(/CHAT0110_COOKIE_KEY/);
    expect(() => loadConfig(env({ CHAT0110_COOKIE_KEY: "z".repeat(64) }))).toThrow(/CHAT0110_COOKIE_KEY/);
  });

  test("кривой порт и адрес отвергаются", () => {
    expect(() => loadConfig(env({ CHAT0110_PORT: "abc" }))).toThrow(/CHAT0110_PORT/);
    expect(() => loadConfig(env({ CHAT0110_PUBLIC_URL: "chat.0110.digital" }))).toThrow(/CHAT0110_PUBLIC_URL/);
    // Без https cookie уйдёт открытым текстом: разрешаем http только для localhost.
    expect(() => loadConfig(env({ CHAT0110_PUBLIC_URL: "http://chat.0110.digital" }))).toThrow(/CHAT0110_PUBLIC_URL/);
  });
});
