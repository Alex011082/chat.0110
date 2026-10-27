import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { McpWebhooks, validateCallbackUrl, validateSecret } from "./mcp-webhooks.ts";

const NAME = "chat0110.turn.ready";
const ARGUMENTS = '{"recipient":"chatgpt"}';
const AAD = new TextEncoder().encode("chat0110:mcp-event-secret:v1");
const MAX_TTL = 7 * 24 * 3600_000;
const DEFAULT_TTL = 24 * 3600_000;

interface Subscription {
  id: string; connection_id: string; uid: number; name: string; arguments: string; url: string;
  cipher: string; iv: string; active: number; expires_at: number; last_error: string | null;
}
interface Pending { subscription_id: string; event_id: string; payload: string; attempts: number }
interface Params { name: string; arguments: string; url: string; secret?: string; ttl: number }
export interface McpEventsOptions {
  db: Database;
  key: CryptoKey;
  webhooks?: Pick<McpWebhooks, "verifyCallback" | "sendEvent">;
  now?: () => number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные параметры подписки");
  return value as Record<string, unknown>;
}

function parseParams(value: unknown, withSecret: boolean): Params {
  const p = record(value);
  const args = record(p.arguments);
  const delivery = record(p.delivery);
  if (p.name !== NAME || args.recipient !== "chatgpt" || Object.keys(args).length !== 1 || delivery.mode !== "webhook" || typeof delivery.url !== "string" || (p.cursor !== undefined && p.cursor !== null)) throw new Error("Неподдерживаемая подписка MCP Events");
  const url = validateCallbackUrl(delivery.url).href;
  let secret: string | undefined;
  if (withSecret) {
    if (typeof delivery.secret !== "string") throw new Error("Подписке нужен секрет callback");
    validateSecret(delivery.secret);
    secret = delivery.secret;
  }
  if (p.ttlMs !== undefined && p.ttlMs !== null && (typeof p.ttlMs !== "number" || !Number.isFinite(p.ttlMs) || p.ttlMs <= 0)) throw new Error("Некорректный ttlMs подписки");
  const ttl = Math.min(MAX_TTL, Math.max(60_000, p.ttlMs === null ? MAX_TTL : typeof p.ttlMs === "number" ? p.ttlMs : DEFAULT_TTL));
  return { name: NAME, arguments: ARGUMENTS, url, secret, ttl };
}

export class McpEvents {
  private readonly db: Database;
  private readonly key: CryptoKey;
  private readonly webhooks: Pick<McpWebhooks, "verifyCallback" | "sendEvent">;
  private readonly now: () => number;
  private flushing = false;

