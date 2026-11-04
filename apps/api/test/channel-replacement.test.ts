import {expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {createApp} from "../src/http.ts";
import {DispatchStore} from "../src/dispatch.ts";
import {loadConfig} from "../src/config.ts";
import {SessionStore,importCookieKey} from "../src/session.ts";
import {FakeGitHub} from "./fake-github.ts";
import {testPrivacy} from "./privacy-fixture.ts";

const base="https://chat.0110.digital",repo="Alex011082/chat.0110",chat="20261023-k7q2";
const code="a1".repeat(32),key="b2".repeat(32),external="11111111-2222-4333-8444-555555555555";
async function fixture(){
 const db=new Database(":memory:"),dispatch=new DispatchStore(db);
 const config=loadConfig({CHAT0110_PUBLIC_URL:base,GITHUB_APP_CLIENT_ID:"client",GITHUB_APP_CLIENT_SECRET:"fixture",GITHUB_APP_SLUG:"chat",GITHUB_WEBHOOK_SECRET:"hook",CHAT0110_COOKIE_KEY:"07".repeat(32)});
 const fake=new FakeGitHub().on("GET","/user",({headers})=>({body:{id:headers.get("authorization")==="Bearer ghu_other"?8:7,login:headers.get("authorization")==="Bearer ghu_other"?"Other":"Alex011082"}}))
 .on("GET",/\/repos\/alex011082\/chat\.0110$/i,{body:{full_name:repo,name:"chat.0110",owner:{login:"Alex011082"},default_branch:"main",permissions:{push:true}}});
 const pull=(author="Alex011082",state="open")=>fake.on("GET",/\/pulls\?state=all&head=/,{body:[{number:1,title:"Chat",body:`<!-- chat0110\nchat_id: ${chat}\n-->`,state,draft:true,head:{ref:`chat/${chat}`,sha:"h",repo:{full_name:repo}},base:{ref:"main"},user:{login:author}}]});pull();
 const sessions=new SessionStore({key:await importCookieKey(config.cookieKey),dev:false,clientId:"client",clientSecret:"fixture",fetch:fake.fetch});
 const cookie=(await sessions.cookieFor({uid:7,login:"Alex011082",at:"ghu_fixture",rt:"",exp:Date.now()+3600000,rexp:Date.now()+86400000})).split(";")[0]!;
 const app=await createApp({config,stateDb:db,dispatch,sessions,privacy:testPrivacy,fetch:fake.fetch});
 const post=(path:string,body:unknown,owner=false,token="ghu_fixture")=>app(new Request(base+path,{method:"POST",headers:{"content-type":"application/json",origin:base,...(owner?{cookie}:{authorization:`Bearer ${token}`})},body:JSON.stringify(body)}));
 const old=dispatch.register(7,repo,chat,"remote:chatgpt:7:codex","codex","Мой Кодекс","codex","sol");
 const issue=(c=code,id=old.id)=>post(`/api/chats/${repo}/${chat}/channel-replacement`,{session_id:id,code:c},true);
 const connect=(extra:Record<string,unknown>={})=>post("/api/agent/register",{repo,chat_id:chat,alias:"codex",author:"codex",name:"Untrusted new name",session_id:external,channel_key:key,replacement_code:code,...extra});
 return {db,dispatch,post,old,issue,connect,pull};
}

test("владелец явно заменяет канал, сохраняя id, имя, owner off и очередь; повтор не создаёт дубль",async()=>{
 const f=await fixture();try{
  f.dispatch.setAutoEnabled(7,f.old.id,false);
  expect((await f.connect()).status).toBe(409);
  expect((await f.issue()).status).toBe(201);
  const response=await f.connect();expect(response.status).toBe(200);
  const body=await response.json();expect(body).toMatchObject({id:f.old.id,alias:"codex",name:"Мой Кодекс",auto_enabled:0});
  expect(JSON.stringify(body)).not.toContain(key);
  expect((await f.connect()).status).toBe(200);
  expect(f.dispatch.list(7,repo,chat).sessions).toHaveLength(1);
  expect((await f.post("/api/agent/status",{session_id:f.old.id})).status).toBe(403);
  expect((await f.post("/api/agent/status",{session_id:f.old.id,channel_key:key})).status).toBe(200);
  f.dispatch.setAutoEnabled(7,f.old.id,true);
  f.dispatch.enqueue("preserved",7,repo,chat,"m","question",[f.old.id]);
  const got=await f.post("/api/agent/next",{session_id:f.old.id,channel_key:key});
  expect((await got.json()).task.session_id).toBe(f.old.id);
 }finally{f.db.close();}
});

test("код привязан к владельцу и чату, однократен для конкретного ключа; неизвестный не захватывает alias",async()=>{
 const f=await fixture();try{
  expect((await f.issue()).status).toBe(201);
  for(const extra of [{replacement_code:"c3".repeat(32)},{channel_key:"bad"},{chat_id:"20261023-zzzz"},{alias:"other"},{author:"claude"}])expect((await f.connect(extra)).status).not.toBe(200);
  const foreign=await f.post("/api/agent/register",{repo,chat_id:chat,session_id:external,alias:"codex",name:"Codex",author:"codex",channel_key:key,replacement_code:code},false,"ghu_other");
  expect(foreign.status).not.toBe(200);
  expect((await f.connect()).status).toBe(200);
  expect((await f.connect({channel_key:"d4".repeat(32)})).status).toBe(409);
  expect((await f.post("/api/agent/auto-replies",{session_id:f.old.id,enabled:false,channel_key:"d4".repeat(32)})).status).toBe(403);
  expect(f.dispatch.session(f.old.id,7).auto_enabled).toBe(1);
 }finally{f.db.close();}
});

test("push без владения чатом, закрытый чат и чужая сессия не разрешают замену",async()=>{
 const f=await fixture();try{
  f.pull("Other");expect((await f.issue()).status).toBe(403);
  f.pull("Alex011082","closed");expect((await f.issue()).status).toBe(403);
  f.pull();const foreign=f.dispatch.register(8,repo,chat,"x","other","Other","codex");expect((await f.issue(code,foreign.id)).status).toBe(404);
 }finally{f.db.close();}
});

test("ожидающая очередь и маршрут остаются у прежнего id; истёкший код ничего не меняет",async()=>{
 const f=await fixture();try{
  f.dispatch.enqueue("queued",7,repo,chat,"m","question",[f.old.id]);
  expect((await f.issue()).status).toBe(201);
  f.db.exec("UPDATE channel_replacements SET expires=1");
  expect((await f.connect()).status).toBe(409);
  const nextCode="f6".repeat(32);expect((await f.issue(nextCode)).status).toBe(201);
  expect((await f.connect({replacement_code:nextCode})).status).toBe(200);
  expect(f.dispatch.chain("queued",7)?.status).toBe("waiting");
  const got=await f.post("/api/agent/next",{session_id:f.old.id,channel_key:key});
  const task=(await got.json()).task;expect(task).toMatchObject({chain_id:"queued",session_id:f.old.id,step:0});
  expect(f.dispatch.list(7,repo,chat).chains[0]?.route).toEqual([f.old.id]);
 }finally{f.db.close();}
});

test("старый long poll теряет доступ и не стирает готовность нового приёмника",async()=>{
 const f=await fixture();try{
  const old=f.post("/api/agent/next",{session_id:f.old.id,wait:true});
  const until=Date.now()+2000;while(!f.dispatch.list(7,repo,chat).sessions[0]?.delivery_ready&&Date.now()<until)await Bun.sleep(5);
  expect(f.dispatch.list(7,repo,chat).sessions[0]?.delivery_ready).toBe(true);
  expect((await f.issue()).status).toBe(201);expect((await f.connect()).status).toBe(200);
  const next=f.post("/api/agent/next",{session_id:f.old.id,channel_key:key,wait:true});
  expect((await old).status).toBe(403);
  expect(f.dispatch.list(7,repo,chat).sessions[0]?.delivery_ready).toBe(true);
  // Повтор потерянного register не должен сбрасывать уже работающий приёмник.
  expect((await f.connect()).status).toBe(200);
  expect(f.dispatch.list(7,repo,chat).sessions[0]?.delivery_ready).toBe(true);
  f.dispatch.enqueue("new-only",7,repo,chat,"m","question",[f.old.id]);
  expect((await (await next).json()).task.chain_id).toBe("new-only");
 }finally{f.db.close();}
});

for(const cancelled of [false,true])test(`взятый${cancelled?" и остановленный":""} ход блокирует замену без повторной выдачи`,async()=>{
 const f=await fixture();try{
  f.dispatch.enqueue("busy",7,repo,chat,"m","question",[f.old.id]);const t=f.dispatch.claim(f.old.id)!;
  if(cancelled)f.dispatch.cancel(7,"busy");
  expect((await f.issue()).status).toBe(201);
  expect((await f.connect()).status).toBe(409);
  expect(f.dispatch.session(f.old.id,7).external).toBe("remote:chatgpt:7:codex");
  expect(f.dispatch.task(t.id,f.old.id,t.claim!,true).claim).toBe(t.claim);
  expect(f.dispatch.claim(f.old.id)).toBeNull();
 }finally{f.db.close();}
});
