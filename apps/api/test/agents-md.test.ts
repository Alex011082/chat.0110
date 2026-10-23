import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { CHATS_AGENTS_MD, CHATS_CLAUDE_MD } from "../src/agents-md.ts";

const root = resolve(import.meta.dir, "../../..");

test("встроенный протокол агентов совпадает с chats/AGENTS.md", async () => {
  expect(CHATS_AGENTS_MD).toBe(await Bun.file(resolve(root, "chats/AGENTS.md")).text());
  expect(CHATS_CLAUDE_MD).toBe(await Bun.file(resolve(root, "chats/CLAUDE.md")).text());
});
