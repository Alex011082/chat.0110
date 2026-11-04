import { test, expect } from "bun:test";
import { MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import { agentCards } from "../src/lib/agent-catalog.ts";
import { mcpSetupCommand, connectContext,sessionSetupTask } from "../src/lib/mcp-setup.ts";

test("установка ведёт к настоящему версионированному пакету, не к заданию для модели", () => {
  for (const id of ["codex", "claude-code", "grok-build", "other-ai"]) {
    const command = mcpSetupCommand({ id })!;
    expect(command).toContain(`chat0110-mcp-${MCP_PACKAGE_VERSION}.tgz`);
    expect(command).toContain(" setup --client ");
    expect(command).not.toMatch(/[\n;&|]|gh auth|API_KEY|participation/i);
  }
  for (const card of agentCards(false).filter(c => ["chatgpt", "claude-chat", "claude-work", "grok"].includes(c.id))) expect(mcpSetupCommand(card)).toBeNull();
});
test("запрос мастера привязан к чату для каждого клиента и не требует опроса моделью",()=>{
 for(const en of [false,true])for(const card of agentCards(en)){
  const task=sessionSetupTask(card,en,{repo:"owner/product",chat_id:"20261103-abcd"});
  expect(task).toContain('"repo":"owner/product"');expect(task).toContain('"chat_id":"20261103-abcd"');
  expect(task).toContain("chat0110_connect");expect(task).toContain("session_id");expect(task).not.toContain("chat0110_pending");
 }
});
test("контекст чата сохраняется без shell-аргументов и произвольных адресов", () => {
  expect(connectContext("?repo=a/b&chat=20261102-abcd")).toEqual({ repo: "a/b", chat_id: "20261102-abcd" });
  expect(connectContext("?repo=a/b;echo&chat=20261102-abcd")).toBeNull();
  expect(connectContext("?repo=https://evil.test&chat=20261102-abcd")).toBeNull();
});

test("локальный клиент получает маршрут next/context/reply, а не команды удалённого Apps-коннектора", () => {
  for (const en of [false, true]) for (const card of agentCards(en).filter(c => ["codex", "claude-code", "grok-build", "other-ai"].includes(c.id))) {
    const task = sessionSetupTask(card, en, {repo:"owner/product",chat_id:"20261103-abcd"});
    expect(task).toContain("chat0110_next");
    expect(task).not.toContain("chat0110_take");
    expect(task).not.toContain("chat0110_pending");
  }
});
