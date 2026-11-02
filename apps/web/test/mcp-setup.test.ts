import { test, expect } from "bun:test";
import { MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import { agentCards } from "../src/lib/agent-catalog.ts";
import { mcpSetupCommand, connectContext } from "../src/lib/mcp-setup.ts";

test("установка ведёт к настоящему версионированному пакету, не к заданию для модели", () => {
  for (const id of ["codex", "claude-code", "grok-build", "other-ai"]) {
    const command = mcpSetupCommand({ id })!;
    expect(command).toContain(`chat0110-mcp-${MCP_PACKAGE_VERSION}.tgz`);
    expect(command).toContain(" setup --client ");
    expect(command).not.toMatch(/[\n;&|]|gh auth|API_KEY|participation/i);
  }
  for (const card of agentCards(false).filter(c => ["chatgpt", "claude-chat", "claude-work", "grok"].includes(c.id))) expect(mcpSetupCommand(card)).toBeNull();
});
test("контекст чата сохраняется без shell-аргументов и произвольных адресов", () => {
  expect(connectContext("?repo=a/b&chat=20261102-abcd")).toEqual({ repo: "a/b", chat_id: "20261102-abcd" });
  expect(connectContext("?repo=a/b;echo&chat=20261102-abcd")).toBeNull();
  expect(connectContext("?repo=https://evil.test&chat=20261102-abcd")).toBeNull();
});
