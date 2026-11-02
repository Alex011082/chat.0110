import { MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import type { AgentCard, ChatContext } from "./agent-catalog.ts";
export const mcpPackageUrl = `https://chat.0110.digital/downloads/chat0110-mcp-${MCP_PACKAGE_VERSION}.tgz`;
export function terminalClient(card: Pick<AgentCard, "id">): string | null {
  return ["codex", "claude-code", "grok-build"].includes(card.id) ? card.id : card.id === "other-ai" ? "other" : null;
}
export function mcpSetupCommand(card: Pick<AgentCard, "id">): string | null {
  const client = terminalClient(card);
  return client ? `npx --yes --package=${mcpPackageUrl} chat0110 setup --client ${client}` : null;
}
export function connectContext(search: string): ChatContext | null {
  const p = new URLSearchParams(search), repo = p.get("repo") ?? "", chat_id = p.get("chat") ?? "";
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) && /^\d{8}-[a-z0-9]{4}$/.test(chat_id) ? { repo, chat_id } : null;
}
