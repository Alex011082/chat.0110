import {describe, expect, test} from "bun:test";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {replayTimeline, phases, sourceSnapshot} from "./fixture.ts";
import {createReplayHandler, allowedBrowserRequest} from "./server.ts";

describe("Изолированная историческая видеодемонстрация", () => {
 test("фазы сохраняют источник и не выдают replay за новую работу", () => {
  expect(phases.reduce((sum, phase) => sum + phase.seconds, 0)).toBeGreaterThanOrEqual(120);
  expect(phases.reduce((sum, phase) => sum + phase.seconds, 0)).toBeLessThanOrEqual(170);
  expect(sourceSnapshot.sourceHeadSha).toBe("ac6f7cbebcfafed5172ecf1dff75e8d134a887bd");
  const first = replayTimeline(0), last = replayTimeline(phases.length - 1);
  expect(first.items.length).toBeLessThan(last.items.length);
  expect(last.items.filter(item => item.kind === "message").every(item => item.text.includes("Historical replay"))).toBe(true);
  expect(JSON.stringify(last)).toContain("fb7eb23");
  expect(last.chat.can_push).toBe(false);
 });

 test("GET выдаёт только sample; все записи, OAuth и MCP закрыты", async () => {
  const dist = await mkdtemp(join(tmpdir(), "chat0110-replay-"));
  await writeFile(join(dist, "index.html"), "<!doctype html><title>Fixture</title>");
  const {fetch: handle} = await createReplayHandler(dist);
  const req = (path:string, method="GET", origin="http://127.0.0.1:4567") => handle(new Request(origin + path, {method}));
  expect((await req("/api/me")).status).toBe(200);
  expect((await req("/api/chats/Other/Repo/123")).status).toBe(404);
  for (const path of ["/api/chats", "/api/me", "/auth/logout", "/oauth/token", "/mcp", "/__phase"]) {
   expect((await req(path, "POST")).status).toBe(405);
  }
  for (const path of ["/auth/github", "/oauth/authorize", "/mcp", "/.env", "/downloads/secret.zip"]) {
   expect((await req(path)).status).toBe(404);
  }
  expect((await req("/api/me", "GET", "https://example.com")).status).toBe(403);
  expect((await req("/__recording")).headers.get("content-security-policy")).toContain("connect-src 'self'");
 });

 test("браузер не может выйти наружу или обратиться к неизвестному asset/API", () => {
  const origin="http://127.0.0.1:4567", assets=new Set(["/assets/index-123.js"]);
  expect(allowedBrowserRequest(origin+"/assets/index-123.js", "GET", origin, assets)).toBe(true);
  expect(allowedBrowserRequest(origin+"/assets/unknown.js", "GET", origin, assets)).toBe(false);
  expect(allowedBrowserRequest("https://github.com/Alex011082/dream_knesset", "GET", origin, assets)).toBe(false);
  expect(allowedBrowserRequest("http://127.0.0.1:9876/api/me", "GET", origin, assets)).toBe(false);
  expect(allowedBrowserRequest(origin+"/api/me", "POST", origin, assets)).toBe(false);
  expect(allowedBrowserRequest(origin+"/oauth/authorize", "GET", origin, assets)).toBe(false);
  expect(allowedBrowserRequest(origin+"/api/chats?repo=Other/Repo", "GET", origin, assets)).toBe(false);
 });
});
