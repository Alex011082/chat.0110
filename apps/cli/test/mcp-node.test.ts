import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("Node stdio: настоящий MCP handshake, общий OAuth refresh, полный ход без Bun/gh", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat0110-node-mcp-"));
  const build = await Bun.build({ entrypoints: [new URL("../src/mcp-cli.ts", import.meta.url).pathname], target: "node", format: "esm", outdir: root, naming: "mcp.mjs" });
  expect(build.success).toBe(true);
  let refreshed = 0, completed = 0;
  const issued = new Set<string>();
  const channelKeys=new Map<string,string>();
  const externals=new Map<string,string>();
  const channelIdentities=new Map<string,string>();
  const api = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.text(), path = new URL(req.url).pathname;
    if (path === "/oauth/token") {
      refreshed++; expect(new URLSearchParams(body).get("refresh_token")).toBe("old-refresh");
      await Bun.sleep(50);
      return Response.json({ access_token: "node-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600 });
    }
    expect(req.headers.get("authorization")).toBe("Bearer node-access");
    expect(req.headers.get("x-chat0110-auth")).toBe("oauth");
    const p = JSON.parse(body);
    if (path.endsWith("/register")) {
      expect(p.channel_key).toMatch(/^[a-f0-9]{64}$/);
      if(channelKeys.has(p.alias)&&p.replacement_code==="c3".repeat(32)){
        expect(p.channel_key).not.toBe(channelKeys.get(p.alias));expect(p.session_id).not.toBe(externals.get(p.alias));
        channelKeys.set(p.alias,p.channel_key);
      }
      else if(channelKeys.has(p.alias))expect(p.channel_key).toBe(channelKeys.get(p.alias));
      else channelKeys.set(p.alias,p.channel_key);
      externals.set(p.alias,p.session_id);
      if(p.alias==="node-0"&&!issued.has("node-0"))expect(p.replacement_code).toBe("a1".repeat(32));
      return Response.json({ version: "2.1.0", id: p.alias, alias: p.alias, auto_enabled: true });
    }
    expect(p.channel_key).toBe(channelKeys.get(p.session_id));
    if (path.endsWith("/status")) return Response.json({ session: { id: p.session_id, auto_enabled: true } });
    if (path.endsWith("/next")) {
      if (issued.has(p.session_id)) return Response.json({ task: null });
      issued.add(p.session_id); return Response.json({ task: { id: "task-" + p.session_id, claim: "fixture-claim" }, prompt: "synthetic", final: true });
    }
    if (path.endsWith("/context")) { expect(p.claim).toBe("fixture-claim"); return Response.json({ items: [] }); }
    if (path.endsWith("/complete")) { expect(p.claim).toBe("fixture-claim"); expect(p.text).toBe("Finished synthetic answer"); completed++; return Response.json({ item: { id: "answer" } }); }
    return Response.json({ ok: true });
  } });
  const authFile = join(root, "oauth.json"), origin = `http://127.0.0.1:${api.port}`;
  writeFileSync(authFile, JSON.stringify({ origin, client: "client", access: "expired", refresh: "old-refresh", expires: 0 }), { mode: 0o600 });
  const clients = [new Client({ name: "node-fixture-a", version: "1" }), new Client({ name: "node-fixture-b", version: "1" }), new Client({ name: "node-channel-fixture", version: "1" })];
  try {
    await Promise.all(clients.map(async (client, i) => {
      const home = join(root, `home-${i}`); mkdirSync(home);
      const notices: any[] = [];
      client.fallbackNotificationHandler = async notice => { if (notice.method === "notifications/claude/channel") notices.push(notice.params); };
      const transport = new StdioClientTransport({ command: "node", args: [join(root, "mcp.mjs"), "serve", "--auth-file", authFile, ...(i === 2 ? ["--author", "claude", "--channel"] : i ? [] : ["--author", "codex"])], env: { CHAT0110_HOME: home, CHAT0110_URL: origin, PATH: process.env.PATH! }, stderr: "pipe" });
      await client.connect(transport);
      expect((await client.listTools()).tools.map(t => t.name)).toContain("chat0110_connect");
      const invoke = async (name: string, arguments_: Record<string, unknown> = {}) => {
        const result: any = await client.callTool({ name, arguments: arguments_ });
        expect(result.isError).not.toBe(true); return JSON.parse(result.content[0].text);
      };
      const connected=await invoke("chat0110_connect", { repo: "a/b", chat_id: "20261102-abcd", alias: `node-${i}`, author: i === 2 ? "claude" : i ? "gemini" : "codex", name: "Fixture",...(i===0?{replacement_code:"a1".repeat(32)}:{}) });
      expect(JSON.stringify(connected)).not.toContain(channelKeys.get(`node-${i}`)!);
      expect(JSON.stringify(connected)).not.toContain("a1".repeat(32));
      if(i===0)expect(connected.channel_id).toMatch(/^[a-f0-9]{64}$/);
      if (i === 2) {
        const end = Date.now() + 2000; while (!notices.length && Date.now() < end) await Bun.sleep(10);
        expect(notices).toHaveLength(1);
        const nonce = notices[0].content.match(/nonce ([a-f0-9-]+)/)[1];
        await invoke("chat0110_channel_ack", { nonce });
        const until = Date.now() + 2500; while (!notices.some(n => n.meta?.task_id) && Date.now() < until) await Bun.sleep(10);
        expect(notices.some(n => n.meta?.task_id)).toBe(true);
        expect(JSON.stringify(notices)).not.toContain("fixture-claim");
      }
      const next = await invoke("chat0110_next");
      await invoke("chat0110_context");
      await invoke("chat0110_reply", { task_id: next.task.id, text: "Finished synthetic answer", outcome: "complete" });
    }));
    expect(refreshed).toBe(1); expect(completed).toBe(3);
    const target=new Client({name:"replacement-target",version:"1"});
    try{
      await target.connect(new StdioClientTransport({command:"node",args:[join(root,"mcp.mjs"),"serve","--auth-file",authFile,"--author","codex"],env:{CHAT0110_HOME:join(root,"home-0"),CHAT0110_URL:origin,PATH:process.env.PATH!},stderr:"pipe"}));
      const transferred:any=await target.callTool({name:"chat0110_connect",arguments:{repo:"a/b",chat_id:"20261102-abcd",alias:"node-0",author:"codex",name:"Fixture",replacement_code:"c3".repeat(32)}});
      expect(transferred.isError).not.toBe(true);
      const receipt=JSON.parse(transferred.content[0].text);expect(receipt.channel_id).toMatch(/^[a-f0-9]{64}$/);channelIdentities.set("node-0",receipt.channel_id);
    }finally{await target.close();}
    const restarted=new Client({name:"node-restarted",version:"1"});
    try{
      await restarted.connect(new StdioClientTransport({command:"node",args:[join(root,"mcp.mjs"),"serve","--auth-file",authFile,"--author","codex"],env:{CHAT0110_HOME:join(root,"home-0"),CHAT0110_URL:origin,PATH:process.env.PATH!},stderr:"pipe"}));
      const result=await restarted.callTool({name:"chat0110_connect",arguments:{repo:"a/b",chat_id:"20261102-abcd",alias:"node-0",author:"codex",name:"Fixture",channel_id:channelIdentities.get("node-0")}});
      expect(result.isError).not.toBe(true);expect(channelKeys.size).toBe(3);
    }finally{await restarted.close();}
  } finally { await Promise.all(clients.map(c => c.close())); api.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 15000);
