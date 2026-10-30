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

test("остановка сохраняется после перезапуска и не оживляет прежнюю цепочку", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-pause-"));
  try {
    let q = new DispatchStore(join(dir, "q.sqlite"));
    const a = q.register(7, "a/b", "20261026-abcd", "remote:claude", "claude", "Claude");
    const other = q.register(7, "a/b", "20261026-abcd", "remote:codex", "codex", "Codex");
    q.enqueue("first", 7, "a/b", "20261026-abcd", "m", "q", [a.id, a.id]);
    const running = q.claim(a.id)!;
    q.setAutoEnabled(7, a.id, false);
    expect(() => q.setAutoEnabled(8, a.id, true)).toThrow();
    q.prepareAnswer(running.id, a.id, running.claim!, "answer");
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
    expect(q.remoteReady(7, "claude")).toEqual([]);
    expect(q.chain("first",7)?.status).toBe("cancelled");
    q.enqueue("new-owner-request",7,"a/b","20261026-abcd","m2","new question",[a.id]);
    expect(q.claim(a.id)?.step).toBe(0);
    q.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("15 минут ограничивают цепочку: поздний ответ сохраняется без следующего хода", () => {
  const db = new Database(":memory:");
  const q = new DispatchStore(db);
  const a = q.register(7, "a/b", "20261026-abcd", "remote:a", "claude", "Claude");
  const b = q.register(7, "a/b", "20261026-abcd", "remote:b", "codex", "Codex");
  q.enqueue("deadline", 7, "a/b", "20261026-abcd", "m", "q", [a.id, b.id, a.id]);
  const limit = db.query<{ expires_at: number }, []>("SELECT expires_at FROM chain_limits").get()!.expires_at;
  expect(limit - Date.now()).toBeGreaterThan(890_000);
  const t = q.claim(a.id)!;
  db.exec("UPDATE chain_limits SET expires_at=1");
  expect(q.remoteReady(7, "codex", b.id)).toEqual([]);
  expect(q.list(7, "a/b", "20261026-abcd").chains[0]?.status).toBe("expired");
  expect(() => q.heartbeat(t.id, a.id, t.claim!)).toThrow();
  q.prepareAnswer(t.id, a.id, t.claim!, "поздний итог");
  q.finish(t.id, t.claim!, t.answer_id);
  q.finish(t.id, t.claim!, t.answer_id);
  expect(db.query<{text: string}, [string]>("SELECT text FROM tasks WHERE id=?").get(t.id)?.text).toBe("поздний итог");
  expect(q.claim(b.id)).toBeNull();
  expect(q.list(7, "a/b", "20261026-abcd").chains[0]?.status).toBe("expired");
  q.close();
});

test("needs_owner и complete заканчивают обсуждение раньше третьего хода", () => {
  for (const outcome of ["needs_owner", "complete"] as const) {
    const q = new DispatchStore(":memory:");
    const a = q.register(7, "a/b", "20261026-abcd", "remote:a", "claude", "Claude");
    const b = q.register(7, "a/b", "20261026-abcd", "remote:b", "codex", "Codex");
    q.enqueue("outcome", 7, "a/b", "20261026-abcd", "m", "q", [a.id, b.id, a.id]);
    const t = q.claim(a.id)!;
    q.prepareAnswer(t.id, a.id, t.claim!, "готово", outcome);
    expect(() => q.prepareAnswer(t.id, a.id, t.claim!, "готово", "continue")).toThrow();
    q.finish(t.id, t.claim!, t.answer_id);
    q.finish(t.id, t.claim!, t.answer_id);
    expect(q.claim(b.id)).toBeNull();
    expect(q.list(7, "a/b", "20261026-abcd").chains[0]?.status).toBe(outcome === "complete" ? "done" : "needs_owner");
    q.close();
  }
});

test("Stop сохраняет поздний результат только с прежним claim и не запускает соседа", () => {
  const q = new DispatchStore(":memory:");
  const a = q.register(7, "a/b", "20261026-abcd", "remote:a", "claude", "Claude");
  const b = q.register(7, "a/b", "20261026-abcd", "remote:b", "codex", "Codex");
  q.enqueue("stopped", 7, "a/b", "20261026-abcd", "m", "q", [a.id, b.id, a.id]);
  const t = q.claim(a.id)!;
  q.cancel(7, "stopped");
  expect(() => q.prepareAnswer(t.id, b.id, t.claim!, "чужой ответ")).toThrow();
  q.prepareAnswer(t.id, a.id, t.claim!, "поздний ответ");
  q.finish(t.id, t.claim!, t.answer_id);
  expect(q.list(7, "a/b", "20261026-abcd").chains[0]?.status).toBe("cancelled");
  expect(q.claim(b.id)).toBeNull();
  q.close();
});

test("reconnect и перезапуск не продлевают истёкшую цепочку и не оживляют очередь", () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-deadline-"));
  const path = join(dir, "q.sqlite");
  let db = new Database(path);
  let q = new DispatchStore(db);
  try {
    const a = q.register(7, "a/b", "20261026-abcd", "remote:a", "claude", "Claude");
    q.enqueue("expired", 7, "a/b", "20261026-abcd", "m", "q", [a.id]);
    db.exec("UPDATE chain_limits SET expires_at=1");
    q.close();
    db = new Database(path);
    q = new DispatchStore(db);
    q.register(7, "a/b", "20261026-abcd", "remote:a", "claude", "Claude");
    q.setAutoEnabled(7, a.id, false);
    q.setAutoEnabled(7, a.id, true);
    expect(q.remoteReady(7, "claude", a.id)).toEqual([]);
    expect(q.claim(a.id)).toBeNull();
    expect(q.chain("expired", 7)?.status).toBe("expired");
    expect(db.query<{ expires_at: number }, []>("SELECT expires_at FROM chain_limits").get()?.expires_at).toBe(1);
  } finally { q.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("регистрация и touch не выдают готовность транспорта; реальное ожидание видно только пока запрос открыт", () => {
  const q = new DispatchStore(":memory:");
  const a = q.register(7, "a/b", "20261026-abcd", "remote:a", "claude", "Claude");
  const ready = () => q.list(7, "a/b", "20261026-abcd").sessions[0]?.delivery_ready;
  expect(ready()).toBe(false);
  q.touch(a.id);
  expect(ready()).toBe(false);
  const closeOne = q.waiting(a.id, 7);
  const closeTwo = q.waiting(a.id, 7);
  expect(ready()).toBe(true);
  closeOne(); closeOne();
  expect(ready()).toBe(true);
  closeTwo();
  expect(ready()).toBe(false);
  q.close();
});

test("выключение автоответов во время работы останавливает цепочку даже после позднего reply и включения", () => {
  const q=new DispatchStore(":memory:");
  const a=q.register(7,"a/b","20261026-abcd","a","claude","Claude");
  const b=q.register(7,"a/b","20261026-abcd","b","codex","Codex");
  q.enqueue("off",7,"a/b","20261026-abcd","m","q",[a.id,b.id,a.id]);
  const t=q.claim(a.id)!;
  q.setAutoEnabled(7,a.id,false);
  q.prepareAnswer(t.id,a.id,t.claim!,"поздний итог");q.finish(t.id,t.claim!,t.answer_id);
  q.setAutoEnabled(7,a.id,true);
  expect(q.chain("off",7)?.status).toBe("cancelled");
  expect(q.claim(b.id)).toBeNull();expect(q.claim(a.id)).toBeNull();
  q.close();
});

test("sidecar срока не ломает позиционный INSERT chains предыдущего релиза", () => {
  const db=new Database(":memory:");let q=new DispatchStore(db);
  expect(()=>db.exec("INSERT INTO chains VALUES ('legacy-after-rollback',7,'a/b','20261026-abcd','m','q','[]',0,'done')")).not.toThrow();
  q=new DispatchStore(db);
  expect(q.chain("legacy-after-rollback",7)?.expires_at).toBeGreaterThan(Date.now());
  q.close();
});
