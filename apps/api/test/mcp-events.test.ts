import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { McpEvents } from "../src/mcp-events.ts";
import { importCookieKey } from "../src/session.ts";

const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const params = { name: "chat0110.turn.ready", arguments: { recipient: "chatgpt" }, delivery: { mode: "webhook", url: "https://events.chatgpt.com/callback", secret: SECRET }, cursor: null };
const event = { eventId: "event-1", name: "chat0110.turn.ready", timestamp: "2026-10-27T00:00:00.000Z", data: { repo: "owner/repo" }, cursor: null };

async function fixture() {
  const db = new Database(":memory:");
  const key = await importCookieKey(new Uint8Array(32));
  let now = Date.UTC(2026, 9, 27);
  let status = 202;
  let verificationFails = false;
  const verified: unknown[][] = [];
  const delivered: unknown[][] = [];
  const webhooks = {
    verifyCallback: async (...args: unknown[]) => { verified.push(args); if (verificationFails) throw new Error("secret url must never be exposed"); },
    sendEvent: async (...args: unknown[]) => { delivered.push(args); return { status, accepted: status >= 200 && status < 300 }; },
  };
  const events = new McpEvents({ db, key, webhooks, now: () => now });
  return { db, key, events, webhooks, verified, delivered, advance: (ms: number) => { now += ms; }, setStatus: (value: number) => { status = value; }, failVerification: () => { verificationFails = true; } };
}

