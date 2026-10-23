/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ForkRef, MessageItem, TimelineItem } from "@chat0110/chat-protocol";
import { forkRequest, forkTitle, groupForks, lastForkable, messageRef } from "../src/lib/fork.ts";

function msg(id: string, over: Partial<MessageItem> = {}): MessageItem {
  return {
    kind: "message",
    id,
    author: "alex011082",
    display: "alex011082",
    source: "file",
    text: "текст",
    created_at: "2026-10-23T10:00:00Z",
    pending: false,
    ...over,
  };
}

function ref(chatId: string, messageId: string, over: Partial<ForkRef> = {}): ForkRef {
  return {
    chat_id: chatId,
    title: `Fork ${chatId}`,
    number: 7,
    url: "https://github.com/a/b/pull/7",
    state: "open",
    message_id: messageId,
    commit_sha: "a3f8c91",
    created_at: "2026-10-23T11:00:00Z",
    created_by: "alex011082",
    ...over,
  };
}

const SASHA = "20261023T100300Z-alex011082-q9w1";
const CLAUDE = "20261023T101400Z-claude-x7k2";

describe("forkTitle — название Fork по умолчанию", () => {
  test("«Fork: <название родителя>»", () => {
    expect(forkTitle("RoboChain — захват коробок")).toBe("Fork: RoboChain — захват коробок");
  });
  test("не длиннее 120 знаков, обрезка с многоточием", () => {
    const t = forkTitle("а".repeat(200));
    expect(Array.from(t)).toHaveLength(120);
    expect(t.endsWith("…")).toBe(true);
    expect(t.startsWith("Fork: ааа")).toBe(true);
  });
  test("родитель уже Fork — не «Fork: Fork: …»", () => {
    expect(forkTitle("Fork: Выдвижной мост")).toBe("Fork: Выдвижной мост");
  });
});

describe("lastForkable — «Fork» в шапке берёт последнее сообщение", () => {
  test("последнее влитое сообщение, «не влито» пропускается", () => {
    const items: TimelineItem[] = [
      { kind: "created", id: "c", actor: "alex011082", created_at: "2026-10-23T09:00:00Z", url: "" },
      msg(SASHA),
      msg(CLAUDE, { author: "claude" }),
      msg("20261023T110000Z-claude-pend", { pending: true }),
      { kind: "push", id: "p", actor: "x", author: "codex", display: "Codex", title: "t", files: 1, created_at: "2026-10-23T11:01:00Z", url: "" },
    ];
    expect(lastForkable(items)?.id).toBe(CLAUDE);
  });
  test("сообщений нет — null", () => {
    expect(lastForkable([])).toBeNull();
  });
});

describe("forkRequest — тело POST …/fork", () => {
  test("обрезает пробелы и не шлёт пустые поля", () => {
    expect(forkRequest(CLAUDE, { title: "  Мост  ", reason: "   ", first: "" })).toEqual({ message_id: CLAUDE, title: "Мост" });
  });
  test("зачем и первое сообщение — если есть", () => {
    expect(forkRequest(CLAUDE, { title: "Мост", reason: " проверить ", first: " Начнём " })).toEqual({
      message_id: CLAUDE,
      title: "Мост",
      reason: "проверить",
      first_message: "Начнём",
    });
  });
});

describe("groupForks — чипы Fork под сообщениями", () => {
  test("по сообщениям, по времени; чужие id — в хвост", () => {
    const a = ref("20261023-aaaa", CLAUDE, { created_at: "2026-10-23T12:00:00Z" });
    const b = ref("20261023-bbbb", CLAUDE, { created_at: "2026-10-23T11:00:00Z" });
    const c = ref("20261023-cccc", SASHA);
    const d = ref("20261023-dddd", "c999");
    const { byMessage, rest } = groupForks([a, b, c, d], [SASHA, CLAUDE]);
    expect(byMessage.get(CLAUDE)?.map((f) => f.chat_id)).toEqual(["20261023-bbbb", "20261023-aaaa"]);
    expect(byMessage.get(SASHA)?.map((f) => f.chat_id)).toEqual(["20261023-cccc"]);
    expect(rest.map((f) => f.chat_id)).toEqual(["20261023-dddd"]);
  });
});

describe("messageRef — кто и когда написал сообщение-точку", () => {
  const items = [msg(SASHA, { text: "Обсуждаем передачу коробок между гусеничными платформами." })];
  test("из загруженной ленты — с цитатой", () => {
    expect(messageRef(items, SASHA)).toEqual({
      display: "alex011082",
      created_at: "2026-10-23T10:00:00Z",
      excerpt: "Обсуждаем передачу коробок между…",
    });
  });
  test("нет в ленте — автор и время из id", () => {
    expect(messageRef(items, CLAUDE)).toEqual({ display: "Claude", created_at: "2026-10-23T10:14:00.000Z", excerpt: null });
  });
  test("комментарий без данных — ничего не выдумываем", () => {
    expect(messageRef(items, "c2000001")).toEqual({ display: null, created_at: null, excerpt: null });
  });
});
