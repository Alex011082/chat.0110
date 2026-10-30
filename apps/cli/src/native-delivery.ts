import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export type NativeSendResult = "not_sent" | "sent_unconfirmed" | "uncertain";
export interface NativeReceipt { state: string; attempts: number }
/** Только доставка в существующий клиент. Здесь нет вызова модели или запуска клиента. */
export class NativeDelivery {
  constructor(private db: Database, private deliver: (text: string, id: string) => Promise<NativeSendResult>, private pause = (ms: number) => Bun.sleep(ms)) {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(`CREATE TABLE IF NOT EXISTS native_delivery (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    )`);
  }
  send(id: string, target: string, text: string): Promise<NativeReceipt> {
    if (!/^[\x21-\x7e]{1,200}$/.test(id) || !target || !text.trim() || text.length > 60_000)
      throw new Error("Неверное задание доставки");
    const fingerprint = createHash("sha256").update(JSON.stringify([target, text])).digest("hex");
    this.db.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO native_delivery(id,fingerprint,state) VALUES (?,?,'queued')").run(id, fingerprint);
      const row = this.db.query<NativeReceipt & { fingerprint: string }, [string]>("SELECT * FROM native_delivery WHERE id=?").get(id)!;
      if (row.fingerprint !== fingerprint) throw new Error("Identity доставки уже связан с другим заданием");
      // После сбоя между записью и отправкой нельзя знать, получил ли клиент сообщение.
      if (row.state === "sending") this.db.query("UPDATE native_delivery SET state='uncertain' WHERE id=? AND state='sending'").run(id);
    }).immediate();
    return this.run(id, text);
  }
  cancel(id: string) { this.db.query("UPDATE native_delivery SET state='cancelled' WHERE id=? AND state!='acknowledged'").run(id); }
  acknowledge(id: string) { this.db.query("UPDATE native_delivery SET state='acknowledged' WHERE id=? AND state IN ('sent_unconfirmed','uncertain')").run(id); }
  private receipt(id: string): NativeReceipt {
    return this.db.query<NativeReceipt, [string]>("SELECT state,attempts FROM native_delivery WHERE id=?").get(id)!;
  }
  private async run(id: string, text: string): Promise<NativeReceipt> {
    while (true) {
      const row = this.receipt(id);
      if (row.state !== "queued") return row;
      if (row.attempts >= 3) {
        this.db.query("UPDATE native_delivery SET state='failed' WHERE id=?").run(id);
        return this.receipt(id);
      }
      const acquired = this.db.query("UPDATE native_delivery SET state='sending',attempts=attempts+1 WHERE id=? AND state='queued' AND attempts<3 RETURNING id").get(id);
      if (!acquired) return this.receipt(id);
      let result: NativeSendResult;
      try { result = await this.deliver(text, id); } catch { result = "uncertain"; }
      // Отмена во время I/O не должна превратиться в повторную отправку.
      const current = this.receipt(id);
      if (current.state !== "sending") return current;
      const state = result === "not_sent" ? current.attempts >= 3 ? "failed" : "queued" : result;
      this.db.query("UPDATE native_delivery SET state=? WHERE id=? AND state='sending'").run(state, id);
      if (state !== "queued") return this.receipt(id);
      await this.pause(250 * 2 ** (current.attempts - 1));
    }
  }
}
