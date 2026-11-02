import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { MCP_PACKAGE_VERSION as version } from "../apps/cli/src/mcp-install.ts";

const root = dirname(dirname(import.meta.path)), temp = mkdtempSync(join(tmpdir(), "chat0110-mcp-package-"));
try {
  const pkg = join(temp, "package"); mkdirSync(pkg);
  const build = await Bun.build({ entrypoints: [join(root, "apps/cli/src/mcp-cli.ts")], target: "node", format: "esm", minify: true, outdir: pkg, naming: "mcp.mjs" });
  if (!build.success) throw Error("Не удалось собрать Node MCP: " + build.logs.map(String).join("\n"));
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@chat0110/mcp", version, private: true, type: "module", bin: { chat0110: "mcp.mjs" }, engines: { node: ">=22" }, license: "UNLICENSED", description: "CHAT.0110 — stdio MCP и установка подключения", homepage: "https://chat.0110.digital/connect" }, null, 2) + "\n");
  writeFileSync(join(pkg, "THIRD_PARTY_NOTICES.txt"), readFileSync(join(root, "plugins/claude-code/THIRD_PARTY_NOTICES.txt")));
  writeFileSync(join(pkg, "README.md"), `# CHAT.0110 MCP ${version}\n\nПолноценный stdio MCP на Node.js 22+. Без Bun, gh и платных API.\n\nchat0110 setup --client codex|claude-code|grok-build|other\nchat0110 config\nchat0110 serve\n\nУстановка не запускает новую беседу и не обходит допуск каналов клиента.\nДокументация: https://chat.0110.digital/connect\n`);
  const downloads = join(root, "apps/web/public/downloads"); mkdirSync(downloads, { recursive: true });
  const filename = `chat0110-mcp-${version}.tgz`, output = join(downloads, filename);
  const packed = spawnSync("python3", [join(root, "scripts/mcp-tar.py"), temp, output], { encoding: "utf8" });
  if (packed.status !== 0) throw Error("Не удалось упаковать MCP: " + packed.stderr);
  const bytes = readFileSync(output), sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(output + ".sha256", `${sha256}  ${filename}\n`);
  writeFileSync(join(downloads, "mcp.json"), JSON.stringify({ version, url: `/downloads/${filename}`, bytes: bytes.length, sha256, node: ">=22", official: false }, null, 2) + "\n");
  console.log(`Node MCP ${version}: ${bytes.length} bytes`);
} finally { rmSync(temp, { recursive: true, force: true }); }
