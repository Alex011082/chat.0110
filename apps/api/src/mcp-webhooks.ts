import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8192;
const MAX_EVENT_BYTES = 256 * 1024;

export interface CallbackAddress { address: string; family: 4 | 6 }
export interface CallbackRequest {
  url: URL;
  address: CallbackAddress;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
  signal: AbortSignal;
}
export interface CallbackResponse { status: number; body: string }
export interface McpWebhooksOptions {
  resolve?: (hostname: string) => Promise<CallbackAddress[]>;
  request?: (request: CallbackRequest) => Promise<CallbackResponse>;
  now?: () => number;
  randomId?: () => string;
}

export function validateCallbackUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Некорректный callback URL"); }
  const owned = ["chatgpt.com", "openai.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value) || value.includes("#") || !owned || url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || value.split("/")[2]?.includes("@")) {
    throw new Error("Callback должен использовать HTTPS на домене OpenAI без credentials, fragment и нестандартного порта");
  }
  return url;
}

export function validateSecret(value: string): Buffer {
  const encoded = value.startsWith("whsec_") ? value.slice(6) : "";
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Некорректный секрет callback");
  const key = Buffer.from(encoded, "base64");
  if (key.length < 24 || key.length > 64 || key.toString("base64") !== encoded) throw new Error("Некорректный секрет callback");
  return key;
}

function globalAddress(value: CallbackAddress): boolean {
  if (isIP(value.address) !== value.family) return false;
  if (value.family === 4) {
    const [a = 0, b = 0, c = 0] = value.address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (value.address.includes("%")) return false;
  const expanded = new URL(`http://[${value.address}]/`).hostname.slice(1, -1);
  const groups = expanded.split(":");
  const first = Number.parseInt(groups[0] || "0", 16);
  const second = Number.parseInt(groups[1] || "0", 16);
  // Только global-unicast: это также закрывает IPv4-mapped, NAT64 и локальные IPv6.
  return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) && first !== 0x2002 && !(first === 0x3fff && second <= 0xfff);
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,200}$/.test(value)) throw new Error("Некорректный идентификатор callback");
  return value;
}

function pinnedRequest(input: CallbackRequest): Promise<CallbackResponse> {
  return new Promise((resolve, reject) => {
    // URL/SNI остаются исходными, а lookup использует только проверенный адрес.
    // Отдельный агент не позволяет переиспользовать соединение с другим DNS-снимком.
    const req = httpsRequest(input.url, {
      method: "POST",
      headers: input.headers,
      agent: false,
      servername: input.url.hostname,
      rejectUnauthorized: true,
      signal: input.signal,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [input.address]);
        else callback(null, input.address.address, input.address.family);
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > input.maxResponseBytes) {
          const error = new Error("Ответ callback превышает допустимый размер");
          response.destroy(error);
          req.destroy(error);
          reject(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", () => reject(new Error("Не удалось выполнить callback")));
    req.end(input.body);
  });
}

export class McpWebhooks {
  private readonly resolve: NonNullable<McpWebhooksOptions["resolve"]>;
  private readonly request: NonNullable<McpWebhooksOptions["request"]>;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(options: McpWebhooksOptions = {}) {
    this.resolve = options.resolve ?? ((hostname) => lookup(hostname, { all: true }) as Promise<CallbackAddress[]>);
    this.request = options.request ?? pinnedRequest;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => randomBytes(32).toString("base64url"));
  }

  async verifyCallback(url: string, secret: string, subscriptionId: string): Promise<void> {
    const challenge = this.randomId();
    const response = await this.post(url, secret, subscriptionId, { type: "verification", challenge }, this.randomId());
    let echoed: unknown;
    try { echoed = JSON.parse(response.body)?.challenge; } catch { throw new Error("Callback не подтвердил challenge"); }
    const expected = Buffer.from(challenge);
    const actual = typeof echoed === "string" ? Buffer.from(echoed) : Buffer.alloc(0);
    if (response.status < 200 || response.status >= 300 || actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error("Callback не подтвердил challenge");
  }

  // Статус подтверждения подписки хранит вызывающий слой; только он допускает app data к отправке.
  async sendEvent(url: string, secret: string, subscriptionId: string, event: unknown): Promise<{ status: number; accepted: boolean }> {
    const id = identifier(typeof event === "object" && event !== null ? (event as Record<string, unknown>).eventId : undefined);
    const response = await this.post(url, secret, subscriptionId, event, id);
    return { status: response.status, accepted: response.status >= 200 && response.status < 300 };
  }

  private async post(rawUrl: string, secret: string, subscriptionId: string, event: unknown, id: string): Promise<CallbackResponse> {
    const url = validateCallbackUrl(rawUrl);
    const key = validateSecret(secret);
    identifier(subscriptionId);
    identifier(id);
    const body = JSON.stringify(event);
    if (!body || Buffer.byteLength(body) > MAX_EVENT_BYTES) throw new Error("Событие callback превышает допустимый размер");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Истекло время callback")); }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([timeout, (async () => {
        let addresses: CallbackAddress[];
        try { addresses = await this.resolve(url.hostname); } catch { throw new Error("Не удалось разрешить адрес callback"); }
        if (controller.signal.aborted) throw new Error("Истекло время callback");
        if (!addresses.length || addresses.some((address) => !globalAddress(address))) throw new Error("DNS callback содержит недопустимый адрес");
        const timestamp = String(Math.floor(this.now() / 1000));
        const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
        const response = await this.request({
          url, address: addresses[0]!, body, signal: controller.signal, timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES,
          headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`, "X-MCP-Subscription-Id": subscriptionId },
        });
        if (Buffer.byteLength(response.body) > MAX_RESPONSE_BYTES) throw new Error("Ответ callback превышает допустимый размер");
        return response;
      })()]);
    } finally { clearTimeout(timer!); }
  }
}
