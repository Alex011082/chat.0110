import { describe, expect, test } from "bun:test";
import { migrateDest, planMigrate, type MigrateFile } from "../src/migrate.ts";

const ID = "20261023-k7q2";
const PARENT = "20261023-test";
const JSON = `{\n  "schema_version": 1,\n  "chat_id": "${ID}",\n  "parent": { "chat_id": "${PARENT}" }\n}\n`;
const MSG = "---\nid: 20261023T100300Z-alex011082-q9w1\n---\nпривет\n";
const DEC = "---\nid: 20261023T090000Z-alex011082-d001\n---\nбыло\n";

const legacy: MigrateFile[] = [
  { path: `chats/${ID}/chat.json`, content: JSON },
  { path: `chats/${ID}/messages/20261023T100300Z-alex011082-q9w1.md`, content: MSG },
  { path: `chats/${ID}/decisions/20261023T090000Z-alex011082-d001.md`, content: DEC },
  { path: `chats/${ID}/notes.txt`, content: "мимо" },
  { path: `chats/${PARENT}/chat.json`, content: "родитель" },
  { path: `chats/${ID}/../../src/index.ts`, content: "нет" },
];

const none: Record<string, string | null> = {};

describe("перенос чата", () => {
  test("копирует паспорт, сообщения и решения и дописывает каркас", () => {
    const plan = planMigrate(ID, legacy, none);
    const paths = plan.create.map((f) => f.path);
    expect(plan.absent).toBe(false);
    expect(plan.conflicts).toEqual([]);
    expect(paths).toContain(`Chat/conversations/${ID}/chat.json`);
    expect(paths).toContain(`Chat/conversations/${ID}/messages/20261023T100300Z-alex011082-q9w1.md`);
    expect(paths).toContain(`Chat/conversations/${ID}/decisions/20261023T090000Z-alex011082-d001.md`);
    expect(paths).toContain("Chat/protocol.json");
    expect(paths).toContain("Chat/AGENTS.md");
    expect(paths).not.toContain("Chat/README.md");
    expect(paths.some((p) => p.startsWith("chats/") || p.includes(PARENT) || p.startsWith("src/"))).toBe(false);
    expect(plan.create.find((f) => f.path.endsWith("chat.json"))!.content).toBe(JSON);
    expect(plan.create.find((f) => f.path.endsWith("q9w1.md"))!.content).toBe(MSG);
    expect(plan.ignored).toEqual([`chats/${ID}/notes.txt`, `chats/${ID}/../../src/index.ts`]);
  });

  test("повторный план ничего не создаёт", () => {
    const first = planMigrate(ID, legacy, none);
    const existing: Record<string, string | null> = {};
    for (const file of first.create) existing[file.path] = file.content;
    const second = planMigrate(ID, legacy, existing);
    expect(second.create).toEqual([]);
    expect(second.conflicts).toEqual([]);
    expect(second.absent).toBe(false);
    expect(second.kept).toContain("Chat/AGENTS.md");
  });

  test("свой AGENTS.md остаётся", () => {
    const plan = planMigrate(ID, legacy, { "Chat/AGENTS.md": "# свой\n" });
    expect(plan.create.map((f) => f.path)).not.toContain("Chat/AGENTS.md");
    expect(plan.kept).toContain("Chat/AGENTS.md");
    expect(plan.create.map((f) => f.path)).toContain("Chat/protocol.json");
  });

  test("другой текст в Chat/ останавливает перенос целиком", () => {
    const dest = `Chat/conversations/${ID}/messages/20261023T100300Z-alex011082-q9w1.md`;
    const plan = planMigrate(ID, legacy, { [dest]: "другой\n" });
    expect(plan.create).toEqual([]);
    expect(plan.conflicts).toEqual([dest]);
    expect(plan.create.map((f) => f.path)).not.toContain("Chat/protocol.json");
  });

  test("битый protocol.json не перезаписывается", () => {
    const plan = planMigrate(ID, legacy, { "Chat/protocol.json": "{}\n" });
    expect(plan.protocolInvalid).toBe(true);
    expect(plan.create).toEqual([]);
  });

  test("без паспорта переносить нечего", () => {
    const plan = planMigrate(ID, [{ path: `chats/${ID}/messages/20261023T100300Z-alex011082-q9w1.md`, content: MSG }], none);
    expect(plan.absent).toBe(true);
    expect(plan.create).toEqual([]);
  });

  test("назначение пути не выходит из чата", () => {
    expect(migrateDest(ID, `chats/${ID}/chat.json`)).toBe(`Chat/conversations/${ID}/chat.json`);
    expect(migrateDest(ID, `chats/${PARENT}/chat.json`)).toBeNull();
    expect(migrateDest(ID, `chats/${ID}/../../src/index.ts`)).toBeNull();
  });
});
