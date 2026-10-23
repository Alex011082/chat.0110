import { describe, expect, test } from "bun:test";
import { buildPrBody, parseChatJson, parsePrBody, serializeChatJson } from "../src/meta.ts";
import { findForkCommit, type TimelineInput } from "../src/timeline.ts";

const PARENT = { chat_id: "20261023-k7q2", message_id: "20261023T101400Z-claude-x7k2", commit_sha: "a3f8c91d00000000000000000000000000000000" };

describe("Fork в теле PR", () => {
  test("тело PR дочернего чата несёт родителя и читается обратно", () => {
    const body = buildPrBody({ chatId: "20261024-m2p9", intro: "Механический захват", parent: PARENT });
    expect(body).toContain("Fork из чата `20261023-k7q2`");
    expect(parsePrBody(body)).toEqual({ chat_id: "20261024-m2p9", schema_version: 1, parent: PARENT });
  });

  test("у обычного чата родителя нет", () => {
    expect(parsePrBody(buildPrBody({ chatId: "20261023-k7q2" }))?.parent).toBeUndefined();
  });

  test("битый родитель в блоке игнорируется, чат остаётся чатом", () => {
    const body = "<!-- chat0110\nchat_id: 20261024-m2p9\nparent_chat_id: ../x\nparent_message_id: 1\nfork_commit_sha: zz\n-->";
    expect(parsePrBody(body)).toEqual({ chat_id: "20261024-m2p9", schema_version: 1 });
  });
});

describe("Fork в chat.json", () => {
  const meta = {
    schema_version: 1 as const,
    chat_id: "20261024-m2p9",
    title: "Выдвижной мост",
    created_at: "2026-10-24T09:00:00.000Z",
    created_by: "alex011082",
    parent: { ...PARENT, reason: "Исследовать механическую альтернативу" },
  };

  test("родитель с причиной пишется и читается", () => {
    expect(parseChatJson(serializeChatJson(meta))).toEqual(meta);
  });

  test("битый родитель — чат без родителя, а не мусор в графе", () => {
    const raw = JSON.stringify({ ...meta, parent: { chat_id: "x", message_id: 5, commit_sha: "nope" } });
    expect(parseChatJson(raw)?.parent).toBeNull();
  });
});

describe("точка ветвления", () => {
  const CHAT = "20261023-k7q2";
  const dir = `chats/${CHAT}/messages`;
  const M1 = "20261023T100300Z-alex011082-q9w1";
  const M2 = "20261023T101400Z-claude-x7k2";
  const M3 = "20261023T102000Z-codex-m3p8";
  const input: TimelineInput = {
    chatId: CHAT,
    files: [],
    commits: [
      { sha: "c1", message: "создан", login: "a", name: "a", date: "2026-10-23T10:02:00Z", added: [`chats/${CHAT}/chat.json`, `${dir}/${M1}.md`], url: "" },
      { sha: "c2", message: "claude", login: "a", name: "a", date: "2026-10-23T10:15:00Z", added: [`${dir}/${M2}.md`], url: "" },
      { sha: "c3", message: "codex", login: "a", name: "a", date: "2026-10-23T10:21:00Z", added: [`${dir}/${M3}.md`], url: "" },
    ],
    comments: [
      { id: 77, login: "codex[bot]", body: "Комментарий", created_at: "2026-10-23T10:18:00Z", url: "" },
      { id: 78, login: "a", body: "x\n<!-- chat0110\nid: 20261023T102500Z-codex-zzzz\nauthor: codex\n-->", created_at: "2026-10-23T10:25:00Z", url: "" },
    ],
    reviews: [],
    reviewComments: [],
    agentPrs: [],
  };

  test("для файла-сообщения — коммит, который его добавил", () => {
    expect(findForkCommit(input, M2)).toBe("c2");
    expect(findForkCommit(input, M1)).toBe("c1");
  });

  test("для комментария — последний коммит не позже комментария", () => {
    expect(findForkCommit(input, "c77")).toBe("c2");
    expect(findForkCommit(input, "20261023T102500Z-codex-zzzz")).toBe("c3");
  });

  test("неизвестное сообщение — null", () => {
    expect(findForkCommit(input, "20261023T110000Z-claude-none")).toBeNull();
  });
});
