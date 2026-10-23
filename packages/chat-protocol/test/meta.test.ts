import { describe, expect, test } from "bun:test";
import {
  buildPrBody,
  chatTitleFromPr,
  parseChatJson,
  parseCommentMeta,
  parsePrBody,
  serializeChatJson,
  withCommentMeta,
} from "../src/meta.ts";
import { displayName, isAgent, resolveAuthor } from "../src/agents.ts";

describe("комментарий PR с блоком chat0110", () => {
  test("вырезает блок из текста и читает поля", () => {
    const body = "Альтернатива — мост.\n\n<!-- chat0110\nid: 20261023T102200Z-codex-m3p8\nauthor: codex\nreply_to: 20261023T100300Z-alex011082-q9w1\n-->\n";
    expect(parseCommentMeta(body)).toEqual({
      text: "Альтернатива — мост.",
      meta: { id: "20261023T102200Z-codex-m3p8", author: "codex", reply_to: "20261023T100300Z-alex011082-q9w1" },
    });
  });

  test("без блока — только текст", () => {
    expect(parseCommentMeta("Просто комментарий")).toEqual({ text: "Просто комментарий", meta: {} });
  });

  test("мусорные значения в блоке отбрасываются", () => {
    const body = "Текст\n<!-- chat0110\nid: ../../etc\nauthor: Codex Bot\n-->";
    expect(parseCommentMeta(body).meta).toEqual({});
  });

  test("запись блока читается обратно", () => {
    const body = withCommentMeta("Ответ", { id: "20261023T102200Z-codex-m3p8", author: "codex" });
    expect(parseCommentMeta(body)).toEqual({
      text: "Ответ",
      meta: { id: "20261023T102200Z-codex-m3p8", author: "codex" },
    });
  });
});

describe("тело PR чата", () => {
  test("собранное тело содержит chat_id и читается обратно", () => {
    const body = buildPrBody({ chatId: "20261023-k7q2", intro: "Обсуждаем захват." });
    expect(body).toContain("chats/AGENTS.md");
    expect(parsePrBody(body)).toEqual({ chat_id: "20261023-k7q2", schema_version: 1 });
  });

  test("PR без блока — не чат", () => {
    expect(parsePrBody("обычный PR")).toBeNull();
    expect(parsePrBody(null)).toBeNull();
  });

  test("название чата без префикса [chat]", () => {
    expect(chatTitleFromPr("[chat] RoboChain")).toBe("RoboChain");
    expect(chatTitleFromPr("RoboChain")).toBe("RoboChain");
  });
});

describe("chat.json", () => {
  const meta = {
    schema_version: 1 as const,
    chat_id: "20261023-k7q2",
    title: "RoboChain — захват коробок",
    created_at: "2026-10-23T10:02:00.000Z",
    created_by: "alex011082",
    parent: null,
  };

  test("запись и чтение", () => {
    expect(parseChatJson(serializeChatJson(meta))).toEqual(meta);
  });

  test("битый или чужой JSON — null", () => {
    expect(parseChatJson("{")).toBeNull();
    expect(parseChatJson(JSON.stringify({ ...meta, chat_id: "../x" }))).toBeNull();
  });
});

describe("авторы", () => {
  test("bot-логины агентов сводятся к id агента", () => {
    expect(resolveAuthor("chatgpt-codex-connector[bot]")).toBe("codex");
    expect(resolveAuthor("Claude[bot]")).toBe("claude");
  });

  test("человек — его логин в нижнем регистре", () => {
    expect(resolveAuthor("Alex011082")).toBe("alex011082");
  });

  test("имя для показа", () => {
    expect(displayName("codex")).toBe("Codex");
    expect(displayName("alex011082")).toBe("alex011082");
    expect(isAgent("claude")).toBe(true);
    expect(isAgent("alex011082")).toBe(false);
  });
});
