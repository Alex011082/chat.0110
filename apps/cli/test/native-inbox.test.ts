import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { NativeDelivery } from "../src/native-delivery.ts";

test("native outbox не повторяет принятую или неоднозначную доставку после restart", async () => {
  const db = new Database(":memory:");
  let sends = 0;
  let delivery = new NativeDelivery(db, async () => { sends++; return "sent_unconfirmed"; }, async () => {});
  expect((await delivery.send("task:1:gen:1", "target", "очищенный запрос")).state).toBe("sent_unconfirmed");
  delivery = new NativeDelivery(db, async () => { sends++; return "sent_unconfirmed"; }, async () => {});
  await delivery.send("task:1:gen:1", "target", "очищенный запрос");
  expect(sends).toBe(1);
  expect(() => delivery.send("task:1:gen:1", "another-target", "очищенный запрос")).toThrow();
  db.exec("UPDATE native_delivery SET state='sending'");
  expect((await delivery.send("task:1:gen:1", "target", "очищенный запрос")).state).toBe("uncertain");
  expect(sends).toBe(1);
  db.close();
});

test("не более трёх известных отказов до отправки; повтор не обнуляет счётчик", async () => {
  const db = new Database(":memory:");
  let sends = 0;
  const delivery = new NativeDelivery(db, async () => { sends++; return "not_sent"; }, async () => {});
  expect(await delivery.send("task:2", "target", "запрос")).toMatchObject({state:"failed",attempts:3});
  await delivery.send("task:2", "target", "запрос");
  expect(sends).toBe(3);
  expect(JSON.stringify(db.query("SELECT * FROM native_delivery").all())).not.toContain("запрос");
  db.close();
});

test("cancel во время отправки не оживляет outbox и не допускает повтор", async () => {
  const db = new Database(":memory:");
  let finish!: (value: "sent_unconfirmed") => void;
  let sends=0;
  const delivery = new NativeDelivery(db, () => {sends++;return new Promise(resolve => {finish=resolve;});});
  const pending=delivery.send("cancel", "target", "запрос");
  delivery.cancel("cancel");
  finish("sent_unconfirmed");
  expect((await pending).state).toBe("cancelled");
  await delivery.send("cancel", "target", "запрос");
  expect(sends).toBe(1);
  db.close();
});

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { sendClaudeInbox } from "../src/claude-inbox.ts";

test("отдельные transport-процессы с одной SQLite не отправляют один identity дважды", async () => {
  const dir=mkdtempSync(join(tmpdir(),"native-cas-"));
  try {
    const mod=new URL("../src/native-delivery.ts",import.meta.url).pathname;
    const fixture=join(dir,"worker.ts");
    writeFileSync(fixture,`import {Database} from 'bun:sqlite';import {NativeDelivery} from ${JSON.stringify(mod)};import {appendFileSync,writeFileSync,existsSync} from 'node:fs';const root=process.argv[2];const n=process.argv[3];const db=new Database(root+'/q.sqlite');const q=new NativeDelivery(db,async()=>{appendFileSync(root+'/sent','1');await Bun.sleep(30);return 'sent_unconfirmed';});writeFileSync(root+'/ready'+n,'');while(!existsSync(root+'/go'))await Bun.sleep(5);await q.send('one','target','text');db.close();`);
    const workers=Array.from({length:4},(_,n)=>Bun.spawn([process.execPath,fixture,dir,String(n)],{stdout:"ignore",stderr:"pipe"}));
    const until=Date.now()+8000;
    while(![0,1,2,3].every(n=>existsSync(join(dir,`ready${n}`))) && Date.now()<until) await Bun.sleep(5);
    expect([0,1,2,3].every(n=>existsSync(join(dir,`ready${n}`)))).toBe(true);
    writeFileSync(join(dir,"go"),"");
    expect(await Promise.all(workers.map(w=>w.exited))).toEqual([0,0,0,0]);
    expect(readFileSync(join(dir,"sent"),"utf8")).toBe("1");
  } finally {rmSync(dir,{recursive:true,force:true});}
},15000);

