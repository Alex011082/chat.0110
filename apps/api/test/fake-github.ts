// Поддельный GitHub для тестов: подставляется вместо fetch. Сеть в тестах
// запрещена — каждый вызов либо совпадает с маршрутом, либо роняет тест.
import type { Fetch } from "../src/github.ts";

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: any;
}

type Reply = Response | { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (call: Call) => Reply | Promise<Reply>;

export class FakeGitHub {
  readonly calls: Call[] = [];
  private routes: { method: string; match: string | RegExp; handler: Handler }[] = [];

  // Чтение Chat/protocol.json добавлено во все операции чата. Старые тесты
  // схему 2 не подключают: без явного маршрута это «файла нет», не ошибка теста.
  constructor() {
    this.on("GET", /\/contents\/Chat\/protocol\.json/, { status: 404, body: { message: "Not Found" } });
  }

  // Путь сравнивается без query, если в шаблоне нет «?»; регулярка — с query.
  on(method: string, match: string | RegExp, handler: Handler | Reply): this {
    const h: Handler = typeof handler === "function" ? handler : () => handler;
    this.routes.unshift({ method, match, handler: h });
    return this;
  }

  find(method: string, match: string | RegExp): Call[] {
    return this.calls.filter((c) => c.method === method && matches(match, c.url));
  }

  fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    let body: any = init?.body ?? null;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // форма или текст — оставляем как есть
      }
    }
    const call = { method, url, headers, body };
    this.calls.push(call);
    const route = this.routes.find((r) => r.method === method && matches(r.match, url));
    if (!route) throw new Error(`фейковый GitHub: нет маршрута ${method} ${url.pathname}${url.search}`);
    const reply = await route.handler(call);
    if (reply instanceof Response) return reply;
    const status = reply.status ?? 200;
    const hasBody = reply.body !== undefined && status !== 204 && status !== 304;
    return new Response(hasBody ? JSON.stringify(reply.body) : null, {
      status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
}

function matches(match: string | RegExp, url: URL): boolean {
  if (match instanceof RegExp) return match.test(url.pathname + url.search);
  return match.includes("?") ? match === url.pathname + url.search : match === url.pathname;
}

export const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
