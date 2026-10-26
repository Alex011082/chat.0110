import { describe, expect, test } from "bun:test";
import { CHAT_AGENTS_MD } from "../src/agents-v2.ts";
import {
  CHAT_AGENTS_PATH,
  PROTOCOL_PATH,
  chatPathAllowed,
  conversationViolation,
  planInit,
  scaffoldViolation,
} from "../src/layout.ts";

const empty = Object.fromEntries([
  [PROTOCOL_PATH, null],
  [CHAT_AGENTS_PATH, null],
  ["Chat/CLAUDE.md", null],
  ["Chat/index/.gitkeep", null],
  ["Chat/conversations/.gitkeep", null],
  ["Chat/forks/.gitkeep", null],
  ["Chat/references/.gitkeep", null],
]) as Record<string, string | null>;

describe("подключение Chat/", () => {
  test("пустое дерево: создаётся каркас, включая AGENTS.md", () => {
    const plan = planInit(empty);
    expect(plan.activated).toBe(false);
    expect(plan.gaps).toContain(CHAT_AGENTS_PATH);
    expect(plan.gaps).toContain(PROTOCOL_PATH);
    expect(plan.create.map((f) => f.path)).toEqual(plan.gaps);
  });

  test("повтор ничего не дописывает", () => {
    const first = planInit(empty);
    const have = { ...empty };
    for (const file of first.create) have[file.path] = file.content;
    const again = planInit(have);
    expect(again.create).toEqual([]);
    expect(again.activated).toBe(true);
    expect(again.agentsDoc).toBe(true);
    expect(again.gaps).toEqual([]);
  });

  test("готовый README и свой AGENTS.md не входят в запись", () => {
    const plan = planInit({ ...empty, [CHAT_AGENTS_PATH]: "# свой\n" });
    expect(plan.create.some((f) => f.path === CHAT_AGENTS_PATH)).toBe(false);
    expect(plan.kept).toContain(CHAT_AGENTS_PATH);
    expect(plan.create.some((f) => f.path === "Chat/README.md")).toBe(false);
  });

  test("битый protocol.json останавливает init", () => {
    const plan = planInit({ ...empty, [PROTOCOL_PATH]: "{}" });
    expect(plan.protocolInvalid).toBe(true);
    expect(plan.create).toEqual([]);
  });

  test("AGENTS.md запрещает решения внутри чата и указывает Chat/", () => {
    expect(CHAT_AGENTS_MD).toContain("Chat/conversations/<chat_id>/messages/");
    expect(CHAT_AGENTS_MD).toContain("Это не решение");
    expect(CHAT_AGENTS_MD).not.toContain("action: propose");
  });
});

describe("пути записи", () => {
  test("схема 2 — только Chat/, схема 1 — только chats/", () => {
    expect(chatPathAllowed("Chat/conversations/20261023-k7q2/messages/a.md", 2)).toBe(true);
    expect(chatPathAllowed("src/index.ts", 2)).toBe(false);
    expect(chatPathAllowed("chats/20261023-k7q2/messages/a.md", 2)).toBe(false);
    expect(chatPathAllowed("Chat/../../src/index.ts", 2)).toBe(false);
    expect(chatPathAllowed("chats/20261023-k7q2/chat.json", 1)).toBe(true);
    expect(conversationViolation(["src/app.ts"], 2)).toBe("src/app.ts");
    expect(scaffoldViolation(["Chat/AGENTS.md", "src/app.ts"])).toBe("src/app.ts");
  });
});
