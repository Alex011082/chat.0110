/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { AgentPrItem, MessageItem, TimelineItem } from "@chat0110/chat-protocol";
import {
  countTimeline,
  layoutTimeline,
  mergeTimeline,
  replyLine,
  resolveReply,
  type LocalEntry,
} from "../src/lib/timeline.ts";

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

const SASHA = "20261023T100300Z-alex011082-q9w1";
const CLAUDE = "20261023T101400Z-claude-x7k2";

describe("resolveReply — цитата «↳ ответ …»", () => {
  const items: TimelineItem[] = [
    msg(SASHA, { text: "Обсуждаем передачу коробок между гусеничными платформами. Нужны варианты захвата." }),
    msg(CLAUDE, { author: "claude", display: "Claude", reply_to: SASHA, text: "Предлагаю вакуумные руки" }),
  ];

  test("находит сообщение в загруженной ленте", () => {
    expect(resolveReply(items, SASHA)).toEqual({ display: "alex011082", excerpt: "Обсуждаем передачу коробок между…" });
  });
  test("не загружено — имя из id сообщения", () => {
    expect(resolveReply(items, "20261022T090000Z-codex-ab12")).toEqual({ display: "Codex", excerpt: null });
  });
  test("непонятный id — ничего", () => {
    expect(resolveReply(items, "c12345")).toBeNull();
  });
  test("строка цитаты", () => {
    expect(replyLine({ display: "Claude", excerpt: "Предлагаю вакуумные руки" })).toBe(
      "↳ ответ Claude: «Предлагаю вакуумные руки»",
    );
    expect(replyLine({ display: "Codex", excerpt: null })).toBe("↳ ответ Codex");
  });
});

describe("mergeTimeline — отправка без ожидания сервера", () => {
  const server: TimelineItem[] = [
    msg("a", { created_at: "2026-10-23T10:00:00Z" }),
    msg("c", { created_at: "2026-10-23T10:20:00Z" }),
  ];
  const sending: LocalEntry = { localId: "l1", text: "привет", created_at: "2026-10-23T10:30:00Z", status: "sending" };
  const failed: LocalEntry = {
    localId: "l2",
    text: "упало",
    created_at: "2026-10-23T10:31:00Z",
    status: "error",
    error: "GitHub просит подождать 30 с",
  };

  test("отправляемые и упавшие — в конце, по порядку", () => {
    const view = mergeTimeline(server, [sending, failed]);
    expect(view.map((v) => (v.kind === "item" ? v.item.id : v.entry.localId))).toEqual(["a", "c", "l1", "l2"]);
    expect(view[3]).toEqual({ kind: "local", entry: failed });
  });

  test("опубликованное, которого сервер ещё не вернул, встаёт по времени", () => {
    const published: LocalEntry = {
      localId: "l3",
      text: "x",
      created_at: "2026-10-23T10:10:00Z",
      status: "published",
      item: msg("b", { created_at: "2026-10-23T10:10:00Z" }),
    };
    const view = mergeTimeline(server, [published]);
    expect(view.map((v) => (v.kind === "item" ? v.item.id : v.entry.localId))).toEqual(["a", "b", "c"]);
    expect(view[1]).toMatchObject({ kind: "item", published: true });
  });

  test("сервер уже вернул опубликованное — без повтора, но с лампой «опубликовано»", () => {
    const published: LocalEntry = {
      localId: "l4",
      text: "x",
      created_at: "2026-10-23T10:20:00Z",
      status: "published",
      item: msg("c", { created_at: "2026-10-23T10:20:00Z" }),
    };
    const view = mergeTimeline(server, [published]);
    expect(view).toHaveLength(2);
    expect(view[0]).toMatchObject({ kind: "item", published: false });
    expect(view[1]).toMatchObject({ kind: "item", published: true });
  });
});

describe("layoutTimeline — сообщения «не влито» живут в карточке PR агента", () => {
  const pr: AgentPrItem = {
    kind: "agent_pr",
    id: "pr5",
    number: 5,
    title: "claude: гибрид",
    actor: "claude[bot]",
    author: "claude",
    display: "Claude",
    state: "open",
    created_at: "2026-10-23T10:30:00Z",
    url: "https://github.com/a/b/pull/5",
    message_ids: ["20261023T103100Z-claude-hy01"],
  };
  const pending = msg("20261023T103100Z-claude-hy01", {
    author: "claude",
    display: "Claude",
    source: "agent_pr",
    pending: true,
    agent_pr: 5,
    created_at: "2026-10-23T10:31:00Z",
  });
  const orphan = msg("20261023T103500Z-codex-or01", { source: "agent_pr", pending: true, agent_pr: 9 });

  test("сообщение уходит в карточку, остальное — по порядку", () => {
    const view = mergeTimeline([msg("a"), pr, pending, orphan], []);
    const blocks = layoutTimeline(view);
    expect(blocks.map((b) => b.type)).toEqual(["item", "agentPr", "item"]);
    const card = blocks[1]!;
    expect(card.type === "agentPr" && card.pending.map((m) => m.id)).toEqual(["20261023T103100Z-claude-hy01"]);
    expect(blocks[2]!.type === "item" && blocks[2]!.item.id).toBe("20261023T103500Z-codex-or01");
  });

  test("влитый PR — без вложенных сообщений", () => {
    const merged = { ...pr, state: "merged" as const };
    const blocks = layoutTimeline(mergeTimeline([merged], []));
    expect(blocks).toEqual([{ type: "agentPr", item: merged, pending: [] }]);
  });
});

describe("countTimeline — цифры для шкал", () => {
  test("ветка, PR, ревью", () => {
    const items: TimelineItem[] = [
      msg("1"),
      msg("2"),
      msg("3", { source: "comment" }),
      msg("4", { source: "agent_pr", pending: true }),
      {
        kind: "review",
        id: "r1",
        author: "claude",
        display: "Claude",
        actor: "claude[bot]",
        text: "ok",
        created_at: "2026-10-23T10:00:00Z",
        url: "u",
      },
      { kind: "created", id: "s", actor: "alex011082", created_at: "2026-10-23T09:00:00Z", url: "u" },
    ];
    expect(countTimeline(items)).toEqual({ messages: 3, inBranch: 2, comments: 1, reviews: 1 });
  });
});
