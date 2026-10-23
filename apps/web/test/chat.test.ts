/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ChatSummary } from "@chat0110/chat-protocol";
import { agentLinkPhrase, arrangeChats, arrangeChatTree, backoffDelay, eventMatchesChat, type ChatTreeNode } from "../src/lib/chat.ts";

function chat(over: Partial<ChatSummary>): ChatSummary {
  return {
    repo: "Alex011082/chat.0110",
    chat_id: "20261023-aaaa",
    title: "Чат",
    number: 1,
    state: "open",
    draft: true,
    branch: "chat/20261023-aaaa",
    url: "https://github.com/Alex011082/chat.0110/pull/1",
    created_at: "2026-10-23T10:00:00Z",
    updated_at: "2026-10-23T10:00:00Z",
    created_by: "alex011082",
    parent: null,
    ...over,
  };
}

describe("arrangeChats — список: открытые сверху, закрытые в архиве", () => {
  const list = [
    chat({ chat_id: "20261021-aaaa", title: "QA Board — нестабильные тесты", updated_at: "2026-10-22T10:00:00Z" }),
    chat({ chat_id: "20261023-k7q2", title: "RoboChain — захват коробок", updated_at: "2026-10-23T11:58:00Z" }),
    chat({ chat_id: "20261020-zzzz", title: "Первый тестовый чат", state: "closed", updated_at: "2026-10-20T10:00:00Z" }),
    chat({ chat_id: "20261022-bbbb", title: "YTNG — второе мнение", updated_at: "2026-10-23T11:00:00Z" }),
    chat({ chat_id: "20261019-cccc", title: "Старый архив", state: "closed", updated_at: "2026-10-19T10:00:00Z" }),
  ];

  test("свежие сверху", () => {
    const { open, archived } = arrangeChats(list, "");
    expect(open.map((c) => c.chat_id)).toEqual(["20261023-k7q2", "20261022-bbbb", "20261021-aaaa"]);
    expect(archived.map((c) => c.chat_id)).toEqual(["20261020-zzzz", "20261019-cccc"]);
  });

  test("поиск по названию без учёта регистра и ё", () => {
    expect(arrangeChats(list, "  robochain ").open.map((c) => c.chat_id)).toEqual(["20261023-k7q2"]);
    expect(arrangeChats(list, "ТЕСТ").open.map((c) => c.chat_id)).toEqual(["20261021-aaaa"]);
    expect(arrangeChats(list, "тест").archived.map((c) => c.chat_id)).toEqual(["20261020-zzzz"]);
    expect(arrangeChats([chat({ title: "Ёлка" })], "елк").open).toHaveLength(1);
  });

  test("исходный массив не меняется", () => {
    const copy = [...list];
    arrangeChats(list, "");
    expect(list).toEqual(copy);
  });
});

describe("agentLinkPhrase — фраза для агента", () => {
  test("ровно по договорённости", () => {
    expect(agentLinkPhrase("https://github.com/Alex011082/chat.0110/pull/3")).toBe(
      "Прочитай чат https://github.com/Alex011082/chat.0110/pull/3 по правилам chats/AGENTS.md и ответь новым файлом в ту же ветку.",
    );
  });
});

describe("eventMatchesChat — какое событие будит открытую ленту", () => {
  const open = { repo: "Alex011082/chat.0110", chat_id: "20261023-k7q2", number: 3 };
  test("тот же chat_id", () => {
    expect(eventMatchesChat({ repo: "alex011082/chat.0110", chat_id: "20261023-k7q2", number: null }, open)).toBe(true);
  });
  test("другой chat_id — нет", () => {
    expect(eventMatchesChat({ repo: "Alex011082/chat.0110", chat_id: "20261022-bbbb", number: 3 }, open)).toBe(false);
  });
  test("chat_id неизвестен — по номеру или на всякий случай", () => {
    expect(eventMatchesChat({ repo: "Alex011082/chat.0110", chat_id: null, number: 3 }, open)).toBe(true);
    expect(eventMatchesChat({ repo: "Alex011082/chat.0110", chat_id: null, number: null }, open)).toBe(true);
    expect(eventMatchesChat({ repo: "Alex011082/chat.0110", chat_id: null, number: 9 }, open)).toBe(true);
  });
  test("другой репозиторий — никогда", () => {
    expect(eventMatchesChat({ repo: "Alex011082/Y-TNG", chat_id: "20261023-k7q2", number: 3 }, open)).toBe(false);
  });
});

describe("backoffDelay — переподключение SSE", () => {
  test("удваивается и упирается в минуту", () => {
    expect([0, 1, 2, 5, 6, 10].map(backoffDelay)).toEqual([1000, 2000, 4000, 32000, 60000, 60000]);
  });
});