test("адаптер пишет inbox-фрейм только в привязанный Desktop и не принимает подмену identity", async () => {
  const dir=mkdtempSync(join(tmpdir(),"native-socket-"));
  const socket=join(dir,"inbox.sock"),meta=join(dir,"session.json");
  let body="";
  const server=createServer(c=>{c.on("data",chunk=>{body+=chunk.toString();});});
  try {
    await new Promise<void>(resolve=>server.listen(socket,resolve));chmodSync(socket,0o600);
    writeFileSync(meta,JSON.stringify({sessionId:"fixture",hostSessionId:"host-fixture",entrypoint:"claude-desktop",version:"2.1.309",peerProtocol:1,messagingSocketPath:socket}));
    const target={metadata:meta,sessionId:"fixture",hostSessionId:"host-fixture"};
    expect(await sendClaudeInbox(target,"очищенное сообщение","task-1")).toBe("sent_unconfirmed");
    for(let i=0;i<20&&!body;i++)await Bun.sleep(2);
    expect(JSON.parse(body)).toEqual({type:"user",message:{role:"user",content:"CHAT0110 delivery task-1\nочищенное сообщение"}});
    expect(()=>sendClaudeInbox({...target,sessionId:"other"},"текст","task-2")).toThrow();
  } finally {server.close();rmSync(dir,{recursive:true,force:true});}
});

import { recoverNativeAnswer } from "../src/native-publication.ts";
import { DispatchStore } from "../../api/src/dispatch.ts";
test("потерянный ответ complete и restart повторяют сохранённый результат, а не модель или следующий ход", async () => {
  const dir=mkdtempSync(join(tmpdir(),"native-recovery-"));
  const q=new DispatchStore(":memory:");
  try {
    const a=q.register(7,"a/b","20261026-abcd","a","claude","Claude");
    const b=q.register(7,"a/b","20261026-abcd","b","codex","Codex");
    q.enqueue("r",7,"a/b","20261026-abcd","m","q",[a.id,b.id,a.id]);
    const t=q.claim(a.id)!;const job={session_id:a.id,task:{id:t.id,claim:t.claim!}};
    writeFileSync(join(dir,`${t.id}.answer.json`),JSON.stringify({text:"итог",outcome:"continue"}));
    const files=new Map<string,string>();let calls=0;
    const complete=async(p:Record<string,unknown>)=>{
      calls++;q.prepareAnswer(t.id,a.id,String(p.claim),String(p.text),String(p.outcome));
      if(files.has(t.answer_id))expect(files.get(t.answer_id)).toBe(String(p.text));else files.set(t.answer_id,String(p.text));
      q.finish(t.id,String(p.claim),t.answer_id);
      if(calls===1)throw new Error("response lost after server commit");
    };
    await expect(recoverNativeAnswer(dir,job,complete)).rejects.toThrow();
    expect(await recoverNativeAnswer(dir,job,complete)).toBe(true);
    expect(await recoverNativeAnswer(dir,job,complete)).toBe(true);
    expect(calls).toBe(2);expect(files.size).toBe(1);
    expect(q.claim(b.id)?.step).toBe(1);expect(q.claim(b.id)).toBeNull();
  } finally {q.close();rmSync(dir,{recursive:true,force:true});}
});

