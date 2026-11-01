import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Privacy } from "../src/privacy.ts";
import { SqlitePrivacyCache } from "../src/privacy-cache.ts";

const key = new Uint8Array(32).fill(7);
const raw = "Позвони Ивану Петрову: private@example.org";
const entities = async (text: string) => [{ start: text.indexOf("Ивану"), end: text.indexOf(":"), category: "PERSON" as const }];

test("проверенное сообщение открывается после закрытия БД и перезапуска без модели", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat0110-checked-"));
  const file = join(dir, "state.sqlite");
  try {
    let db = new Database(file);
    const first = new Privacy(entities, new SqlitePrivacyCache(db, key));
    const result = await first.scan(raw);
    expect(result.text).toBe("Позвони [PERSON_1]: [EMAIL_1]");
    db.close();
    const bytes = readFileSync(file);
    for (const value of [raw, "private@example.org", "Позвони", "[PERSON_1]"]) expect(bytes.includes(Buffer.from(value))).toBe(false);
    db = new Database(file);
    let called = false;
    const restarted = new Privacy(async () => { called = true; throw Error("model offline"); }, new SqlitePrivacyCache(db, key));
    expect(await restarted.scan(raw)).toEqual(result);
    expect(await restarted.scan(result.text)).toEqual(result);
    expect(called).toBe(false);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("проверяется только изменённое сообщение, а новая политика требует новой проверки", async () => {
  const db = new Database(":memory:");
  let calls = 0;
  const scan = async () => { calls++; return []; };
  const a = new Privacy(scan, new SqlitePrivacyCache(db, key, "policy-a"));
  await a.object({ items: [{ text: "Первое сообщение" }, { text: "Второе сообщение" }] });
  const b = new Privacy(scan, new SqlitePrivacyCache(db, key, "policy-a"));
  await b.object({ items: [{ text: "Первое сообщение" }, { text: "Второе изменённое сообщение" }] });
  expect(calls).toBe(3);
  const c = new Privacy(scan, new SqlitePrivacyCache(db, key, "policy-b"));
  await c.scan("Первое сообщение");
  expect(calls).toBe(4);
  db.close();
});

test("повреждённый или подменённый кеш не раскрывает текст и не обходит сканер", async () => {
  const db = new Database(":memory:");
  const store = new SqlitePrivacyCache(db, key);
  await new Privacy(async () => [], store).scan("Проверенный текст");
  db.exec("UPDATE privacy_checked SET sealed='broken'");
  await expect(new Privacy(async () => { throw Error("offline"); }, new SqlitePrivacyCache(db, key)).scan("Проверенный текст")).rejects.toMatchObject({ code: "privacy_unavailable" });
  db.close();
});

test("ошибки не записываются; неправильный ключ и смена текста не используют старый результат", async () => {
  const db = new Database(":memory:");
  const store = new SqlitePrivacyCache(db, key);
  await expect(new Privacy(async () => { throw Error("offline"); }, store).scan("Не проверено")).rejects.toMatchObject({ code: "privacy_unavailable" });
  expect((db.query("SELECT COUNT(*) AS n FROM privacy_checked").get() as any).n).toBe(0);
  await new Privacy(async () => [], store).scan("Проверено");
  const wrong = new SqlitePrivacyCache(db, new Uint8Array(32).fill(8));
  await expect(new Privacy(async () => { throw Error("offline"); }, wrong).scan("Проверено")).rejects.toMatchObject({ code: "privacy_unavailable" });
  await expect(new Privacy(async () => { throw Error("offline"); }, store).scan("Проверено иначе")).rejects.toMatchObject({ code: "privacy_unavailable" });
  db.close();
});

test("результат привязан к отпечатку, перестановка строк кеша не подтверждает другой текст", async () => {
  const db = new Database(":memory:");
  const store = new SqlitePrivacyCache(db, key);
  const scanner = new Privacy(async () => [], store);
  await scanner.scan("Первый текст");
  await scanner.scan("Второй текст");
  const rows = db.query<{ digest: string; sealed: string }, []>("SELECT digest,sealed FROM privacy_checked").all();
  db.query("UPDATE privacy_checked SET sealed=? WHERE digest=?").run(rows[0]!.sealed, rows[1]!.digest);
  expect(store.get("Первый текст")).toMatchObject({ text: "Первый текст" });
  expect(store.get("Второй текст")).toBeNull();
  db.close();
});

test("поддельные placeholder не отменяют проверку нового текста", async () => {
  const db = new Database(":memory:");
  let calls = 0;
  const privacy = new Privacy(async () => { calls++; return []; }, new SqlitePrivacyCache(db, key));
  await privacy.scan("[PERSON_1] с новым содержимым");
  expect(calls).toBe(1);
  db.close();
});

test("вытеснение оперативного кеша не заставляет перепроверять старые сообщения", async () => {
  const db = new Database(":memory:");
  let calls = 0;
  const privacy = new Privacy(async () => { calls++; return []; }, new SqlitePrivacyCache(db, key));
  for (let n = 0; n < 600; n++) await privacy.scan(`Сообщение ${n}`);
  await privacy.scan("Сообщение 0");
  expect(calls).toBe(600);
  db.close();
});
