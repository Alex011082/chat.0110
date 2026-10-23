// Вебхук GitHub App. Он не источник данных, а только будильник: проверяет
// подпись, отсекает повторы и будит через SSE тех, кто смотрит этот репо.
import { createHmac, timingSafeEqual } from "node:crypto";
import { SSE_CHAT_UPDATED, SSE_REPO_UPDATED, chatIdFromBranch, type ChatUpdatedEvent } from "@chat0110/chat-protocol";
import type { SseHub } from "./sse.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Подпись считается по СЫРОМУ телу: после JSON.parse/stringify байты уже
// другие, и честная подпись перестала бы сходиться.
export function verifySignature(secret: string, raw: Uint8Array, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(raw).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface MappedEvent {
  event: string;
  data: ChatUpdatedEvent | { repo: string };
}

// Одно событие GitHub может разбудить несколько экранов: Fork трогает и
// ребёнка, и родителя, а пуш в чат меняет и ленту, и дерево чатов.
export function mapWebhookEvent(name: string, payload: any): MappedEvent[] {
  const repo: unknown = payload?.repository?.full_name;
  if (typeof repo !== "string") return [];
  const chat = (chat_id: string | null, number: number | null): MappedEvent => ({ event: SSE_CHAT_UPDATED, data: { repo, chat_id, number } });
  const repoUpdated: MappedEvent = { event: SSE_REPO_UPDATED, data: { repo } };
  const pr = payload.pull_request;

  switch (name) {
    case "push": {
      // Дерево показывает сообщения из имён файлов — пуш в чат меняет и его.
      const id = chatIdFromBranch(String(payload.ref ?? ""));
      return id ? [chat(id, null), repoUpdated] : [repoUpdated];
    }
    case "pull_request": {
      const head = chatIdFromBranch(String(pr?.head?.ref ?? ""));
      const base = chatIdFromBranch(String(pr?.base?.ref ?? ""));
      // chat/<ребёнок> → chat/<родитель> — PR дочернего чата: у родителя
      // появляется (или меняется) Fork, у дерева — узел. Номер PR принадлежит
      // ребёнку, поэтому родителю его не передаём: клиент по номеру ищет чат.
      if (head && base && head !== base) return [chat(head, pr?.number ?? null), chat(base, null), repoUpdated];
      // base = ветка чата — это PR агента в чат; он тоже часть ленты.
      const id = head ?? base;
      return [id ? chat(id, pr?.number ?? null) : repoUpdated];
    }
    case "issue_comment":
      // В событии комментария нет ветки PR — клиент найдёт чат по номеру.
      return [payload.issue?.pull_request ? chat(null, payload.issue.number ?? null) : repoUpdated];
    case "pull_request_review":
    case "pull_request_review_comment":
      return [chat(chatIdFromBranch(String(pr?.head?.ref ?? "")), pr?.number ?? null)];
    default:
      return [repoUpdated];
  }
}

export function createWebhook(deps: { secret: string; hub: SseHub; maxDeliveries?: number }) {
  const max = deps.maxDeliveries ?? 1000;
  // GitHub повторяет доставку при таймауте и по кнопке Redeliver. Помним
  // последние ~1000 id: повтор будил бы клиентов зря.
  const seen = new Set<string>();

  return async (req: Request): Promise<Response> => {
    const raw = new Uint8Array(await req.arrayBuffer());
    if (!verifySignature(deps.secret, raw, req.headers.get("x-hub-signature-256"))) {
      return json(401, { error: "Подпись вебхука не сошлась", code: "unauthorized" });
    }
    const delivery = req.headers.get("x-github-delivery") ?? "";
    if (delivery) {
      if (seen.has(delivery)) return json(200, { ok: true, duplicate: true });
      seen.add(delivery);
      if (seen.size > max) seen.delete(seen.values().next().value!);
    }
    const name = req.headers.get("x-github-event") ?? "";
    if (name === "ping") return json(200, { ok: true, pong: true });

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return json(400, { error: "Тело вебхука — не JSON", code: "bad_request" });
    }
    for (const m of mapWebhookEvent(name, payload)) deps.hub.publish(m.data.repo, m.event, m.data);
    return json(200, { ok: true });
  };
}
