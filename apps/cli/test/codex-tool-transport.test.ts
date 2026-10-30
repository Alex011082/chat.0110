import {test,expect} from "bun:test";
import {PassThrough} from "node:stream";
import {CodexToolTransport} from "../src/codex-tool-transport.ts";
import {mkdtempSync,writeFileSync,chmodSync,existsSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const thread="00000000-0000-7000-8000-000000000001";
test("host transport ждёт точную квитанцию и не отправляет claim",async()=>{
 const input=new PassThrough();let emitted:any;
 const transport=new CodexToolTransport(thread,input,line=>{emitted=JSON.parse(line);},1000);
 const pending=transport.send("инструкция без claim","task:one");
 expect(emitted).toEqual({type:"chat0110.codex.deliver",id:"task:one",thread_id:thread,text:"инструкция без claim"});
 input.write(JSON.stringify({type:"chat0110.codex.receipt",id:"other",status:"sent_unconfirmed"})+"\n");
 input.write(JSON.stringify({type:"chat0110.codex.receipt",id:"task:one",status:"sent_unconfirmed"})+"\n");
 expect(await pending).toBe("sent_unconfirmed");transport.close();input.destroy();
});
test("потеря host после выдачи конверта не считается отказом до отправки",async()=>{
 const input=new PassThrough();const transport=new CodexToolTransport(thread,input,()=>{},10);
 expect(await transport.send("text","timeout")).toBe("uncertain");
 const pending=transport.send("text","close");transport.close();expect(await pending).toBe("uncertain");
 expect(await transport.send("text","after-close")).toBe("not_sent");input.destroy();
});
test("host transport запрещает подмену target и второй одновременный запрос",async()=>{
 const input=new PassThrough();expect(()=>new CodexToolTransport("not-a-thread",input,()=>{})).toThrow();
 const transport=new CodexToolTransport(thread,input,()=>{},1000);const p=transport.send("text","one");
 await expect(transport.send("different","two")).rejects.toThrow();transport.close();await p;input.destroy();
});

test("Codex runner регистрируется после native ack и возвращает ровно один ответ через complete",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"codex-host-runner-")),state=join(dir,"state"),binding=join(dir,"binding.json");
 const cli=new URL("../src/native-desktop.ts",import.meta.url).pathname,id="codex-fixture-task";
 writeFileSync(join(dir,"gh"),"#!/bin/sh\nprintf 'fixture-access'\n");chmodSync(join(dir,"gh"),0o755);
 const env={...process.env,PATH:dir+":"+process.env.PATH};let registered=0,issued=false,completed=0,prompts=0;let driverError:unknown;
 const helper=async(args:string[])=>{
  const p=Bun.spawn([process.execPath,cli,...args],{env:{...env,PATH:"/nonexistent"},stdout:"pipe",stderr:"ignore"});
  const output=await new Response(p.stdout).text();expect(await p.exited).toBe(0);
  if(args[0]==="context"){expect(output).not.toContain("fixture-claim");expect(output).not.toContain("session_id");expect(JSON.parse(output).timeline).toEqual({items:[]});}
 };
 const api=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
  const p=await req.json() as any,method=new URL(req.url).pathname.split("/").at(-1);
  if(method==="register"){expect(existsSync(join(state,"probe-ack.json"))).toBe(true);expect(p.author).toBe("codex");registered++;return Response.json({id:"codex-fixture-session"});}
  if(method==="next"){if(!issued){issued=true;return Response.json({task:{id,claim:"fixture-claim"},prompt:"question",repo:"Alex011082/Y-TNG",chat_id:"20261030-pp11",final:true,expires_at:Date.now()+900_000});}await Bun.sleep(50);return Response.json({task:null});}
  if(method==="context")return Response.json({items:[]});if(method==="heartbeat")return Response.json({ok:true});
  if(method==="complete"){completed++;expect(p.text).toBe("answer");expect(p.outcome).toBe("complete");return Response.json({item:{id:"answer"}});}
  return new Response("",{status:404});
 }});
 writeFileSync(binding,JSON.stringify({transport:"codex-app-tools",target:{threadId:thread},repo:"Alex011082/Y-TNG",chat_id:"20261030-pp11",alias:"codex-desktop-native",name:"Codex Desktop",url:`http://127.0.0.1:${api.port}`}));
 const runner=Bun.spawn([process.execPath,cli,"listen","--state",state,"--binding",binding],{env,stdin:"pipe",stdout:"pipe",stderr:"ignore"});
 const drive=(async()=>{
  let buffer="";const reader=runner.stdout.getReader();while(true){const {value:bytes,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(bytes);let at:number;while((at=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.startsWith("{"))continue;const e=JSON.parse(line);if(e.type!=="chat0110.codex.deliver")continue;expect(e.thread_id).toBe(thread);expect(e.text).not.toContain("fixture-claim");
   runner.stdin.write(JSON.stringify({type:"chat0110.codex.receipt",id:e.id,status:"sent_unconfirmed"})+"\n");
   if(e.id.startsWith("probe:")){const probe=JSON.parse(readFileSync(join(state,"probe.json"),"utf8"));await helper(["ack","--state",state,"--probe",probe.nonce]);}
   else{prompts++;await helper(["context","--state",state,"--task",id]);const answer=join(dir,"answer.txt");writeFileSync(answer,"answer");await helper(["reply","--state",state,"--task",id,"--answer",answer,"--outcome","complete"]);}
  }}
 })().catch(e=>{driverError=e;});
 try{const until=Date.now()+8000;while(!existsSync(join(state,`${id}.done.json`))&&!driverError&&Date.now()<until)await Bun.sleep(20);
  expect(driverError).toBeUndefined();expect(existsSync(join(state,`${id}.done.json`))).toBe(true);expect(registered).toBe(1);expect(prompts).toBe(1);expect(completed).toBe(1);
 }finally{runner.kill();await runner.exited;await drive;api.stop(true);rmSync(dir,{recursive:true,force:true});}
},12000);