describe("устойчивые подписки MCP Events", () => {
  test("проверяет callback до активации и хранит только зашифрованный секрет", async () => {
    const f = await fixture();
    expect(f.events.hasActive("c")).toBe(false);
    const sub = await f.events.subscribe("c", 42, params);
    expect(f.verified).toHaveLength(1);
    expect(f.events.hasActive("c")).toBe(true);
    expect(sub).toMatchObject({ cursor: null, truncated: false });
    expect(Date.parse(sub.refreshBefore!)).toBe(Date.UTC(2026, 9, 28));
    expect(JSON.stringify(f.db.query("SELECT * FROM mcp_event_subscriptions").all())).not.toContain(SECRET);
    await f.events.deliver("c", event);
    expect(f.delivered).toHaveLength(0);
    await f.events.flush(async () => true);
    expect(f.delivered[0]?.[1]).toBe(SECRET);
    expect(f.delivered[0]?.[3]).toEqual(event);
  });

  test("id стабилен, refresh продлевает TTL; другая OAuth connection изолирована", async () => {
    const f = await fixture();
    const first = await f.events.subscribe("c", 42, { ...params, ttlMs: 60_000 });
    f.advance(30_000);
    const refreshed = await f.events.subscribe("c", 42, { ...params, ttlMs: 3600_000 });
    expect(refreshed.id).toBe(first.id);
    expect(Date.parse(refreshed.refreshBefore!)).toBe(Date.UTC(2026, 9, 27) + 3_630_000);
    expect((await f.events.subscribe("other", 42, params)).id).not.toBe(first.id);
    f.advance(3600_001);
    expect(f.events.hasActive("c")).toBe(false);
  });

  test("неверные arguments, delivery, cursor и TTL не активируют подписку", async () => {
    const f = await fixture();
    for (const value of [{ ...params, name: "other" }, { ...params, arguments: { recipient: "other" } }, { ...params, arguments: { recipient: "chatgpt", repo: "x" } }, { ...params, cursor: "unsupported" }, { ...params, delivery: { ...params.delivery, mode: "poll" } }, { ...params, ttlMs: -1 }]) await expect(f.events.subscribe("c", 42, value)).rejects.toThrow();
    f.failVerification();
    await expect(f.events.subscribe("c", 42, params)).rejects.toThrow("Не удалось подтвердить callback");
    expect(f.events.hasActive("c")).toBe(false);
  });

  test("unsubscribe идемпотентен, привязан к connection и отменяет pending", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    f.events.unsubscribe("other", params);
    expect(f.events.hasActive("c")).toBe(true);
    const { secret: _secret, ...delivery } = params.delivery;
    f.events.unsubscribe("c", { ...params, delivery });
    f.events.unsubscribe("c", { ...params, delivery });
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(0);
    expect(f.events.status("c").connected).toBe(false);
  });

  test("outbox переживает новый экземпляр и не дублирует eventId", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    await f.events.deliver("c", event);
    const restarted = new McpEvents({ db: f.db, key: f.key, webhooks: f.webhooks, now: () => Date.UTC(2026, 9, 27) });
    await restarted.flush(async () => true);
    await restarted.flush(async () => true);
    expect(f.delivered).toHaveLength(1);
    await f.events.deliver("c", event);
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(1);
  });

  test("transient delivery повторяется с задержкой и тем же eventId", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    f.setStatus(503);
    await f.events.flush(async () => true);
    expect(f.events.status("c").last_error).toBe("Callback: HTTP 503");
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(1);
    f.advance(1000);
    f.setStatus(202);
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(2);
    expect(f.delivered[1]?.[3]).toEqual(event);
    expect(f.events.status("c").last_error).toBeNull();
  });

  test("410/413, истёкшая подписка и потерянное разрешение не повторяются", async () => {
    for (const reason of [410, 413, "expired", "revoked"] as const) {
      const f = await fixture();
      await f.events.subscribe("c", 42, { ...params, ttlMs: 60_000 });
      await f.events.deliver("c", event);
      if (typeof reason === "number") f.setStatus(reason);
      if (reason === "expired") f.advance(60_001);
      await f.events.flush(async () => reason !== "revoked");
      f.advance(30_000);
      await f.events.flush(async () => true);
      expect(f.delivered).toHaveLength(typeof reason === "number" ? 1 : 0);
    }
  });

  test("до успешной verification не сохраняет app data в outbox", async () => {
    const f = await fixture();
    let confirmed!: () => void;
    f.webhooks.verifyCallback = async () => new Promise<void>((resolve) => { confirmed = resolve; });
    const subscribing = f.events.subscribe("c", 42, params);
    expect(f.events.hasActive("c")).toBe(false);
    await f.events.deliver("c", event);
    expect(f.db.query("SELECT * FROM mcp_event_outbox").all()).toHaveLength(0);
    confirmed();
    await subscribing;
    expect(f.events.hasActive("c")).toBe(true);
  });

  test("после восьми неуспешных попыток оставляет terminal запись без повторов", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    f.setStatus(503);
    for (let i = 0; i < 9; i++) { await f.events.flush(async () => true); f.advance(300_000); }
    expect(f.delivered).toHaveLength(8);
    expect(f.db.query("SELECT state, attempts FROM mcp_event_outbox").get()).toEqual({ state: "failed", attempts: 8 });
  });

  test("один flush берёт не больше десяти событий, параллельный вызов не дублирует", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    for (let i = 0; i < 12; i++) await f.events.deliver("c", { ...event, eventId: `event-${i}` });
    await Promise.all([f.events.flush(async () => true), f.events.flush(async () => true)]);
    expect(f.delivered).toHaveLength(10);
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(12);
  });

  test("unsubscribe во время повторной авторизации отменяет уже выбранное событие", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    await f.events.flush(async () => { f.events.unsubscribe("c", params); return true; });
    expect(f.delivered).toHaveLength(0);
  });

  test("соблюдает короткий ttlMs и ограничивает максимальный срок", async () => {
    const f = await fixture();
    expect(Date.parse((await f.events.subscribe("c", 42, { ...params, ttlMs: 3600_000 })).refreshBefore)).toBe(Date.UTC(2026, 9, 27) + 3600_000);
    expect(Date.parse((await f.events.subscribe("c", 42, { ...params, ttlMs: 1 })).refreshBefore)).toBe(Date.UTC(2026, 9, 27) + 60_000);
    for (const ttlMs of [null, 30 * 24 * 3600_000]) expect(Date.parse((await f.events.subscribe("c", 42, { ...params, ttlMs })).refreshBefore)).toBe(Date.UTC(2026, 9, 27) + 7 * 24 * 3600_000);
  });

  test("HTTP 410 отключает подписку и отменяет остальные события, HTTP 413 сохраняет её", async () => {
    for (const status of [410, 413]) {
      const f = await fixture();
      await f.events.subscribe("c", 42, params);
      await f.events.deliver("c", event);
      await f.events.deliver("c", { ...event, eventId: "event-2" });
      f.setStatus(status);
      await f.events.flush(async () => true);
      expect(f.events.status("c").connected).toBe(status !== 410);
      expect(f.events.status("c").last_error).toBe(`Callback: HTTP ${status}`);
      expect(f.delivered).toHaveLength(status === 410 ? 1 : 2);
    }
  });

  test("повторное подключение восстанавливает ожидающее событие после unsubscribe", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    f.events.unsubscribe("c", params);
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    await f.events.flush(async () => true);
    expect(f.events.status("c").connected).toBe(true);
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]?.[3]).toEqual(event);
  });

  test("повторное подключение восстанавливает событие после истечения TTL или HTTP 410", async () => {
    for (const reason of ["expired", "gone"] as const) {
      const f = await fixture();
      await f.events.subscribe("c", 42, { ...params, ttlMs: 60_000 });
      await f.events.deliver("c", event);
      if (reason === "expired") f.advance(60_001);
      else f.setStatus(410);
      await f.events.flush(async () => true);
      const beforeReconnect = f.delivered.length;
      f.setStatus(202);
      await f.events.subscribe("c", 42, params);
      await f.events.deliver("c", event);
      await f.events.flush(async () => true);
      expect(f.delivered).toHaveLength(beforeReconnect + 1);
      expect(f.db.query("SELECT state, attempts FROM mcp_event_outbox").get()).toEqual({ state: "done", attempts: 0 });
    }
  });

  test("повторное подключение сохраняет завершённые события и снова проверяет доступ к восстановленным", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    await f.events.flush(async () => true);
    await f.events.deliver("c", { ...event, eventId: "still-waiting" });
    f.events.unsubscribe("c", params);
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    let authorizations = 0;
    await f.events.flush(async () => { authorizations++; return false; });
    expect(f.delivered).toHaveLength(1);
    expect(authorizations).toBe(1);
    expect(f.db.query("SELECT state FROM mcp_event_outbox WHERE event_id=?").get(event.eventId)).toEqual({ state: "done" });
  });

  test("обычный refresh активной подписки не перезапускает восемь исчерпанных попыток", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    f.setStatus(503);
    for (let i = 0; i < 8; i++) { await f.events.flush(async () => true); f.advance(300_000); }
    await f.events.subscribe("c", 42, params);
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(8);
    expect(f.db.query("SELECT state, attempts FROM mcp_event_outbox").get()).toEqual({ state: "failed", attempts: 8 });
  });

  test("новый подтверждённый callback заменяет предыдущий целевой Work-чат", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    const latest = { ...params, delivery: { ...params.delivery, url: "https://events.chatgpt.com/another-chat" } };
    await f.events.subscribe("c", 42, latest);
    await f.events.deliver("c", event);
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]?.[0]).toBe(latest.delivery.url);
    expect(f.db.query("SELECT COUNT(*) AS total, SUM(active) AS active FROM mcp_event_subscriptions").get()).toEqual({ total: 2, active: 1 });
    expect(f.db.query("SELECT state FROM mcp_event_outbox WHERE state='cancelled'").all()).toHaveLength(1);
  });

  test("неподтверждённый новый callback не отключает предыдущий Work-чат", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    f.failVerification();
    await expect(f.events.subscribe("c", 42, { ...params, delivery: { ...params.delivery, url: "https://events.chatgpt.com/unconfirmed" } })).rejects.toThrow();
    await f.events.deliver("c", event);
    await f.events.flush(async () => true);
    expect(f.events.hasActive("c")).toBe(true);
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]?.[0]).toBe(params.delivery.url);
  });

  test("disconnect отключает только свою connection и сохраняет историю", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.subscribe("other", 42, params);
    await f.events.deliver("c", event);
    await f.events.deliver("other", event);
    f.events.disconnect("c");
    f.events.disconnect("c");
    await f.events.flush(async () => true);
    expect(f.events.hasActive("c")).toBe(false);
    expect(f.events.hasActive("other")).toBe(true);
    expect(f.delivered).toHaveLength(1);
    expect(f.db.query("SELECT COUNT(*) AS total FROM mcp_event_subscriptions").get()).toEqual({ total: 2 });
    expect(f.db.query("SELECT COUNT(*) AS total FROM mcp_event_outbox").get()).toEqual({ total: 2 });
  });

  test("старый HTTP 410 после reconnect не отключает новую версию подписки", async () => {
    const f = await fixture();
    await f.events.subscribe("c", 42, params);
    await f.events.deliver("c", event);
    let finishOld!: (result: { status: number; accepted: boolean }) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    f.webhooks.sendEvent = async (...args: unknown[]) => {
      f.delivered.push(args);
      started();
      return new Promise((resolve) => { finishOld = resolve; });
    };
    const flush = f.events.flush(async () => true);
    await sending;
    f.events.unsubscribe("c", params);
    const newSecret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;
    await f.events.subscribe("c", 42, { ...params, delivery: { ...params.delivery, secret: newSecret } });
    finishOld({ status: 410, accepted: false });
    await flush;
    expect(f.events.status("c")).toEqual({ connected: true, last_error: null });
    expect(f.db.query("SELECT state, attempts FROM mcp_event_outbox").get()).toEqual({ state: "pending", attempts: 0 });
    f.webhooks.sendEvent = async (...args: unknown[]) => { f.delivered.push(args); return { status: 202, accepted: true }; };
    await f.events.flush(async () => true);
    expect(f.delivered).toHaveLength(2);
    expect(f.delivered[1]?.[1]).toBe(newSecret);
  });

  test("старый успешный ответ или ошибка после reconnect не меняют новый outbox", async () => {
    for (const outcome of ["success", "error"] as const) {
      const f = await fixture();
      await f.events.subscribe("c", 42, params);
      await f.events.deliver("c", event);
      let complete!: () => void;
      let started!: () => void;
      const sending = new Promise<void>((resolve) => { started = resolve; });
      f.webhooks.sendEvent = async () => new Promise((resolve, reject) => {
        complete = () => outcome === "success" ? resolve({ status: 202, accepted: true }) : reject(new Error("old transport error"));
        started();
      });
      const flush = f.events.flush(async () => true);
      await sending;
      f.events.unsubscribe("c", params);
      await f.events.subscribe("c", 42, params);
      complete();
      await flush;
      expect(f.events.status("c")).toEqual({ connected: true, last_error: null });
      expect(f.db.query("SELECT state, attempts FROM mcp_event_outbox").get()).toEqual({ state: "pending", attempts: 0 });
    }
  });
});
