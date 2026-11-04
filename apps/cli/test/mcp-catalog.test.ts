import {test, expect} from "bun:test";
import {mkdtempSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {REMOTE_TOOLS} from "../../api/src/remote-mcp.ts";

test("doctor отклоняет доставленную старую Apps-схему до OAuth и регистрации участника", async () => {
  const root=mkdtempSync(join(tmpdir(),"chat0110-catalog-"));
  try {
    const built=await Bun.build({entrypoints:[new URL("../src/mcp-cli.ts",import.meta.url).pathname],target:"node",format:"esm",outdir:root,naming:"mcp.mjs"});
    expect(built.success).toBe(true);
    const catalog=join(root,"old-apps.json");
    const tool=(name:string,properties:Record<string,unknown>={},required:string[]=[])=>({name,inputSchema:{type:"object",properties,required}});
    writeFileSync(catalog,JSON.stringify({tools:[
      tool("chat0110_account"),tool("chat0110_connect"),tool("chat0110_context"),
      tool("chat0110_pending",{author:{type:"string"},wait:{type:"boolean"}}),
      tool("chat0110_reply"),tool("chat0110_take"),
    ]}));
    const child=Bun.spawn(["node",join(root,"mcp.mjs"),"doctor","--catalog",catalog],{env:{...process.env,CHAT0110_HOME:root,PATH:process.env.PATH!},stdout:"pipe",stderr:"pipe"});
    const [stdout,stderr,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(stderr).not.toContain("oauth/authorize");
    expect(status).toBe(2);
    const result=JSON.parse(stdout);
    expect(result.compatible).toBe(false);
    expect(result.surface).toBe("remote");
    expect(result.missing).toContain("chat0110_pending.session_id");
    expect(result.missing).toContain("chat0110_status");
    expect(result.missing).toContain("chat0110_set_auto_reply");
    expect(result.client_session).toBe("not_verified");
    expect(result.action).toBe("refresh_apps_catalog");
  } finally {rmSync(root,{recursive:true,force:true});}
},15000);

test("doctor принимает настоящий stdio-каталог, но не выдаёт его за готовую сессию",async()=>{
  const root=mkdtempSync(join(tmpdir(),"chat0110-local-catalog-")),client=new Client({name:"catalog-fixture",version:"1"});
  try{
    const built=await Bun.build({entrypoints:[new URL("../src/mcp-cli.ts",import.meta.url).pathname],target:"node",format:"esm",outdir:root,naming:"mcp.mjs"});expect(built.success).toBe(true);
    const entry=join(root,"mcp.mjs");
    await client.connect(new StdioClientTransport({command:"node",args:[entry,"serve","--auth-file",join(root,"unused-auth.json")],env:{CHAT0110_HOME:root,PATH:process.env.PATH!},stderr:"pipe"}));
    const local=await client.listTools();
    const run=async(catalog:unknown,file:string)=>{
      const path=join(root,file);writeFileSync(path,JSON.stringify(catalog));
      const child=Bun.spawn(["node",entry,"doctor","--catalog",path],{stdout:"pipe",stderr:"pipe"});
      const [text,error,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      expect(error).toBe("");return {status,data:JSON.parse(text)};
    };
    const native=await run(local,"local.json");expect(native.status).toBe(0);expect(native.data.surface).toBe("stdio");expect(native.data.client_session).toBe("not_verified");
    expect(native.data.flow).toEqual(["chat0110_next","chat0110_context","chat0110_reply"]);
    const remote=await run({jsonrpc:"2.0",id:1,result:{tools:REMOTE_TOOLS}},"remote.json");expect(remote.status).toBe(0);expect(remote.data.surface).toBe("remote");
    expect(remote.data.flow).toEqual(["chat0110_pending","chat0110_take","chat0110_context","chat0110_reply"]);
    const optional=structuredClone(REMOTE_TOOLS);const pending=optional.find(t=>t.name==="chat0110_pending")!;pending.inputSchema.required=[];
    const unsafe=await run({tools:optional},"optional-session.json");expect(unsafe.status).toBe(2);expect(unsafe.data.missing).toContain("chat0110_pending.session_id");
    const mixed=await run({tools:[...local.tools,...REMOTE_TOOLS]},"mixed.json");expect(mixed.status).toBe(2);expect(mixed.data.missing).toContain("single_transport_catalog");
    const hybrid=structuredClone(local) as {tools:any[]};
    hybrid.tools=hybrid.tools.map(tool=>tool.name==="chat0110_context"||tool.name==="chat0110_status"||tool.name==="chat0110_set_auto_reply"||tool.name==="chat0110_reply"?REMOTE_TOOLS.find(t=>t.name===tool.name)!:tool);
    const unusable=await run(hybrid,"hybrid.json");expect(unusable.status).toBe(2);expect(unusable.data.missing).toContain("chat0110_context.stateful");expect(unusable.data.missing).toContain("chat0110_status.stateful");expect(unusable.data.missing).toContain("chat0110_set_auto_reply.unsupported_required");expect(unusable.data.missing).toContain("chat0110_reply.unsupported_required");
    const unknown=structuredClone(local) as {tools:any[]};unknown.tools.find(t=>t.name==="chat0110_connect")!.inputSchema.required!.push("unknown_nonce");
    const unsupported=await run(unknown,"unknown-required.json");expect(unsupported.status).toBe(2);expect(unsupported.data.missing).toContain("chat0110_connect.unsupported_required");
    expect(existsSync(join(root,"unused-auth.json"))).toBe(false);
  }finally{await client.close();rmSync(root,{recursive:true,force:true});}
},15000);

test("setup с несовместимым сервером не меняет конфигурацию и не начинает OAuth",async()=>{
  const root=mkdtempSync(join(tmpdir(),"chat0110-setup-catalog-"));
  const paths:string[]=[],authorization:string[]=[];
  const api=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){paths.push(new URL(req.url).pathname);if(req.headers.has("authorization"))authorization.push(req.headers.get("authorization")!);return Response.json({jsonrpc:"2.0",id:1,result:{tools:[{name:"chat0110_pending",inputSchema:{type:"object",properties:{author:{type:"string"}}}}]}});}});
  try{
    const built=await Bun.build({entrypoints:[new URL("../src/mcp-cli.ts",import.meta.url).pathname],target:"node",format:"esm",outdir:root,naming:"mcp.mjs"});expect(built.success).toBe(true);
    const child=Bun.spawn(["node",join(root,"mcp.mjs"),"setup","--client","other"],{env:{...process.env,CHAT0110_HOME:root,CHAT0110_URL:`http://127.0.0.1:${api.port}`},stdout:"pipe",stderr:"pipe"});
    const [out,error,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(status).toBe(1);expect(out).toBe("");expect(error).toContain("несовместим");expect(paths).toEqual(["/mcp"]);expect(authorization).toEqual([]);
    expect(existsSync(join(root,".local/share/chat0110/mcp/mcp.mjs"))).toBe(false);
    expect(existsSync(join(root,".local/state/chat0110/mcp-oauth.json"))).toBe(false);
  }finally{api.stop(true);rmSync(root,{recursive:true,force:true});}
},15000);
