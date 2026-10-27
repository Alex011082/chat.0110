import { describe, expect, test } from "bun:test";
import { McpWebhooks, validateCallbackUrl, validateSecret, type CallbackRequest } from "../src/mcp-webhooks.ts";

// Публичный HMAC-вектор из байтов 0–31, а не секрет, выданный сервисом.
const SECRET = `whsec_${Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64")}`;
const CALLBACK = "https://events.chatgpt.com/mcp/callback?token=opaque";
const PUBLIC = { address: "104.18.0.1", family: 4 as const };

function fixture(response?: { status: number; body: string }) {
  const requests: CallbackRequest[] = [];
  let random = 0;
  const hooks = new McpWebhooks({
    resolve: async () => [PUBLIC],
    request: async (request) => {
      requests.push(request);
      return response ?? { status: 200, body: JSON.stringify({ challenge: JSON.parse(request.body).challenge }) };
    },
    now: () => 1_700_000_000_000,
    randomId: () => `random-${++random}`,
  });
  return { hooks, requests };
}

describe("безопасность callback MCP", () => {
  test("принимает только HTTPS callback на доменах OpenAI без credentials, порта и fragment", () => {
    for (const url of [CALLBACK, "https://chatgpt.com/cb", "https://events.openai.com/cb", "https://openai.com:443/cb"]) {
      expect(validateCallbackUrl(url).protocol).toBe("https:");
    }
    for (const url of [
      "http://chatgpt.com/cb", "https://chatgpt.com:8443/cb", "https://user:pass@chatgpt.com/cb",
      "https://chatgpt.com/cb#fragment", "https://chatgpt.com/cb#", "https://localhost/cb", "https://127.0.0.1/cb",
      "https://chatgpt.com.evil.test/cb", "https://evilchatgpt.com/cb", "https://chatgpt.com./cb", "file:///etc/passwd",
    ]) expect(() => validateCallbackUrl(url)).toThrow();
  });

  test("секрет — строгий whsec base64 с 24–64 байтами ключа", () => {
    expect(validateSecret(SECRET)).toEqual(Buffer.from(Array.from({ length: 32 }, (_, i) => i)));
    for (const value of ["", "whsec_secret", `whsec_${Buffer.alloc(23).toString("base64")}`, `whsec_${Buffer.alloc(65).toString("base64")}`, `${SECRET}garbage`, SECRET.replace("=", "!")]) {
      expect(() => validateSecret(value)).toThrow();
    }
  });

  test("verification передаёт только одноразовый challenge и проверяет его точное эхо", async () => {
    const { hooks, requests } = fixture();
    await hooks.verifyCallback(CALLBACK, SECRET, "subscription-1");
    await hooks.verifyCallback(CALLBACK, SECRET, "subscription-1");
    expect(JSON.parse(requests[0]!.body)).toEqual({ type: "verification", challenge: "random-1" });
    expect(JSON.parse(requests[1]!.body).challenge).not.toBe("random-1");
    expect(requests[0]!.headers["X-MCP-Subscription-Id"]).toBe("subscription-1");
    expect(requests[0]!.address).toEqual(PUBLIC);
    expect(requests[0]!.url.hostname).toBe("events.chatgpt.com");
    expect(requests[0]!.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(requests[0]!.maxResponseBytes).toBe(8192);
  });

  test("не принимает неверное эхо, некорректный JSON или неуспешный HTTP", async () => {
    for (const response of [{ status: 200, body: '{"challenge":"other"}' }, { status: 200, body: "invalid" }, { status: 200, body: "null" }, { status: 302, body: '{"challenge":"random-1"}' }, { status: 500, body: '{"challenge":"random-1"}' }]) {
      await expect(fixture(response).hooks.verifyCallback(CALLBACK, SECRET, "s")).rejects.toThrow();
    }
  });

  test("подпись совпадает с независимым HMAC вектором и точными UTF-8 байтами тела", async () => {
    const requests: CallbackRequest[] = [];
    // Вектор рассчитан отдельно Python hmac; randomId фиксирует только идентификатор доставки.
    const signed = new McpWebhooks({ resolve: async () => [PUBLIC], request: async (request) => { requests.push(request); return { status: 202, body: "" }; }, now: () => 1_700_000_000_000, randomId: () => "delivery-1" });
    expect(await signed.sendEvent(CALLBACK, SECRET, "s", { eventId: "delivery-1", type: "message", text: "Привет" })).toEqual({ status: 202, accepted: true });
    expect(requests[0]!.body).toBe('{"eventId":"delivery-1","type":"message","text":"Привет"}');
    expect(requests[0]!.headers["webhook-id"]).toBe("delivery-1");
    expect(requests[0]!.headers["webhook-timestamp"]).toBe("1700000000");
    expect(requests[0]!.headers["webhook-signature"]).toBe("v1,a7x4NZPb2Xury5kQ41SrjlXcrRBknBRDBQ9erUzSL48=");
  });

  test("сохраняет id события для повторной доставки и не следует redirect", async () => {
    const { hooks, requests } = fixture({ status: 307, body: "" });
    expect(await hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "event-1", type: "message" })).toEqual({ status: 307, accepted: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers["webhook-id"]).toBe("event-1");
  });

  test("отвергает DNS с любым неглобальным адресом до отправки тела", async () => {
    for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:104.18.0.1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2001::1", "2002:7f00:1::", "not-an-ip"]) {
      let sent = false;
      const hooks = new McpWebhooks({ resolve: async () => [PUBLIC, { address, family: address.includes(":") ? 6 : 4 }], request: async () => { sent = true; return { status: 200, body: "" }; } });
      await expect(hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e", type: "event" })).rejects.toThrow();
      expect(sent).toBe(false);
    }
  });

  test("проверяет DNS заново при каждой доставке и закрепляет выбранный IP", async () => {
    let lookups = 0;
    let sent = 0;
    const hooks = new McpWebhooks({ resolve: async () => ++lookups === 1 ? [PUBLIC] : [{ address: "127.0.0.1", family: 4 }], request: async (request) => { sent++; expect(request.address).toEqual(PUBLIC); return { status: 204, body: "" }; } });
    expect((await hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e", type: "event" })).accepted).toBe(true);
    await expect(hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e", type: "event" })).rejects.toThrow();
    expect(sent).toBe(1);
  });

  test("принимает глобальный IPv6 и не принимает пустой DNS или несовпадение family", async () => {
    const hooks = new McpWebhooks({ resolve: async () => [{ address: "2606:4700::6812:1", family: 6 }], request: async () => ({ status: 204, body: "" }) });
    expect((await hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e" })).accepted).toBe(true);
    for (const addresses of [[], [{ address: "104.18.0.1", family: 6 as const }]]) {
      await expect(new McpWebhooks({ resolve: async () => addresses }).sendEvent(CALLBACK, SECRET, "s", { eventId: "e" })).rejects.toThrow();
    }
  });

  test("ограничивает тело и ответ, запрещает переносы строк в идентификаторах", async () => {
    const { hooks, requests } = fixture();
    await expect(hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e", text: "я".repeat(140_000) })).rejects.toThrow();
    await expect(hooks.sendEvent(CALLBACK, SECRET, "s\r\nx: y", { eventId: "e" })).rejects.toThrow();
    await expect(hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "x\ny" })).rejects.toThrow();
    expect(requests).toHaveLength(0);
    await expect(fixture({ status: 200, body: "x".repeat(8193) }).hooks.verifyCallback(CALLBACK, SECRET, "s")).rejects.toThrow();
  });

  test("не отправляет событие без eventId и обновляет подпись при повторе", async () => {
    let seconds = 1_700_000_000;
    const requests: CallbackRequest[] = [];
    const hooks = new McpWebhooks({ resolve: async () => [PUBLIC], now: () => seconds++ * 1000, request: async (request) => { requests.push(request); return { status: 204, body: "" }; } });
    for (const event of [null, {}, { eventId: "" }, { id: "wrong-field" }]) await expect(hooks.sendEvent(CALLBACK, SECRET, "s", event)).rejects.toThrow();
    expect(requests).toHaveLength(0);
    await hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e" });
    await hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e" });
    expect(requests[0]!.body).toBe(requests[1]!.body);
    expect(requests[0]!.headers["webhook-id"]).toBe(requests[1]!.headers["webhook-id"]);
    expect(requests[0]!.headers["webhook-signature"]).not.toBe(requests[1]!.headers["webhook-signature"]);
  });

  test("принимает ровно 256 KiB UTF-8, отклоняет следующий байт", async () => {
    const { hooks, requests } = fixture({ status: 204, body: "" });
    const overhead = Buffer.byteLength(JSON.stringify({ eventId: "e", text: "" }));
    const text = "a".repeat(256 * 1024 - overhead);
    expect((await hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e", text })).accepted).toBe(true);
    await expect(hooks.sendEvent(CALLBACK, SECRET, "s", { eventId: "e", text: text + "a" })).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  test("общий десятисекундный deadline обрывает DNS и зависший transport", async () => {
    let resolveDns!: (addresses: typeof PUBLIC[]) => void;
    let sent = false;
    let aborted = false;
    const dns = new McpWebhooks({ resolve: () => new Promise((resolve) => { resolveDns = resolve; }), request: async () => { sent = true; return { status: 200, body: "" }; } });
    const stalled = new McpWebhooks({ resolve: async () => [PUBLIC], request: (request) => new Promise((_resolve, reject) => { request.signal.addEventListener("abort", () => { aborted = true; reject(new Error("timeout")); }); }) });
    const results = await Promise.allSettled([
      dns.sendEvent(CALLBACK, SECRET, "s", { eventId: "e" }),
      stalled.sendEvent(CALLBACK, SECRET, "s", { eventId: "e" }),
    ]);
    for (const result of results) expect(result.status).toBe("rejected");
    resolveDns([PUBLIC]);
    await Promise.resolve();
    expect(sent).toBe(false);
    expect(aborted).toBe(true);
  }, 15_000);
});
