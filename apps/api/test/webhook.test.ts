import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { SSE_CHAT_UPDATED, SSE_REPO_UPDATED } from "@chat0110/chat-protocol";
import { SseHub, sseResponse } from "../src/sse.ts";
import { createWebhook, mapWebhookEvent } from "../src/webhook.ts";

const SECRET = "whsec";
const REPO = { full_name: "Alex011082/chat.0110" };

function sign(body: string, secret = SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function hook(event: string, payload: object, opts: { delivery?: string; signature?: string } = {}) {
  const body = JSON.stringify(payload);
  return new Request("https://chat.0110.digital/api/github/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": opts.delivery ?? crypto.randomUUID(),
      "x-hub-signature-256": opts.signature ?? sign(body),
    },
  });
}

function spyHub() {
  const hub = new SseHub();
  const got: { repo: string; event: string; data: unknown }[] = [];
  const publish = hub.publish.bind(hub);
  hub.publish = (repo, event, data) => {
    got.push({ repo, event, data });
    publish(repo, event, data);
  };
  return { hub, got };
}

describe("вебхук GitHub App", () => {
  test("неверная подпись — 401, событие не публикуется", async () => {
    const { hub, got } = spyHub();
    const wh = createWebhook({ secret: SECRET, hub });
    const res = await wh(hook("push", { ref: "refs/heads/chat/20261023-k7q2", repository: REPO }, { signature: sign("другое тело") }));
    expect(res.status).toBe(401);
    const noSig = hook("push", { repository: REPO });
    noSig.headers.delete("x-hub-signature-256");
    expect((await wh(noSig)).status).toBe(401);
    expect((await wh(hook("push", { repository: REPO }, { signature: "sha256=zz" }))).status).toBe(401);
    expect(got.length).toBe(0);
  });

  test("ping — 200", async () => {
    const wh = createWebhook({ secret: SECRET, hub: new SseHub() });
    const res = await wh(hook("ping", { zen: "Keep it simple" }));
    expect(res.status).toBe(200);
  });

  test("повтор доставки отсекается по X-GitHub-Delivery", async () => {
    const { hub, got } = spyHub();
    const wh = createWebhook({ secret: SECRET, hub });
    const payload = { ref: "refs/heads/chat/20261023-k7q2", repository: REPO };
    expect((await wh(hook("push", payload, { delivery: "d1" }))).status).toBe(200);
    const again = await wh(hook("push", payload, { delivery: "d1" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(got.length).toBe(2);
  });

  test("пуш в ветку чата будит подписчиков репо: чат и дерево", async () => {
    const { hub, got } = spyHub();
    const wh = createWebhook({ secret: SECRET, hub });
    await wh(hook("push", { ref: "refs/heads/chat/20261023-k7q2", repository: REPO }));
    expect(got).toEqual([
      { repo: "Alex011082/chat.0110", event: SSE_CHAT_UPDATED, data: { repo: "Alex011082/chat.0110", chat_id: "20261023-k7q2", number: null } },
      { repo: "Alex011082/chat.0110", event: SSE_REPO_UPDATED, data: { repo: "Alex011082/chat.0110" } },
    ]);
  });

  test("PR дочернего чата будит и ребёнка, и родителя, и дерево", async () => {
    const { hub, got } = spyHub();
    const wh = createWebhook({ secret: SECRET, hub });
    await wh(hook("pull_request", { action: "opened", repository: REPO, pull_request: { number: 7, head: { ref: "chat/20261024-m2p9" }, base: { ref: "chat/20261023-k7q2" } } }));
    expect(got.map((g) => [g.event, g.data])).toEqual([
      [SSE_CHAT_UPDATED, { repo: REPO.full_name, chat_id: "20261024-m2p9", number: 7 }],
      [SSE_CHAT_UPDATED, { repo: REPO.full_name, chat_id: "20261023-k7q2", number: null }],
      [SSE_REPO_UPDATED, { repo: REPO.full_name }],
    ]);
  });
});

describe("события вебхука → SSE", () => {
  const ev = (name: string, payload: object) => mapWebhookEvent(name, { repository: REPO, ...payload });
  const chat = (chat_id: string | null, number: number | null) => ({ event: SSE_CHAT_UPDATED, data: { repo: REPO.full_name, chat_id, number } });
  const repoUpdated = { event: SSE_REPO_UPDATED, data: { repo: REPO.full_name } };

  test("push: в ветку чата — чат и дерево; в другую ветку — только репо", () => {
    expect(ev("push", { ref: "refs/heads/chat/20261023-k7q2" })).toEqual([chat("20261023-k7q2", null), repoUpdated]);
    expect(ev("push", { ref: "refs/heads/main" })).toEqual([repoUpdated]);
  });

  test("push «предложение из Fork» в ветку родителя: родитель, сам Fork (его outgoing) и дерево", () => {
    const head = (message: string) => ({ ref: "refs/heads/chat/20261023-k7q2", head_commit: { message } });
    expect(ev("push", head("chat(20261023-k7q2): предложение из Fork 20261024-m2p9"))).toEqual([
      chat("20261023-k7q2", null),
      chat("20261024-m2p9", null),
      repoUpdated,
    ]);
    // Обычное сообщение, решение, кривой id или вовсе нет head_commit (удаление ветки) — как раньше.
    for (const payload of [
      head("chat(20261023-k7q2): alex011082"),
      head("chat(20261023-k7q2): решение alex011082"),
      head("chat(20261023-k7q2): предложение из Fork ../../x"),
      head("chat(20261023-k7q2): предложение из Fork 20261023-k7q2"),
      { ref: "refs/heads/chat/20261023-k7q2", head_commit: null },
    ]) {
      expect(ev("push", payload)).toEqual([chat("20261023-k7q2", null), repoUpdated]);
    }
  });

  test("pull_request: ветка чата в head или base", () => {
    expect(ev("pull_request", { pull_request: { number: 5, head: { ref: "chat/20261023-k7q2" }, base: { ref: "main" } } })).toEqual([chat("20261023-k7q2", 5)]);
    expect(ev("pull_request", { pull_request: { number: 9, head: { ref: "claude/reply" }, base: { ref: "chat/20261023-k7q2" } } })).toEqual([chat("20261023-k7q2", 9)]);
    expect(ev("pull_request", { pull_request: { number: 3, head: { ref: "feature/x" }, base: { ref: "main" } } })).toEqual([repoUpdated]);
  });

  test("pull_request дочернего чата: ребёнок, родитель (без чужого номера) и дерево", () => {
    expect(ev("pull_request", { pull_request: { number: 7, head: { ref: "chat/20261024-m2p9" }, base: { ref: "chat/20261023-k7q2" } } })).toEqual([
      chat("20261024-m2p9", 7),
      chat("20261023-k7q2", null),
      repoUpdated,
    ]);
    // Агент из форка в ветке с тем же именем: это PR в чат, а не Fork.
    expect(ev("pull_request", { pull_request: { number: 10, head: { ref: "chat/20261023-k7q2" }, base: { ref: "chat/20261023-k7q2" } } })).toEqual([
      chat("20261023-k7q2", 10),
    ]);
  });

  test("комментарий к PR — chat_id неизвестен, есть номер", () => {
    expect(ev("issue_comment", { issue: { number: 5, pull_request: {} } })).toEqual([chat(null, 5)]);
    expect(ev("issue_comment", { issue: { number: 6 } })).toEqual([repoUpdated]);
  });

  test("ревью и комментарии к строкам", () => {
    const pr = { number: 5, head: { ref: "chat/20261023-k7q2" }, base: { ref: "main" } };
    expect(ev("pull_request_review", { pull_request: pr })).toEqual([chat("20261023-k7q2", 5)]);
    expect(ev("pull_request_review_comment", { pull_request: pr })).toEqual([chat("20261023-k7q2", 5)]);
    expect(ev("pull_request_review", { pull_request: { number: 8, head: { ref: "x" }, base: { ref: "main" } } })).toEqual([chat(null, 8)]);
  });

  test("прочее — repo.updated; без репо — ничего", () => {
    expect(ev("create", {})).toEqual([repoUpdated]);
    expect(mapWebhookEvent("installation", { action: "created" })).toEqual([]);
  });
});

describe("SSE", () => {
  test("подписчик получает событие своего репо, без учёта регистра", async () => {
    const hub = new SseHub();
    const got: string[] = [];
    const off = hub.subscribe("alex011082/CHAT.0110", (chunk) => got.push(chunk));
    hub.publish("Alex011082/chat.0110", SSE_CHAT_UPDATED, { repo: "Alex011082/chat.0110", chat_id: "20261023-k7q2", number: null });
    hub.publish("other/repo", SSE_REPO_UPDATED, { repo: "other/repo" });
    expect(got).toEqual([`event: chat.updated\ndata: {"repo":"Alex011082/chat.0110","chat_id":"20261023-k7q2","number":null}\n\n`]);
    off();
    expect(hub.count("Alex011082/chat.0110")).toBe(0);
  });

  test("поток: заголовки, timeout(0), ping, отписка по abort", async () => {
    const hub = new SseHub();
    const ctrl = new AbortController();
    const req = new Request("https://x/api/events?repo=o/r", { signal: ctrl.signal });
    const timeouts: number[] = [];
    const res = sseResponse(req, { timeout: (_r, s) => timeouts.push(s) }, hub, "o/r", 20);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(timeouts).toEqual([0]);
    expect(hub.count("o/r")).toBe(1);

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    hub.publish("o/r", SSE_REPO_UPDATED, { repo: "o/r" });
    await readUntil("repo.updated");
    await readUntil(": ping");
    expect(text).toContain("event: repo.updated");
    ctrl.abort();
    await Bun.sleep(5);
    expect(hub.count("o/r")).toBe(0);
  });
});
