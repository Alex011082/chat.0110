// Server-Sent Events: вебхук только будит клиентов, подписанных на репо.
// Данных в событии нет — клиент перечитывает ленту сам, своим токеном, и
// чужие данные через SSE утечь не могут.

type Send = (chunk: string) => void;

export interface ServerLike {
  timeout?(req: Request, seconds: number): void;
}

const PING_MS = 25_000;

export class SseHub {
  private subs = new Map<string, Set<Send>>();

  // Ключ — full_name в нижнем регистре: GitHub отдаёт его в каноническом
  // регистре, а в адресе пользователь мог набрать как угодно.
  subscribe(repo: string, send: Send): () => void {
    const key = repo.toLowerCase();
    let set = this.subs.get(key);
    if (!set) this.subs.set(key, (set = new Set()));
    set.add(send);
    return () => {
      set.delete(send);
      if (!set.size) this.subs.delete(key);
    };
  }

  publish(repo: string, event: string, data: unknown): void {
    const set = this.subs.get(repo.toLowerCase());
    if (!set) return;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const send of [...set]) {
      try {
        send(chunk);
      } catch {
        // поток уже закрыт — отписка придёт через abort
      }
    }
  }

  count(repo: string): number {
    return this.subs.get(repo.toLowerCase())?.size ?? 0;
  }
}

export function sseResponse(req: Request, server: ServerLike | undefined, hub: SseHub, repo: string, pingMs = PING_MS): Response {
  // Bun по умолчанию рвёт соединение, молчащее idleTimeout секунд.
  server?.timeout?.(req, 0);
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(enc.encode(chunk));
      send("retry: 5000\n: connected\n\n");
      const off = hub.subscribe(repo, send);
      // Комментарий-пинг держит соединение живым через прокси и даёт
      // браузеру заметить обрыв.
      const timer = setInterval(() => {
        try {
          send(": ping\n\n");
        } catch {
          cleanup();
        }
      }, pingMs);
      let closed = false;
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        off();
        try {
          controller.close();
        } catch {
          // уже закрыт
        }
      };
      if (req.signal.aborted) cleanup();
      else req.signal.addEventListener("abort", () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
