#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpCredentials, mcpOrigin } from "./mcp-auth.ts";
import { installMcp, MCP_PACKAGE_VERSION, type TerminalClient } from "./mcp-install.ts";

const args = process.argv.slice(2), command = args[0] ?? "help";
function value(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return;
  if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw Error(`Нет значения ${name}.`);
  return args[index + 1];
}
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Нужен Node.js 22 или новее.");
  const origin = mcpOrigin(process.env.CHAT0110_URL ?? "https://chat.0110.digital");
  const clientHome = process.env.CHAT0110_HOME ?? homedir();
  const state = join(clientHome, ".local", "state", "chat0110");
  const authFile = value("--auth-file") ?? join(state, "mcp-oauth.json");
  if (command === "serve") {
    process.env.CHAT0110_AUTH_FILE = authFile;
    process.env.CHAT0110_STATE_DIR = join(state, "sessions");
    const author = value("--author");
    if (author) process.env.CHAT0110_AUTHOR = author;
    process.env.CHAT0110_CHANNEL = args.includes("--channel") ? "1" : "0";
    await import("./connector.ts");
    return;
  }
  if (command === "setup" || command === "config") {
    const client = (value("--client") ?? "other") as TerminalClient;
    if (!["codex", "claude-code", "grok-build", "other"].includes(client)) throw Error("Неизвестный клиент MCP.");
    // Путь стабилен между версиями: конфигурации клиентов переживают обновление пакета.
    const installed = installMcp({ client: command === "config" ? "other" : client, root: join(clientHome, ".local", "share", "chat0110", "mcp"), source: fileURLToPath(import.meta.url), authFile });
    if (command === "setup") {
      const credentials = new McpCredentials(authFile, origin);
      await credentials.login(url => { console.error("Открой ссылку и один раз разреши подключение CHAT.0110:"); console.error(url.toString()); });
    }
    if (client === "other" || command === "config") console.log(JSON.stringify({ mcpServers: { [installed.name]: installed.config } }, null, 2));
    else console.log(`MCP ${installed.name} установлен для ${client}. Обнови инструменты MCP в своей сессии. Для участия вызови chat0110_connect; установка сама не создаёт участника.`);
    if (client === "claude-code") console.log(`Для событий нужен разрешённый канал ${installed.name}. Во время research preview: claude --dangerously-load-development-channels server:${installed.name}. Это отдельный допуск клиента; текущая сессия не перезапускалась.`);
    return;
  }
  console.log(`CHAT.0110 MCP ${MCP_PACKAGE_VERSION}\nsetup --client codex|claude-code|grok-build|other — OAuth и установка\nconfig — стандартная JSON-конфигурация stdio\nserve — полноценный MCP stdio (stdout только JSON-RPC)\nНужен Node.js 22+. Платные API и GitHub CLI не используются.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Не удалось запустить MCP."); process.exitCode = 1; });
