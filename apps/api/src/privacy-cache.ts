import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { MENTION_ALIASES } from "@chat0110/chat-protocol";
import type { CleanText, CheckedTextStore } from "./privacy.ts";

// Изменение правил, модели, её настроек или словаря обращений автоматически
// лишает старую проверку силы. Новый релиз интерфейса кеш не сбрасывает.
export const PRIVACY_POLICY_VERSION = createHash("sha256")
  .update("chat0110:checked:v1")
  .update(JSON.stringify(MENTION_ALIASES))
  .update(process.env.CHAT0110_PRIVACY_MODEL ?? "pinned-default")
  .update(readFileSync(new URL("./privacy.ts", import.meta.url)))
  .update(readFileSync(new URL("./privacy-worker.ts", import.meta.url)))
  .update(readFileSync(new URL("../privacy/worker.py", import.meta.url)))
  .update(readFileSync(new URL("../privacy/provision.py", import.meta.url)))
  .digest("hex");

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 20_000;

/** Только очищенный текст; исходные значения и обратные соответствия не хранятся. */
export class SqlitePrivacyCache implements CheckedTextStore {
  private fingerprintKey: Buffer;
  private encryptionKey: Buffer;
  constructor(private db: Database, key: Uint8Array, private version = PRIVACY_POLICY_VERSION) {
    this.fingerprintKey = createHmac("sha256", key).update("chat0110:privacy:fingerprint:v1").digest();
    this.encryptionKey = createHmac("sha256", key).update("chat0110:privacy:encryption:v1").digest();
    db.exec(`CREATE TABLE IF NOT EXISTS privacy_checked (
      version TEXT NOT NULL, digest TEXT NOT NULL, sealed TEXT NOT NULL,
      touched INTEGER NOT NULL, PRIMARY KEY(version, digest)
    ); CREATE INDEX IF NOT EXISTS privacy_checked_age ON privacy_checked(touched);`);
  }

  private digest(text: string): string {
    return createHmac("sha256", this.fingerprintKey).update(text).digest("hex");
  }

  get(text: string): CleanText | null {
    const digest = this.digest(text);
    const row = this.db.query<{ sealed: string }, [string, string]>("SELECT sealed FROM privacy_checked WHERE version=? AND digest=?").get(this.version, digest);
    if (!row) return null;
    try {
      const bytes = Buffer.from(row.sealed, "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${this.version}:${digest}`));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const result = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
      if (typeof result.text !== "string" || result.text.length > 120_000 || !result.counts || typeof result.counts !== "object") return null;
      this.db.query("UPDATE privacy_checked SET touched=? WHERE version=? AND digest=?").run(Date.now(), this.version, digest);
      return result;
    } catch {
      // Повреждённая запись — промах, а не разрешение выдать исходный текст.
      return null;
    }
  }

  put(text: string, result: CleanText): void {
    const digest = this.digest(text);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(`${this.version}:${digest}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(result), "utf8"), cipher.final()]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
    this.db.query("INSERT OR REPLACE INTO privacy_checked(version,digest,sealed,touched) VALUES(?,?,?,?)").run(this.version, digest, sealed, Date.now());
    const size = this.db.query<{ rows: number; bytes: number }, []>("SELECT COUNT(*) AS rows, COALESCE(SUM(LENGTH(sealed)),0) AS bytes FROM privacy_checked").get()!;
    if (size.rows > MAX_ROWS || size.bytes > MAX_BYTES) {
      // Удаляется только кеш; оригинальная история в Git не затрагивается.
      this.db.query("DELETE FROM privacy_checked WHERE rowid IN (SELECT rowid FROM privacy_checked ORDER BY touched LIMIT ?)").run(Math.max(1, Math.ceil(size.rows / 4)));
    }
  }
}
