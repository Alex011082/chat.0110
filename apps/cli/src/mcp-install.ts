import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { join, delimiter } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { MCP_PACKAGE_VERSION, MCP_ENTRY_NAME } from "@chat0110/chat-protocol";
export { MCP_PACKAGE_VERSION, MCP_ENTRY_NAME };
export type TerminalClient = "codex" | "claude-code" | "grok-build" | "other";
const authorOf = (client: TerminalClient) => client === "claude-code" ? "claude" : client === "grok-build" ? "grok" : client === "other" ? "agent" : "codex";
function nodeExecutable() {
  // Homebrew удаляет старый Cellar при обновлении; используем проверенную
  // стабильную ссылку на тот же Node, если она есть в PATH.
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || dir.includes("/Cellar/")) continue;
    const candidate = join(dir, process.platform === "win32" ? "node.exe" : "node");
    try { if (realpathSync(candidate) === realpathSync(process.execPath)) return candidate; } catch { /* Ищем только установленный исполняемый файл. */ }
  }
  return process.execPath;
}
export function mcpConfiguration(client: TerminalClient, entry: string, authFile: string, node = nodeExecutable()) {
  return { command: node, args: [entry, "serve", "--auth-file", authFile, ...(client === "other" ? [] : ["--author", authorOf(client)]), ...(client === "claude-code" ? ["--channel"] : [])] };
}
type Run = (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
export function installMcp(options: { client: TerminalClient; root: string; source: string; authFile: string; node?: string; run?: Run }) {
  const entry = join(options.root, "mcp.mjs"), config = mcpConfiguration(options.client, entry, options.authFile, options.node);
  const command = options.client === "claude-code" ? "claude" : options.client === "grok-build" ? "grok" : "codex";
  const run: Run = options.run ?? ((file, args) => spawnSync(file, args, { encoding: "utf8", timeout: 30000 }));
  let registered = false;
  if (options.client !== "other") {
    const previous = run(command, options.client === "grok-build" ? ["mcp", "list", "--json"] : ["mcp", "get", MCP_ENTRY_NAME, ...(options.client === "codex" ? ["--json"] : [])]);
    if (previous.status === null) throw Error(`Не найден CLI ${command}. Установи приложение или выбери универсальную конфигурацию.`);
    if (options.client === "grok-build" && previous.status !== 0) throw Error("Не удалось прочитать список MCP в Grok. Чужая конфигурация не изменена.");
    if (previous.status === 0) {
      let text = previous.stdout;
      if (options.client === "grok-build") {
        let found: unknown = null;
        const walk = (value: any) => { if (!value || typeof value !== "object") return; if (value.name === MCP_ENTRY_NAME || value.id === MCP_ENTRY_NAME) found = value; for (const [key, child] of Object.entries(value)) { if (key === MCP_ENTRY_NAME) found = child; else walk(child); } };
        try { walk(JSON.parse(text)); } catch { throw Error("Grok CLI не вернул конфигурацию JSON. Используй универсальную конфигурацию MCP."); }
        text = found ? JSON.stringify(found) : "";
      }
      try { text = JSON.stringify(JSON.parse(text), (_key, value) => value).replace(/\\\\/g, "\\"); } catch { /* Claude печатает обычный текст. */ }
      if (text || options.client !== "grok-build") {
        if (!text.includes(entry) || !text.includes(options.authFile)) throw Error(`Имя ${MCP_ENTRY_NAME} уже занято. Чужая конфигурация не изменена.`);
        registered = true;
      }
    }
  }
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  if (existsSync(entry) && lstatSync(entry).isSymbolicLink()) throw Error("Путь MCP не должен быть symlink.");
  const tmp = `${entry}.${randomUUID()}.tmp`;
  writeFileSync(tmp, readFileSync(options.source), { flag: "wx", mode: 0o600 });
  renameSync(tmp, entry);
  if (options.client !== "other" && !registered) {
    const args = ["mcp", "add", ...(options.client === "claude-code" ? ["--transport", "stdio", "--scope", "user"] : []), MCP_ENTRY_NAME, "--", config.command, ...config.args];
    if (run(command, args).status !== 0) throw Error(`CLI ${command} не смог добавить MCP. Остальные серверы не изменялись.`);
  }
  return { entry, config, name: MCP_ENTRY_NAME };
}
