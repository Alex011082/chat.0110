import {test, expect} from "bun:test";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

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
