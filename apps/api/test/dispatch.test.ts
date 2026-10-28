import { expect, test } from "bun:test";
import { DispatchStore } from "../src/dispatch.ts";
import { Database } from "bun:sqlite";

test("миграция сохраняет участие ранее зарегистрированного исполнителя", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, external TEXT NOT NULL, alias TEXT NOT NULL, name TEXT NOT NULL, author TEXT NOT NULL, model TEXT NOT NULL, seen INTEGER NOT NULL, UNIQUE(uid,repo,chat,external), UNIQUE(uid,repo,chat,alias)); INSERT INTO sessions VALUES ('old',7,'a/b','20261026-abcd','remote:old','claude','Claude','claude','',0)");
  const q = new DispatchStore(db);
  expect(q.session("old", 7).auto_enabled).toBe(1);
  q.enqueue("old-root", 7, "a/b", "20261026-abcd", "m", "question", ["old"]);
  expect(q.claim("old")?.status).toBe("running");
  q.close();
});

test("очередь: один исполнитель, повтор завершения не размножает ходы, финал останавливается", () => {
  const q = new DispatchStore(":memory:");
  const a = q.register(7, "A/B", "20261026-abcd", "session-a", "claude", "Claude");
  const b = q.register(7, "A/B", "20261026-abcd", "session-b", "codex", "Codex");
  q.enqueue("root", 7, "A/B", "20261026-abcd", "message", "question", [a.id, b.id, a.id]);
  q.enqueue("root", 7, "A/B", "20261026-abcd", "message", "question", [a.id, b.id, a.id]);
  expect(q.claim(b.id)).toBeNull();
  const one = q.claim(a.id)!;
  expect(one.step).toBe(0);
  expect(q.claim(a.id)).toBeNull();
  q.finish(one.id, one.claim!, "answer-one");
  q.finish(one.id, one.claim!, "answer-one");
  const two = q.claim(b.id)!;
  expect(two.reply_to).toBe("answer-one");
  q.finish(two.id, two.claim!, "answer-two");
  const three = q.claim(a.id)!;
  expect(three.step).toBe(2);
  q.finish(three.id, three.claim!, "answer-three");
  expect(q.claim(a.id)).toBeNull();
  expect(q.claim(b.id)).toBeNull();
  expect(q.list(7, "A/B", "20261026-abcd").chains[0]?.status).toBe("done");
  q.close();
});

test("чужой claim не завершает ход; отмена не будит следующего", () => {
  const q = new DispatchStore(":memory:");
  const a = q.register(7, "A/B", "20261026-abcd", "a", "claude", "Claude");
  q.enqueue("root", 7, "A/B", "20261026-abcd", "m", "q", [a.id, a.id, a.id]);
  const one = q.claim(a.id)!;
  expect(() => q.finish(one.id, "wrong", "reply")).toThrow();
  q.cancel(7, "root");
  expect(() => q.finish(one.id, one.claim!, "reply")).toThrow();
  expect(q.claim(a.id)).toBeNull();
  q.close();
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("перезапуск сохраняет очередь и не выдаёт занятый ход заново", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-"));
  try {
    let q = new DispatchStore(join(dir, "q.sqlite"));
    const a = q.register(1, "A/B", "20261026-abcd", "a", "клод", "Claude", "claude", "opus");
    const b = q.register(1, "A/B", "20261026-abcd", "b", "кодекс", "Codex", "codex", "sol");
    expect(q.resolve(1, "A/B", "20261026-abcd", ["Клоду", "Соль", "Клоду"])).toEqual([a.id, b.id, a.id]);
    q.enqueue("root", 1, "A/B", "20261026-abcd", "m", "q", [a.id, b.id, a.id]);
    const task = q.claim(a.id)!;
    q.close();
    q = new DispatchStore(join(dir, "q.sqlite"));
    expect(q.claim(a.id)).toBeNull();
    q.finish(task.id, task.claim!, "answer");
    expect(q.claim(b.id)?.step).toBe(1);
    expect(() => q.session(a.id, 2)).toThrow();
    q.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("author ограничен форматом id протокола", () => {
  const q = new DispatchStore(":memory:");
  expect(() => q.register(1, "a/b", "20261026-abcd", "x", "valid", "Name", "a".repeat(33))).toThrow();
  q.close();
});

test("ChatGPT можно адресовать до подключения: задание ждёт в постоянной очереди",()=>{
  const q=new DispatchStore(":memory:");
  const s=q.ensureCloud(7,"A/B","20261026-abcd");
  expect(s.seen).toBe(0);
  expect(q.resolve(7,"A/B","20261026-abcd",["чатжпт"])).toEqual([s.id]);
  q.enqueue("cloud-root",7,"A/B","20261026-abcd","m","question",[s.id]);
  expect(q.cloudTasks()).toEqual([]);
  expect(q.claim(s.id)).toBeNull();
  q.setAutoEnabled(7,s.id,true);
  expect(q.cloudTasks()[0]).toMatchObject({uid:7,repo:"a/b",chat:"20261026-abcd"});
  const t=q.claim(s.id)!;
  expect(q.cloudTasks()).toEqual([]);
  expect(q.ownedTask(t.id,7).claim).toBe(t.claim);
  expect(()=>q.ownedTask(t.id,8)).toThrow();
  q.close();
});

test("пауза сохраняется после перезапуска, удерживает новые ходы и разрешает завершить начатый", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-pause-"));
  try {
    let q = new DispatchStore(join(dir, "q.sqlite"));
    const a = q.register(7, "a/b", "20261026-abcd", "remote:claude", "claude", "Claude");
    const other = q.register(7, "a/b", "20261026-abcd", "remote:codex", "codex", "Codex");
    q.enqueue("first", 7, "a/b", "20261026-abcd", "m", "q", [a.id, a.id]);
    const running = q.claim(a.id)!;
    q.setAutoEnabled(7, a.id, false);
    expect(() => q.setAutoEnabled(8, a.id, true)).toThrow();
    q.finish(running.id, running.claim!, "answer");
    q.close();
    q = new DispatchStore(join(dir, "q.sqlite"));
    expect(q.list(7, "a/b", "20261026-abcd").sessions.find(s => s.id === a.id)?.auto_enabled).toBe(false);
    expect(q.list(7, "a/b", "20261026-abcd").sessions.find(s => s.id === other.id)?.auto_enabled).toBe(true);
    expect(q.claim(a.id)).toBeNull();
    expect(q.remoteReady(7, "claude")).toEqual([]);
    q.register(7, "a/b", "20261026-abcd", "remote:claude", "claude", "Claude");
    expect(q.claim(a.id)).toBeNull();
    q.setAutoEnabled(7, a.id, true);
    expect(q.remoteReady(7, "claude")).toHaveLength(1);
    expect(q.claim(a.id)?.step).toBe(1);
    q.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