describe("arrangeChatTree — Fork под родителем (доступная замена дерева)", () => {
  const fork = (parent: string) => ({ chat_id: parent, message_id: "c1", commit_sha: "a3f8c91" });
  const flat = (nodes: ChatTreeNode[]): Array<[string, number]> =>
    nodes.flatMap((n) => [[n.chat.chat_id, n.depth] as [string, number], ...flat(n.children)]);

  test("без Fork — как обычный список", () => {
    const list = [
      chat({ chat_id: "20261023-aaaa", updated_at: "2026-10-23T10:00:00Z" }),
      chat({ chat_id: "20261023-bbbb", updated_at: "2026-10-23T11:00:00Z" }),
      chat({ chat_id: "20261023-cccc", state: "closed" }),
    ];
    const t = arrangeChatTree(list, "");
    expect(flat(t.open)).toEqual([["20261023-bbbb", 0], ["20261023-aaaa", 0]]);
    expect(flat(t.archived)).toEqual([["20261023-cccc", 0]]);
  });

  test("дети с отступом под родителем, внуки глубже; открытые первыми, свежие выше", () => {
    const list = [
      chat({ chat_id: "20261023-root", title: "RoboChain", updated_at: "2026-10-23T09:00:00Z" }),
      chat({ chat_id: "20261023-old1", parent: fork("20261023-root"), updated_at: "2026-10-23T10:00:00Z" }),
      chat({ chat_id: "20261023-new1", parent: fork("20261023-root"), updated_at: "2026-10-23T12:00:00Z" }),
      chat({ chat_id: "20261023-shut", parent: fork("20261023-root"), state: "closed", updated_at: "2026-10-23T13:00:00Z" }),
      chat({ chat_id: "20261023-gran", parent: fork("20261023-old1"), updated_at: "2026-10-23T10:30:00Z" }),
      chat({ chat_id: "20261023-solo", updated_at: "2026-10-23T11:00:00Z" }),
    ];
    const t = arrangeChatTree(list, "");
    expect(flat(t.open)).toEqual([
      ["20261023-solo", 0],
      ["20261023-root", 0],
      ["20261023-new1", 1],
      ["20261023-old1", 1],
      ["20261023-gran", 2],
      ["20261023-shut", 1],
    ]);
    expect(t.archived).toEqual([]);
    const child = t.open[1]!.children[0]!;
    expect(child.parentTitle).toBe("RoboChain");
  });

  test("закрытый родитель с открытым ребёнком остаётся среди открытых; всё закрытое — в архив деревом", () => {
    const list = [
      chat({ chat_id: "20261023-root", state: "closed" }),
      chat({ chat_id: "20261023-kid1", parent: fork("20261023-root") }),
      chat({ chat_id: "20261023-arch", state: "closed" }),
      chat({ chat_id: "20261023-kid2", state: "closed", parent: fork("20261023-arch") }),
    ];
    const t = arrangeChatTree(list, "");
    expect(flat(t.open)).toEqual([["20261023-root", 0], ["20261023-kid1", 1]]);
    expect(flat(t.archived)).toEqual([["20261023-arch", 0], ["20261023-kid2", 1]]);
  });

  test("не глубже четырёх уровней: дальше — тем же отступом следом", () => {
    const ids = ["20261023-lv00", "20261023-lv01", "20261023-lv02", "20261023-lv03", "20261023-lv04", "20261023-lv05"];
    const list = ids.map((id, i) => chat({ chat_id: id, parent: i ? fork(ids[i - 1]!) : null }));
    const t = arrangeChatTree(list, "");
    expect(flat(t.open)).toEqual([
      ["20261023-lv00", 0],
      ["20261023-lv01", 1],
      ["20261023-lv02", 2],
      ["20261023-lv03", 3],
      ["20261023-lv04", 3],
      ["20261023-lv05", 3],
    ]);
  });

  test("сирота — корень", () => {
    const t = arrangeChatTree([chat({ chat_id: "20261023-orph", parent: fork("20261001-gone") })], "");
    expect(flat(t.open)).toEqual([["20261023-orph", 0]]);
    expect(t.open[0]!.parentTitle).toBeNull();
  });

  test("поиск — плоско, находит и детей", () => {
    const list = [
      chat({ chat_id: "20261023-root", title: "RoboChain" }),
      chat({ chat_id: "20261023-kid1", title: "Мост для RoboChain", parent: fork("20261023-root"), updated_at: "2026-10-23T12:00:00Z" }),
      chat({ chat_id: "20261023-othr", title: "Другое" }),
    ];
    const t = arrangeChatTree(list, "robo");
    expect(flat(t.open)).toEqual([["20261023-kid1", 0], ["20261023-root", 0]]);
    expect(t.open[0]!.parentTitle).toBe("RoboChain");
  });
});
