import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";

test("плагин ждёт настоящий channel ack; off/on управляет событиями без нового connect или моделей",async()=>{
 const root=mkdtempSync(join(tmpdir(),"chat0110-plugin-"));writeFileSync(join(root,"gh"),"#!/bin/sh\nprintf fixture-access\n");chmodSync(join(root,"gh"),0o755);
 let enabled=true,issued=0,reply=0,nextCalls=0,version="2.0.0";const notifications:any[]=[];
 const api=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
  expect(req.headers.get("authorization")).toBe("Bearer fixture-access");const path=new URL(req.url).pathname.split("/").at(-1),p=await req.json() as any;
  if(path==="register")return Response.json({id:"session-fixture",alias:"claude-fixture",auto_enabled:true,version});
  if(path==="auto-replies"){enabled=p.enabled;return Response.json({session:{id:"session-fixture",auto_enabled:enabled}});}
  if(path==="status")return Response.json({session:{id:"session-fixture",auto_enabled:enabled}});
  if(path==="next"){nextCalls++;if(enabled&&issued<2){issued++;return Response.json({task:{id:`task-${issued}`,claim:"private-fixture-claim"},prompt:"artificial task",final:true});}await Bun.sleep(50);return Response.json({task:null});}
  if(path==="complete"){reply++;return Response.json({item:{id:"reply"}});}
  if(path==="context")return Response.json({items:[]});if(path==="heartbeat")return Response.json({ok:true});return new Response("",{status:404});
 }});
 const transport=new StdioClientTransport({command:process.execPath,args:[process.env.CHAT0110_TEST_CONNECTOR??new URL("../src/connector.ts",import.meta.url).pathname],env:Object.fromEntries(Object.entries({...process.env,PATH:root+":"+process.env.PATH,CHAT0110_URL:`http://127.0.0.1:${api.port}`,CHAT0110_CHANNEL:"1",CHAT0110_AUTHOR:"claude",CHAT0110_STATE_DIR:join(root,"state")}).filter((x):x is [string,string]=>typeof x[1]==="string")),stderr:"ignore"});
 const client=new Client({name:"plugin-fixture",version:"1.0.0"});client.fallbackNotificationHandler=async n=>{if(n.method==="notifications/claude/channel")notifications.push(n.params);};
 const call=async(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args}) as Promise<{isError?:boolean;content:Array<{type:string;text:string}>}>;
 const wait=async(fn:()=>boolean)=>{const end=Date.now()+4000;while(!fn()&&Date.now()<end)await Bun.sleep(25);expect(fn()).toBe(true);};
 try{
  await client.connect(transport);
  const params={repo:"a/b",chat_id:"20261031-abcd",alias:"claude-fixture",name:"Claude",author:"claude"};
  expect((await call("chat0110_connect",params)).isError).toBe(true);expect(notifications).toHaveLength(0);expect(nextCalls).toBe(0);
  version="2.1.0";expect((await call("chat0110_connect",params)).isError).not.toBe(true);await wait(()=>notifications.length===1);
  expect(nextCalls).toBe(0);expect((await call("chat0110_next")).isError).toBe(true);expect((await call("chat0110_channel_ack",{nonce:"wrong"})).isError).toBe(true);expect(nextCalls).toBe(0);
  const nonce=notifications[0].content.match(/nonce ([a-f0-9-]+)/)[1];expect((await call("chat0110_channel_ack",{nonce})).isError).not.toBe(true);
  await wait(()=>notifications.some(n=>n.meta?.task_id==="task-1"));expect(JSON.stringify(notifications)).not.toContain("private-fixture-claim");
  await call("chat0110_reply",{task_id:"task-1",text:"finished",outcome:"complete"});expect(reply).toBe(1);await call("chat0110_set_auto_reply",{enabled:false});
  await Bun.sleep(1100);expect(issued).toBe(1);
  const status=JSON.parse((await call("chat0110_status")).content[0]!.text);expect(status.session.auto_enabled).toBe(false);expect(status.delivery.confirmed).toBe(true);
  await call("chat0110_set_auto_reply",{enabled:true});await wait(()=>notifications.some(n=>n.meta?.task_id==="task-2"));expect(issued).toBe(2);
 }finally{await client.close();api.stop(true);rmSync(root,{recursive:true,force:true});}
},15000);
