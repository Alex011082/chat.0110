import { describe, expect, test } from "bun:test";
import { parseMessageFile, serializeMessageFile } from "../src/message-file.ts";

const name = "20261023T101400Z-claude-x7k2.md";

describe("файл-сообщение", () => {
  test("читает frontmatter и текст", () => {
    const content = [
      "---",
      "id: 20261023T101400Z-claude-x7k2",
      "author: claude",
      "reply_to: 20261023T100300Z-alex011082-q9w1",
      "created_at: 2026-10-23T10:14:00Z",
      "---",
      "Предлагаю вакуумные руки.",
      "",
    ].join("\n");
    expect(parseMessageFile(name, content)).toEqual({
      id: "20261023T101400Z-claude-x7k2",
      author: "claude",
      reply_to: "20261023T100300Z-alex011082-q9w1",
      created_at: "2026-10-23T10:14:00.000Z",
      text: "Предлагаю вакуумные руки.",
    });
  });

  test("без frontmatter берёт id, автора и время из имени файла", () => {
    expect(parseMessageFile(name, "Просто текст.\n")).toEqual({
      id: "20261023T101400Z-claude-x7k2",
      author: "claude",
      created_at: "2026-10-23T10:14:00.000Z",
      text: "Просто текст.",
    });
  });

  test("понимает переводы строк Windows и кавычки в значениях", () => {
    const content = '---\r\nauthor: "codex"\r\ncreated_at: \'2026-10-23T10:20:00Z\'\r\n---\r\nТекст\r\n';
    const msg = parseMessageFile("20261023T102000Z-codex-m3p8.md", content);
    expect(msg?.author).toBe("codex");
    expect(msg?.created_at).toBe("2026-10-23T10:20:00.000Z");
    expect(msg?.text).toBe("Текст");
  });

  test("id всегда из имени файла: frontmatter не может выдать себя за чужое сообщение", () => {
    const content = "---\nid: 20261023T100300Z-alex011082-q9w1\nauthor: claude\n---\nТекст";
    expect(parseMessageFile(name, content)?.id).toBe("20261023T101400Z-claude-x7k2");
  });

  test("недопустимый автор во frontmatter заменяется автором из имени", () => {
    const content = "---\nauthor: Claude Code!\n---\nТекст";
    expect(parseMessageFile(name, content)?.author).toBe("claude");
  });

  test("невалидная дата во frontmatter заменяется временем из имени", () => {
    const content = "---\ncreated_at: вчера\n---\nТекст";
    expect(parseMessageFile(name, content)?.created_at).toBe("2026-10-23T10:14:00.000Z");
  });

  test("файл с неправильным именем — не сообщение", () => {
    expect(parseMessageFile("notes.md", "текст")).toBeNull();
  });

  test("незакрытый frontmatter считается текстом", () => {
    expect(parseMessageFile(name, "---\nauthor: claude\nТекст")?.text).toBe("---\nauthor: claude\nТекст");
  });

  test("запись и чтение возвращают то же сообщение", () => {
    const msg = {
      id: "20261023T101400Z-alex011082-q9w1",
      author: "alex011082",
      reply_to: "20261023T100000Z-claude-aaaa",
      created_at: "2026-10-23T10:14:00.000Z",
      text: "Две строки\nвторая",
    };
    const file = serializeMessageFile(msg);
    expect(file.startsWith("---\nid: 20261023T101400Z-alex011082-q9w1\n")).toBe(true);
    expect(parseMessageFile(`${msg.id}.md`, file)).toEqual(msg);
  });

  test("запись без reply_to не пишет пустое поле", () => {
    const file = serializeMessageFile({
      id: "20261023T101400Z-alex011082-q9w1",
      author: "alex011082",
      created_at: "2026-10-23T10:14:00.000Z",
      text: "Привет",
    });
    expect(file).not.toContain("reply_to");
  });
});
