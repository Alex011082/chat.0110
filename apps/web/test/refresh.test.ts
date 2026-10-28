import { expect, test } from "bun:test";
import { RefreshQueue } from "../src/lib/refresh.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("опрос во время долгой загрузки не отбрасывает первый ответ и запускает одно обновление следом", async () => {
  const queue = new RefreshQueue();
  const gate = deferred();
  const next = deferred();
  const shown: number[] = [];
  let calls = 0;
  const load = async () => { const n = ++calls; if (n === 1) await gate.promise; else await next.promise; shown.push(n); };
  const first = queue.run("chat-a", load);
  await Promise.resolve();
  const poll = queue.run("chat-a", load);
  const push = queue.run("chat-a", load);
  expect(calls).toBe(1);
  gate.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(shown).toEqual([1]);
  expect(calls).toBe(2);
  next.resolve();
  await Promise.all([first, poll, push]);
  expect(shown).toEqual([1, 2]);
});

test("другой чат загружается независимо; ошибка не запирает последующие запросы", async () => {
  const queue = new RefreshQueue();
  const gate = deferred();
  const slow = queue.run("chat-a", () => gate.promise);
  let loaded = false;
  await queue.run("chat-b", async () => { loaded = true; });
  expect(loaded).toBe(true);
  await expect(queue.run("chat-b", async () => { throw Error("offline"); })).rejects.toThrow("offline");
  await queue.run("chat-b", async () => {});
  gate.resolve();
  await slow;
});
