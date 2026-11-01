import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export interface PendingTurn {
  task: { id: string; claim: string };
  answer?: string;
  outcome?: string;
  resumed?: boolean;
  [key: string]: unknown;
}
export interface SavedConnection {
  external: string;
  session: string | null;
  current: PendingTurn | null;
}
/** Claim — локальный секрет: сохраняем приватно и не допускаем два процесса одной сессии. */
export class ConnectorState {
  readonly path: string;
  readonly lock: string;
  readonly nonce = randomUUID();
  value: SavedConnection;
  constructor(root: string, key: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const name = createHash("sha256").update(key).digest("hex");
    this.path = join(root, `${name}.json`);
    this.lock = join(root, `${name}.lock`);
    try {
      this.acquire();
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      const old = JSON.parse(readFileSync(this.lock, "utf8"));
      if (!Number.isInteger(old.pid) || old.pid <= 0)
        throw new Error("Invalid connector lock; inspect local state before reconnecting.");
      let alive = true;
      try {
        process.kill(old.pid, 0);
      } catch (e: any) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive) throw new Error("This agent alias already has a running connector on this computer.");
      unlinkSync(this.lock);
      this.acquire();
    }
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      if (
        typeof value.external !== "string" ||
        !(value.session === null || typeof value.session === "string") ||
        !(
          value.current === null ||
          (typeof value.current?.task?.id === "string" && typeof value.current?.task?.claim === "string")
        )
      )
        throw new Error("Invalid connector state; do not replace an unknown active turn.");
      this.value = value;
      if (this.value.current) this.value.current.resumed = true;
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        this.close();
        throw error;
      }
      this.value = { external: randomUUID(), session: null, current: null };
    }
    this.save();
  }
  private acquire() {
    writeFileSync(this.lock, JSON.stringify({ pid: process.pid, nonce: this.nonce }), { flag: "wx", mode: 0o600 });
  }
  save() {
    const tmp = `${this.path}.${this.nonce}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.value), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  close() {
    try {
      if (JSON.parse(readFileSync(this.lock, "utf8")).nonce === this.nonce) unlinkSync(this.lock);
    } catch {
      /* Уже закрыт. */
    }
  }
}
export function dropCancelled(current: PendingTurn | null, taskId: unknown, code: unknown): PendingTurn | null {
  return code === "dispatch_cancelled" && current?.task.id === taskId ? null : current;
}
