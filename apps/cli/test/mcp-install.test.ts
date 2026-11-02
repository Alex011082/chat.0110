import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMcp, mcpConfiguration } from "../src/mcp-install.ts";

test("установщик регистрирует стабильный stdio через CLI, повтор безопасен, чужую запись не удаляет", () => {
  const root = mkdtempSync(join(tmpdir(), "chat0110-install-"));
  const calls: Array<[string, string[]]> = [];
  let existing = "";
  const run = (command: string, args: string[]) => {
    calls.push([command, args]);
    if (args[1] === "get") return { status: existing ? 0 : 1, stdout: existing, stderr: "" };
    existing = args.join(" "); return { status: 0, stdout: "ok", stderr: "" };
  };
  try {
    const options = { client: "claude-code" as const, root, source: new URL("../src/mcp-cli.ts", import.meta.url).pathname, authFile: join(root, "auth.json"), node: "/fixture/node", run };
    const first = installMcp(options);
    expect(existsSync(first.entry)).toBe(true);
    expect(first.entry).not.toBe(options.source);
    expect(readFileSync(first.entry, "utf8")).toContain("serve");
    expect(calls.some(([cmd, a]) => cmd === "claude" && a.includes("stdio") && a.includes(first.entry) && a.includes("--channel"))).toBe(true);
    const adds = calls.filter(([, a]) => a[1] === "add").length;
    installMcp(options);
    expect(calls.filter(([, a]) => a[1] === "add").length).toBe(adds);
    existing = "command: foreign-server /other/project";
    expect(() => installMcp(options)).toThrow("занято");
    expect(calls.some(([, a]) => a.includes("remove"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("универсальная конфигурация содержит полноценный stdio, никаких ключей или произвольного shell", () => {
  const config = mcpConfiguration("codex", "/private/mcp.mjs", "/private/oauth.json", "/usr/local/bin/node");
  expect(config.command).toBe("/usr/local/bin/node");
  expect(config.args).toContain("serve");
  expect(JSON.stringify(config)).not.toMatch(/Bearer|access_token|\/bin\/sh|eval/);
  expect(config.args).toContain("--author");
  expect(config.args).not.toContain("--channel");
  expect(mcpConfiguration("other", "/private/mcp.mjs", "/private/oauth.json").args).not.toContain("--author");
});
