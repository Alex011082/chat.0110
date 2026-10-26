import { describe, expect, test } from "bun:test";
import {
  GAP_BOUNDARY,
  assembleChain,
  gapComments,
  gapCycle,
  inheritedItems,
  parentSlice,
  parseForkContext,
  serializeForkContext,
  type ForkContextFile,
} from "../src/fork-context.ts";
import { serializeMessageFile } from "../src/message-file.ts";

const CHAT = "20261023-k7q2";
const SHA = "2".repeat(40);
const A = "20261023T100300Z-alex011082-q9w1";
const C = "20261023T101400Z-claude-x7k2";
const LATE = "20261023T103000Z-codex-g7g7";

const file = (id: string, author: string, at: string, text: string) => ({
  name: `${id}.md`,
  content: serializeMessageFile({ id, author, created_at: at, text }),
});

describe("parentSlice", () => {
  test("поздний файл и поздний комментарий не входят, точка-комментарий входит", () => {
    const slice = parentSlice({
      chatId: CHAT,
      title: "Тема",
      number: 5,
      messageId: "c101",
      commitSha: SHA,
      files: [
        file(A, "alex011082", "2026-10-23T10:03:00Z", "Рано"),
        file(LATE, "codex", "2026-10-23T10:30:00Z", "Поздно"),
      ],
      comments: [
        { id: 101, login: "claude[bot]", body: "На точке.", created_at: "2026-10-23T10:17:00Z", url: "u" },
        { id: 102, login: "bob", body: "После.", created_at: "2026-10-23T10:40:00Z", url: "u2" },
      ],
      reviews: [],
      reviewComments: [],
    });
    expect(slice.boundaryKnown).toBe(true);
    expect(slice.ancestor.messages.map((m) => m.id)).toEqual([A, "c101"]);
    expect(slice.ancestor.messages[1]).toMatchObject({ source: "comment", author: "claude", origin_chat_id: CHAT });
  });

  test("точка не найдена — файлы коммита остаются, комментарии нет", () => {
    const slice = parentSlice({
      chatId: CHAT, title: "Тема", number: null, messageId: "c404", commitSha: SHA,
      files: [file(A, "alex011082", "2026-10-23T10:03:00Z", "Есть")],
      comments: [{ id: 1, login: "bob", body: "Живой", created_at: "2026-10-23T10:01:00Z", url: "u" }],
      reviews: [], reviewComments: [],
    });
    expect(slice.boundaryKnown).toBe(false);
    expect(slice.ancestor.messages.map((m) => m.id)).toEqual([A]);
  });
});

describe("assembleChain", () => {
  const ancestor = (id: string) => ({
    chat_id: id, title: id, number: null, boundary_message_id: "m", commit_sha: SHA, messages: [],
  });

  test("от корня к родителю, комментарии предка не заморожены", () => {
    const chain = assembleChain([
      { ancestor: ancestor("20261023-bbbb"), commentsFrozen: true },
      { ancestor: ancestor("20261023-aaaa"), commentsFrozen: false },
    ]);
    expect(chain.ancestors.map((a) => a.chat_id)).toEqual(["20261023-aaaa", "20261023-bbbb"]);
    expect(chain.complete).toBe(false);
    expect(chain.gaps).toEqual([gapComments("20261023-aaaa")]);
  });

  test("цикл обрывает цепь и не дублирует чат", () => {
    const chain = assembleChain([
      { ancestor: ancestor(CHAT), commentsFrozen: true },
      { ancestor: ancestor(CHAT), commentsFrozen: true },
    ]);
    expect(chain.ancestors.map((a) => a.chat_id)).toEqual([CHAT]);
    expect(chain.complete).toBe(false);
    expect(chain.gaps).toEqual([gapCycle(CHAT)]);
  });
});

describe("parseForkContext", () => {
  test("круг и порча", () => {
    const file: ForkContextFile = {
      schema_version: 1,
      chat_id: "20261023-m2p9",
      created_at: "2026-10-23T10:02:03Z",
      created_by: "alex011082",
      parent: { chat_id: CHAT, message_id: C, commit_sha: SHA },
      complete: true,
      gaps: [],
      ancestors: [{
        chat_id: CHAT, title: "Тема", number: 5, boundary_message_id: C, commit_sha: SHA,
        messages: [{ id: A, origin_chat_id: CHAT, author: "alex011082", source: "file", created_at: "2026-10-23T10:03:00.000Z", text: "Да" }],
      }],
    };
    const parsed = parseForkContext(serializeForkContext(file));
    expect(parsed).toEqual({ ...file, created_at: "2026-10-23T10:02:03.000Z" });
    expect(parseForkContext("{")).toBeNull();
    expect(inheritedItems(file.ancestors).map((m) => m.id)).toEqual([A]);
    expect(GAP_BOUNDARY.length).toBeGreaterThan(0);
  });
});