  constructor(options: McpEventsOptions) {
    this.db = options.db;
    this.key = options.key;
    this.webhooks = options.webhooks ?? new McpWebhooks();
    this.now = options.now ?? Date.now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_event_subscriptions (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, uid INTEGER NOT NULL,
        name TEXT NOT NULL, arguments TEXT NOT NULL, url TEXT NOT NULL,
        cipher TEXT NOT NULL, iv TEXT NOT NULL, active INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS mcp_event_subscriptions_connection ON mcp_event_subscriptions(connection_id, active, expires_at);
      CREATE TABLE IF NOT EXISTS mcp_event_outbox (
        subscription_id TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL, last_error TEXT,
        PRIMARY KEY(subscription_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS mcp_event_outbox_due ON mcp_event_outbox(state, next_at);
    `);
  }

  async subscribe(connectionId: string, uid: number, value: unknown): Promise<{ id: string; refreshBefore: string; cursor: null; truncated: false }> {
    if (!connectionId || !Number.isSafeInteger(uid) || uid <= 0) throw new Error("Некорректная OAuth connection");
    const p = parseParams(value, true);
    const id = createHash("sha256").update(JSON.stringify([connectionId, uid, p.url, p.name, p.arguments])).digest("hex");
    try { await this.webhooks.verifyCallback(p.url, p.secret!, id); } catch { throw new Error("Не удалось подтвердить callback"); }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.secretAad(id) }, this.key, new TextEncoder().encode(p.secret!));
    const activatedAt = this.now();
    const expires = activatedAt + p.ttl;
    this.db.transaction(() => {
      const previous = this.subscription(id);
      const reconnect = previous && (!previous.active || previous.expires_at <= activatedAt);
      // После проверки нового адреса connection получает один целевой Work-чат.
      // Прежние строки сохраняются для истории, но больше не принимают события.
      this.db.query("UPDATE mcp_event_outbox SET state='cancelled' WHERE state='pending' AND subscription_id IN (SELECT id FROM mcp_event_subscriptions WHERE connection_id=? AND name=? AND arguments=? AND id<>?)").run(connectionId, p.name, p.arguments, id);
      this.db.query("UPDATE mcp_event_subscriptions SET active=0 WHERE connection_id=? AND name=? AND arguments=? AND id<>?").run(connectionId, p.name, p.arguments, id);
      this.db.query(`INSERT INTO mcp_event_subscriptions(id, connection_id, uid, name, arguments, url, cipher, iv, active, expires_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET cipher=excluded.cipher, iv=excluded.iv, active=1, expires_at=excluded.expires_at, last_error=NULL`)
        .run(id, connectionId, uid, p.name, p.arguments, p.url, Buffer.from(ciphertext).toString("base64"), Buffer.from(iv).toString("base64"), expires);
      // Явное восстановление связи возвращает ожидающие задачи в очередь; refresh
      // живой подписки не должен бесконечно обнулять лимит неуспешных попыток.
      if (reconnect) this.db.query("UPDATE mcp_event_outbox SET state='pending', attempts=0, next_at=?, last_error=NULL WHERE subscription_id=? AND state IN ('cancelled', 'failed')").run(activatedAt, id);
    })();
    return { id, refreshBefore: new Date(expires).toISOString(), cursor: null, truncated: false };
  }

  unsubscribe(connectionId: string, value: unknown): void {
    const p = parseParams(value, false);
    this.db.transaction(() => {
      const ids = this.db.query<{ id: string }, [string, string, string, string]>("SELECT id FROM mcp_event_subscriptions WHERE connection_id=? AND name=? AND arguments=? AND url=?").all(connectionId, p.name, p.arguments, p.url);
      for (const { id } of ids) {
        this.db.query("UPDATE mcp_event_subscriptions SET active=0 WHERE id=?").run(id);
        this.db.query("UPDATE mcp_event_outbox SET state='cancelled' WHERE subscription_id=? AND state='pending'").run(id);
      }
    })();
  }

  disconnect(connectionId: string): void {
    this.db.transaction(() => {
      this.db.query("UPDATE mcp_event_subscriptions SET active=0 WHERE connection_id=?").run(connectionId);
      this.db.query("UPDATE mcp_event_outbox SET state='cancelled' WHERE state='pending' AND subscription_id IN (SELECT id FROM mcp_event_subscriptions WHERE connection_id=?)").run(connectionId);
    })();
  }

  hasActive(connectionId: string): boolean {
    return Boolean(this.db.query("SELECT 1 FROM mcp_event_subscriptions WHERE connection_id=? AND active=1 AND expires_at>? LIMIT 1").get(connectionId, this.now()));
  }

  status(connectionId: string): { connected: boolean; last_error: string | null } {
    const error = this.db.query<{ last_error: string | null }, [string]>("SELECT last_error FROM mcp_event_subscriptions WHERE connection_id=? ORDER BY expires_at DESC LIMIT 1").get(connectionId);
    return { connected: this.hasActive(connectionId), last_error: error?.last_error ?? null };
  }

  // Только сохраняет событие. Сеть выполняет flush после повторной авторизации.
  async deliver(connectionId: string, event: unknown): Promise<void> {
    const data = record(event);
    if (typeof data.eventId !== "string" || !/^[\x21-\x7e]{1,200}$/.test(data.eventId) || data.name !== NAME) throw new Error("Некорректное событие MCP");
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload) > 256 * 1024) throw new Error("Событие MCP превышает допустимый размер");
    const active = this.db.query<{ id: string }, [string, number]>("SELECT id FROM mcp_event_subscriptions WHERE connection_id=? AND active=1 AND expires_at>?").all(connectionId, this.now());
    this.db.transaction(() => {
      for (const sub of active) this.db.query("INSERT OR IGNORE INTO mcp_event_outbox(subscription_id, event_id, payload, next_at) VALUES (?, ?, ?, ?)").run(sub.id, data.eventId as string, payload, this.now());
    })();
  }

  async flush(authorize: (connectionId: string, event: unknown) => Promise<boolean>): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const pending = this.db.query<Pending, [number]>("SELECT subscription_id, event_id, payload, attempts FROM mcp_event_outbox WHERE state='pending' AND next_at<=? ORDER BY next_at, rowid LIMIT 10").all(this.now());
      for (const row of pending) {
        const subscription = this.subscription(row.subscription_id);
        if (!subscription || !subscription.active || subscription.expires_at <= this.now()) { this.finish(row, "cancelled"); continue; }
        let event: unknown;
        try { event = JSON.parse(row.payload); } catch { this.finish(row, "failed"); continue; }
        try {
          if (!await authorize(subscription.connection_id, event)) { this.finish(row, "cancelled"); continue; }
          const secret = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(subscription.iv, "base64"), additionalData: this.secretAad(subscription.id) }, this.key, Buffer.from(subscription.cipher, "base64"));
          // Между await подписка могла быть отозвана или истечь.
          const current = this.subscription(subscription.id);
          const queued = this.db.query<{ state: string }, [string, string]>("SELECT state FROM mcp_event_outbox WHERE subscription_id=? AND event_id=?").get(row.subscription_id, row.event_id);
          if (current?.iv !== subscription.iv || current?.cipher !== subscription.cipher) continue;
          if (!current?.active || current.expires_at <= this.now() || queued?.state !== "pending") { this.finish(row, "cancelled"); continue; }
          const result = await this.webhooks.sendEvent(subscription.url, new TextDecoder().decode(secret), subscription.id, event);
          // Ответ старой отправки не должен менять повторно подключённую подписку.
          if (!this.currentDelivery(subscription, row)) continue;
          if (result.accepted) {
            this.finish(row, "done");
            this.db.query("UPDATE mcp_event_subscriptions SET last_error=NULL WHERE id=?").run(subscription.id);
          } else {
            this.failure(row, `Callback: HTTP ${result.status}`, result.status === 410 || result.status === 413);
            if (result.status === 410) {
              this.db.transaction(() => {
                this.db.query("UPDATE mcp_event_subscriptions SET active=0 WHERE id=?").run(subscription.id);
                this.db.query("UPDATE mcp_event_outbox SET state='cancelled' WHERE subscription_id=? AND state='pending'").run(subscription.id);
              })();
            }
          }
        } catch {
          if (this.currentDelivery(subscription, row)) this.failure(row, "Не удалось доставить событие callback", false);
        }
      }
    } finally { this.flushing = false; }
  }

  private secretAad(id: string): Uint8Array<ArrayBuffer> {
    // Шифротекст нельзя перенести в строку другой подписки.
    return new TextEncoder().encode(`${new TextDecoder().decode(AAD)}:${id}`);
  }

  private subscription(id: string): Subscription | null {
    return this.db.query<Subscription, [string]>("SELECT * FROM mcp_event_subscriptions WHERE id=?").get(id);
  }

  private currentDelivery(snapshot: Subscription, row: Pending): boolean {
    const current = this.subscription(snapshot.id);
    if (!current?.active || current.expires_at <= this.now() || current.iv !== snapshot.iv || current.cipher !== snapshot.cipher) return false;
    const queued = this.db.query<{ state: string }, [string, string]>("SELECT state FROM mcp_event_outbox WHERE subscription_id=? AND event_id=?").get(row.subscription_id, row.event_id);
    return queued?.state === "pending";
  }

  private finish(row: Pending, state: string): void {
    this.db.query("UPDATE mcp_event_outbox SET state=? WHERE subscription_id=? AND event_id=?").run(state, row.subscription_id, row.event_id);
  }

  private failure(row: Pending, error: string, terminal: boolean): void {
    const attempt = row.attempts + 1;
    const next = this.now() + Math.min(300_000, 1000 * 2 ** (attempt - 1));
    this.db.query("UPDATE mcp_event_outbox SET state=?, attempts=?, next_at=?, last_error=? WHERE subscription_id=? AND event_id=? AND state='pending'")
      .run(terminal || attempt >= 8 ? "failed" : "pending", attempt, next, error, row.subscription_id, row.event_id);
    this.db.query("UPDATE mcp_event_subscriptions SET last_error=? WHERE id=?").run(error, row.subscription_id);
  }
}
