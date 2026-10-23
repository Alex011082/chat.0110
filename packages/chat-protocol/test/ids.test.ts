import { describe, expect, test } from "bun:test";
import {
  branchForChat,
  chatIdFromBranch,
  isChatId,
  isMessagePath,
  newChatId,
  newMessageId,
  parseMessageId,
  stampOf,
} from "../src/ids.ts";

const at = new Date("2026-10-23T10:14:05Z");
const fixed = () => "k7q2";

describe("chat_id", () => {
  test("собирается из даты UTC и четырёх символов", () => {
    expect(newChatId(at, fixed)).toBe("20261023-k7q2");
  });

  test("принимает только формат ГГГГММДД-xxxx", () => {
    expect(isChatId("20261023-k7q2")).toBe(true);
    expect(isChatId("20261023-test")).toBe(true);
    expect(isChatId("20261023-K7Q2")).toBe(false);
    expect(isChatId("2026-10-23-k7q2")).toBe(false);
    expect(isChatId("20261023-k7q2/../x")).toBe(false);
  });

  test("ветка чата и обратно", () => {
    expect(branchForChat("20261023-k7q2")).toBe("chat/20261023-k7q2");
    expect(chatIdFromBranch("chat/20261023-k7q2")).toBe("20261023-k7q2");
    expect(chatIdFromBranch("refs/heads/chat/20261023-k7q2")).toBe("20261023-k7q2");
    expect(chatIdFromBranch("feature/github-core")).toBeNull();
    expect(chatIdFromBranch("chat/не-чат")).toBeNull();
  });
});

describe("id сообщения", () => {
  test("штамп времени UTC без разделителей", () => {
    expect(stampOf(at)).toBe("20261023T101405Z");
  });

  test("собирается из штампа, автора и суффикса", () => {
    expect(newMessageId(at, "Alex011082", fixed)).toBe("20261023T101405Z-alex011082-k7q2");
  });

  test("отказывается собирать id с недопустимым автором", () => {
    expect(() => newMessageId(at, "../evil", fixed)).toThrow();
  });

  test("разбирается обратно, включая время", () => {
    expect(parseMessageId("20261023T101405Z-claude-x7k2")).toEqual({
      stamp: "20261023T101405Z",
      author: "claude",
      rand: "x7k2",
      date: "2026-10-23T10:14:05.000Z",
    });
  });

  test("автор может содержать дефис", () => {
    expect(parseMessageId("20261023T101405Z-gemini-pro-ab12")?.author).toBe("gemini-pro");
  });

  test("мусор не разбирается", () => {
    expect(parseMessageId("readme")).toBeNull();
    expect(parseMessageId("20261023T101405Z-claude")).toBeNull();
  });
});

describe("путь сообщения", () => {
  test("узнаёт файл-сообщение своего чата", () => {
    expect(isMessagePath("20261023-k7q2", "chats/20261023-k7q2/messages/20261023T101405Z-claude-x7k2.md")).toBe(true);
  });

  test("не путает с чужим чатом, вложенными папками и не-md", () => {
    expect(isMessagePath("20261023-k7q2", "chats/20261023-aaaa/messages/20261023T101405Z-claude-x7k2.md")).toBe(false);
    expect(isMessagePath("20261023-k7q2", "chats/20261023-k7q2/messages/x/20261023T101405Z-claude-x7k2.md")).toBe(false);
    expect(isMessagePath("20261023-k7q2", "chats/20261023-k7q2/chat.json")).toBe(false);
  });
});