test("runner связывает HTTP-очередь с inbox и восстанавливает потерянный complete без второго prompt", async () => {
  const dir=mkdtempSync(join(tmpdir(),"native-runner-"));
  const state=join(dir,"state"),socket=join(dir,"peer.sock"),meta=join(dir,"peer.json"),binding=join(dir,"binding.json");
  const cli=new URL("../src/native-desktop.ts",import.meta.url).pathname;
  const id="fixture-task-1";
  writeFileSync(join(dir,"gh"),"#!/bin/sh\nprintf 'fixture-access'\n");chmodSync(join(dir,"gh"),0o755);
  const env={...process.env,PATH:dir+":"+process.env.PATH};
  let registered=0,issued=false,completes=0,prompts=0,contexts=0;
  const git=new Map<string,string>();let peerError:unknown;
  const runHelper=async(a:string[])=>{
    const p=Bun.spawn([process.execPath,cli,...a],{env,stdout:"ignore",stderr:"ignore"});return p.exited;
  };
  const api=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
    if(req.headers.get("authorization")!=="Bearer fixture-access")return new Response("",{status:401});
    const method=new URL(req.url).pathname.split("/").at(-1);const p=await req.json() as any;
    if(method==="register"){registered++;return Response.json({id:"registered-fixture"});}
    if(method==="next"){
      if(!issued){issued=true;return Response.json({task:{id,claim:"fixture-claim"},prompt:"fixture question",repo:"Alex011082/Y-TNG",chat_id:"20261030-pp11",final:true,expires_at:Date.now()+900_000});}
      await Bun.sleep(100);return Response.json({task:null});
    }
    if(method==="context"){contexts++;return Response.json({items:[]});}
    if(method==="heartbeat")return Response.json({ok:true});
    if(method==="complete"){
      completes++;
      if(git.has(id))expect(git.get(id)).toBe(p.text);else git.set(id,p.text);
      return completes===1?new Response("response lost after commit",{status:500}):Response.json({item:{id:"answer-fixture"}});
    }
    return new Response("",{status:404});
  }});
  const peer=createServer(c=>{
    let text="";
    c.on("data",chunk=>{
      text+=chunk.toString();if(!text.includes("\n"))return;
      const frame=JSON.parse(text);text="";
      void (async()=>{
        if(frame.message.content.startsWith("CHAT0110 delivery probe:")){
          const nonce=JSON.parse(readFileSync(join(state,"probe.json"),"utf8")).nonce;
          expect(await runHelper(["ack","--state",state,"--probe",nonce])).toBe(0);
        }else{
          prompts++;
          expect(await runHelper(["context","--state",state,"--task",id])).toBe(0);
          const answer=join(dir,"answer.txt");writeFileSync(answer,"fixture final answer");
          expect(await runHelper(["reply","--state",state,"--task",id,"--answer",answer,"--outcome","complete"])).toBe(0);
        }
      })().catch(e=>{peerError=e;});
    });
  });
  let runner:ReturnType<typeof Bun.spawn>|undefined;
  try{
    await new Promise<void>(resolve=>peer.listen(socket,resolve));chmodSync(socket,0o600);
    writeFileSync(meta,JSON.stringify({sessionId:"fixture",hostSessionId:"fixture-host",entrypoint:"claude-desktop",version:"2.1.309",peerProtocol:1,messagingSocketPath:socket}));
    writeFileSync(binding,JSON.stringify({target:{metadata:meta,sessionId:"fixture",hostSessionId:"fixture-host"},repo:"Alex011082/Y-TNG",chat_id:"20261030-pp11",alias:"fixture-claude",name:"Fixture",url:`http://127.0.0.1:${api.port}`}));
    runner=Bun.spawn([process.execPath,cli,"listen","--state",state,"--binding",binding],{env,stdout:"ignore",stderr:"ignore"});
    const until=Date.now()+10_000;
    while(!existsSync(join(state,`${id}.done.json`)) && !peerError && Date.now()<until)await Bun.sleep(20);
    expect(peerError).toBeUndefined();expect(existsSync(join(state,`${id}.done.json`))).toBe(true);
    expect(registered).toBe(1);expect(contexts).toBe(1);expect(prompts).toBe(1);expect(completes).toBe(2);expect(git.size).toBe(1);
  }finally{runner?.kill();if(runner)await runner.exited;api.stop(true);peer.close();rmSync(dir,{recursive:true,force:true});}
},15000);
