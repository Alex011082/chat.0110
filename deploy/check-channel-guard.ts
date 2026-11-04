import assert from "node:assert/strict";
import {Database} from "bun:sqlite";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {createHash,randomBytes} from "node:crypto";

const hash=(x:string|Uint8Array)=>createHash("sha256").update(x).digest("hex");
const random=()=>randomBytes(32).toString("hex");
const snapshot=(db:Database)=>JSON.stringify({
 sessions:db.query("SELECT id,uid,repo,chat,alias,name,author,model,auto_enabled FROM sessions ORDER BY id").all(),
 chains:db.query("SELECT * FROM chains ORDER BY id").all(),tasks:db.query("SELECT * FROM tasks ORDER BY id").all(),
 pulls:db.query("SELECT * FROM agent_pulls ORDER BY session_id,request_id").all(),
});

async function nodeMcp(file:string,auth:string,home:string,origin:string){
 const child=Bun.spawn(["node",file,"serve","--auth-file",auth,"--author","codex"],{env:{PATH:process.env.PATH!,CHAT0110_HOME:home,CHAT0110_URL:origin},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
 const pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void}>();let id=0;
 void new Response(child.stderr).text();
 void (async()=>{let buffer="";const decoder=new TextDecoder(),reader=child.stdout.getReader();try{for(;;){const {value:bytes,done}=await reader.read();if(done)break;buffer+=decoder.decode(bytes,{stream:true});let end;while((end=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const value=JSON.parse(line);if(value.id&&pending.has(value.id)){const p=pending.get(value.id)!;pending.delete(value.id);value.error?p.reject(Error("MCP JSON-RPC отказ")):p.resolve(value.result);}}}}finally{reader.releaseLock();}})().catch(()=>{for(const p of pending.values())p.reject(Error("MCP transport closed"));});
 const rpc=async(method:string,params:any={})=>{
  const seq=++id;let timer:ReturnType<typeof setTimeout>;
  const result=new Promise<any>((resolve,reject)=>{pending.set(seq,{resolve,reject});timer=setTimeout(()=>{pending.delete(seq);reject(Error(`MCP timeout: ${method}`));},12000);});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:seq,method,params})+"\n");
  try{return await result;}finally{clearTimeout(timer!);}
 };
 try{await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"chat0110-rollback-ci",version:"1"}});child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");}
 catch(e){child.kill();await child.exited;throw e;}
 return {rpc,close:async()=>{child.kill();await child.exited;}};
}

/** Проверяется только синтетическая копия. Конфигурация и БД работающего сервиса не читаются. */
export async function checkChannelGuard(root:string){
 root=resolve(root);
 const load=(name:string)=>import(pathToFileURL(join(root,"apps/api/src",name+".ts")).href);
 const [{DispatchStore},{createApp},{loadConfig},{SessionStore,importCookieKey},{Privacy}]=await Promise.all([load("dispatch"),load("http"),load("config"),load("session"),load("privacy")]);
 assert.equal(typeof DispatchStore.prototype.replaceChannel,"function","API не поддерживает замену канала");
 assert.equal(typeof DispatchStore.prototype.beginPublication,"function","API не ограждает неопределённую публикацию");
 const dir=mkdtempSync(join(tmpdir(),"chat-guard-probe-")),repo="artifact-owner/project",chat="20261104-abcd",oldKey="77".repeat(32);
 let db:Database|undefined,q:any,app:any,node:Awaited<ReturnType<typeof nodeMcp>>|undefined,dropReply=false;
 const files=new Map<string,string>();let writes=0;
 const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){const response=await app(req);if(dropReply&&new URL(req.url).pathname==="/api/agent/complete"&&response.ok){dropReply=false;return Response.json({error:"synthetic lost acknowledgement"},{status:503});}return response;}});
 const origin=`http://127.0.0.1:${server.port}`,prefix=`/repos/${repo}`;
 const pull={number:1,title:"Synthetic",body:`<!-- chat0110\nchat_id: ${chat}\n-->`,state:"open",draft:true,created_at:"2026-11-04T00:00:00Z",updated_at:"2026-11-04T00:00:00Z",html_url:"https://github.com/artifact-owner/project/pull/1",user:{login:"artifact-owner"},head:{ref:`chat/${chat}`,sha:"head",repo:{full_name:repo}},base:{ref:"main"}};
 const fake=async(input:any,init?:RequestInit)=>{
  const url=new URL(String(input)),path=url.pathname,method=init?.method??"GET";
  if(path==="/user")return Response.json({id:7,login:"artifact-owner"});
  if(path===prefix)return Response.json({full_name:repo,name:"project",owner:{login:"artifact-owner"},default_branch:"main",permissions:{push:true}});
  if(path===prefix+"/pulls")return Response.json(url.searchParams.has("head")?[pull]:[]);
  if(path.includes("/contents/")){
   if(method==="PUT"){const body=JSON.parse(String(init!.body));files.set(path,Buffer.from(body.content,"base64").toString());writes++;return Response.json({commit:{sha:`synthetic-${writes}`,html_url:"https://github.com/artifact-owner/project/commit/synthetic"}},{status:201});}
   if(files.has(path))return Response.json({content:Buffer.from(files.get(path)!).toString("base64"),encoding:"base64"});
   if(path.endsWith("/messages"))return Response.json([]);
   return Response.json({message:"Not Found"},{status:404});
  }
  if(path.includes("/compare/"))return Response.json({message:"Not Found"},{status:404});
  if(/\/(comments|reviews)$/.test(path))return Response.json([]);
  throw Error("Неожиданный запрос fixture GitHub");
 };
 try{
  // serialize включает committed WAL: рабочую копию не строим копированием только основного sqlite-файла.
  const source=new Database(join(dir,"source.sqlite")),seed=new DispatchStore(source);
  const a=seed.register(7,repo,chat,"remote:chatgpt:7:codex","codex","Codex","codex","fixture");
  const peer=seed.register(7,repo,chat,"peer","claude","Claude","claude","fixture");
  seed.enqueue("history",7,repo,chat,"20261104T000000Z-artifact-owner-abcd","previous",[a.id]);
  const done=seed.claim(a.id);seed.prepareAnswer(done.id,a.id,done.claim,"Previous");seed.finish(done.id,done.claim,done.answer_id);
  seed.enqueue("queue",7,repo,chat,"20261104T000001Z-artifact-owner-abcd","synthetic request",[a.id,peer.id,a.id]);
  const initialCode=random();seed.issueChannelReplacement(7,a.id,initialCode);seed.replaceChannel(7,repo,chat,"codex","codex","11111111-2222-4333-8444-555555555555",oldKey,initialCode);
  const sourceBytes=source.serialize(),before=snapshot(source);seed.close();
  const working=join(dir,"working.sqlite");writeFileSync(working,sourceBytes);db=new Database(working);q=new DispatchStore(db);
  assert.equal(snapshot(db),before,"Копия очереди изменилась при открытии bundle API");
  const config=loadConfig({CHAT0110_PUBLIC_URL:origin,GITHUB_APP_CLIENT_ID:"fixture",GITHUB_APP_CLIENT_SECRET:"fixture",GITHUB_APP_SLUG:"fixture",GITHUB_WEBHOOK_SECRET:"fixture",CHAT0110_COOKIE_KEY:"07".repeat(32),CHAT0110_WEB_DIST:join(root,"apps/web/dist")});
  const sessions=new SessionStore({key:await importCookieKey(config.cookieKey),dev:true,clientId:"fixture",clientSecret:"fixture",fetch:fake});
  const cookie=(await sessions.cookieFor({uid:7,login:"artifact-owner",at:"ghu_fixture",rt:"",exp:Date.now()+86400000,rexp:Date.now()+86400000})).split(";")[0];
  app=await createApp({config,stateDb:db,dispatch:q,sessions,privacy:new Privacy(async()=>[]),fetch:fake});
  const call=(path:string,body:any,owner=false)=>app(new Request(origin+path,{method:"POST",headers:{origin,"content-type":"application/json",...(owner?{cookie}:{authorization:"Bearer ghu_fixture"})},body:JSON.stringify(body)}));
  assert.equal((await call("/api/agent/status",{session_id:a.id,channel_key:oldKey})).status,200);
  const permit=random();assert.equal((await call(`/api/chats/${repo}/${chat}/channel-replacement`,{session_id:a.id,code:permit},true)).status,201);
  // Настоящий OAuth flow fixture; ни cookie, ни токены из пользовательского аккаунта не используются.
  const registered=await app(new Request(origin+"/oauth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({redirect_uris:["https://chatgpt.com/connector_platform_oauth_redirect"],token_endpoint_auth_method:"none"})}));
  const client=(await registered.json()).client_id,verifier="v".repeat(43),params=new URLSearchParams({client_id:client,redirect_uri:"https://chatgpt.com/connector_platform_oauth_redirect",response_type:"code",scope:"chat:agent",resource:origin+"/mcp",code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",state:"fixture"});
  const consent=await app(new Request(origin+"/oauth/authorize?"+params,{headers:{cookie}})),html=await consent.text();
  params.set("consent_nonce",html.match(/name="consent_nonce" value="([^"]+)"/)![1]!);params.set("decision","allow");
  const allowed=await app(new Request(origin+"/oauth/authorize",{method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded",cookie:cookie+"; "+consent.headers.getSetCookie()[0]!.split(";")[0]},body:params}));
  const oauthCode=new URL(allowed.headers.get("location")!).searchParams.get("code")!;
  const tokenResult=await app(new Request(origin+"/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:client,redirect_uri:"https://chatgpt.com/connector_platform_oauth_redirect",resource:origin+"/mcp",code:oauthCode,code_verifier:verifier})}));
  const tokens=await tokenResult.json();assert.equal(tokenResult.status,200);
  const auth=join(dir,"oauth.json");writeFileSync(auth,JSON.stringify({origin,client,access:tokens.access_token,refresh:tokens.refresh_token,expires:Date.now()+tokens.expires_in*1000}),{mode:0o600});
  const manifest=JSON.parse(readFileSync(join(root,"apps/web/dist/downloads/mcp.json"),"utf8")),archive=join(root,"apps/web/dist",manifest.url.replace(/^\//,""));
  assert.equal(hash(readFileSync(archive)),manifest.sha256,"MCP archive не совпал с manifest");
  const mcp=join(dir,"mcp");mkdirSync(mcp);const extracted=Bun.spawnSync(["tar","-xzf",archive,"-C",mcp]);assert.equal(extracted.exitCode,0);
  node=await nodeMcp(join(mcp,"package/mcp.mjs"),auth,join(dir,"home"),origin);
  const tools=await node.rpc("tools/list"),connectTool=tools.tools.find((t:any)=>t.name==="chat0110_connect");
  assert.ok(connectTool.inputSchema.properties.replacement_code&&connectTool.inputSchema.properties.channel_id,"MCP несовместим с перенесённым каналом");
  const invoke=async(name:string,args:any={})=>{const r=await node!.rpc("tools/call",{name,arguments:args});assert.notEqual(r.isError,true,"MCP fixture отказал");return JSON.parse(r.content[0].text);};
  const receipt=await invoke("chat0110_connect",{repo,chat_id:chat,alias:"codex",author:"codex",name:"Codex",replacement_code:permit});
  assert.equal(receipt.session_id,a.id);assert.match(receipt.channel_id,/^[a-f0-9]{64}$/);assert.equal(snapshot(db),before,"Перенос изменил очередь/историю");
  assert.equal((await call("/api/agent/status",{session_id:a.id,channel_key:oldKey})).status,403);
  assert.equal((await call("/api/agent/next",{session_id:a.id,channel_key:oldKey})).status,403);
  const oldApps=await app(new Request(origin+"/mcp",{method:"POST",headers:{authorization:`Bearer ${tokens.access_token}`,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"chat0110_status",arguments:{session_id:a.id}}})}));assert.equal((await oldApps.json()).result.isError,true);
  await invoke("chat0110_status");
  const one=await invoke("chat0110_next");assert.equal(one.task.session_id,a.id);const firstAnswer=one.task.answer_id;
  dropReply=true;const lost=await node.rpc("tools/call",{name:"chat0110_reply",arguments:{task_id:one.task.id,text:"Synthetic first"}});assert.equal(lost.isError,true);
  await invoke("chat0110_reply",{task_id:one.task.id,text:"Synthetic first"});assert.equal(writes,1,"Повтор создал второй GitHub commit");
  const twoResponse=await call("/api/agent/next",{session_id:peer.id}),two=(await twoResponse.json()).task;assert.equal(two.reply_to,firstAnswer);
  assert.equal((await call("/api/agent/complete",{session_id:peer.id,task_id:two.id,claim:two.claim,text:"Synthetic peer"})).status,200);
  const three=await invoke("chat0110_next");assert.equal(three.task.step,2);await invoke("chat0110_reply",{task_id:three.task.id,text:"Synthetic final",outcome:"complete"});
  assert.equal(writes,3);assert.equal(q.chain("queue",7).status,"done");assert.equal(q.claim(a.id),null);assert.equal(q.claim(peer.id),null);
  assert.equal(db.query<{n:number},[]>("SELECT COUNT(*) AS n FROM tasks WHERE chain_id='queue'").get()!.n,3);
  const history=q.task(done.id,a.id,done.claim,true);assert.equal(history.answer_id,done.answer_id);assert.equal(history.text,"Previous");
  await node.close();node=undefined;q.close();db=undefined;
  db=new Database(working);q=new DispatchStore(db);assert.equal(q.session(a.id,7).alias,"codex");assert.equal(q.chain("queue",7).status,"done");
  app=await createApp({config,stateDb:db,dispatch:q,sessions,privacy:new Privacy(async()=>[]),fetch:fake});
  // После restart тот же MCP восстанавливает свой приватный state по публичному channel_id.
  node=await nodeMcp(join(mcp,"package/mcp.mjs"),auth,join(dir,"home"),origin);
  await invoke("chat0110_connect",{repo,chat_id:chat,alias:"codex",author:"codex",name:"Codex",channel_id:receipt.channel_id});await invoke("chat0110_status");
  await node.close();node=undefined;q.close();db=undefined;
  const blocked:string[]=[];
  for(const mode of ["running","interrupted","cancelled","expired","publication"]){
   const path=join(dir,mode+".sqlite");writeFileSync(path,sourceBytes);let testDb=new Database(path),store=new DispatchStore(testDb);
   if(mode==="publication"){const release=store.beginPublication(7,a.id,oldKey,done.id,done.claim,"Previous");release();store.close();testDb=new Database(path);store=new DispatchStore(testDb);}
   else {store.claim(a.id);if(mode==="cancelled")store.cancel(7,"queue");if(mode==="interrupted")testDb.exec("UPDATE tasks SET started=1 WHERE status='running'");if(mode==="expired")testDb.exec("UPDATE chain_limits SET expires_at=1 WHERE chain_id='queue'");store.chain("queue",7);}
   const permit=random();store.issueChannelReplacement(7,a.id,permit);const beforeDenied=snapshot(testDb);
   assert.throws(()=>store.replaceChannel(7,repo,chat,"codex","codex","66666666-7777-4888-8999-aaaaaaaaaaaa",random(),permit));
   assert.equal(snapshot(testDb),beforeDenied);assert.equal(store.session(a.id,7).external,"11111111-2222-4333-8444-555555555555");blocked.push(mode);store.close();
  }
  const policy=Bun.spawnSync(["python3",join(root,"deploy/rollback-policy.py"),working]);assert.equal(policy.exitCode,2,"Старый API ошибочно допущен после переноса");
  return {compatible:true,synthetic_only:true,session_id:a.id,task_ids:[one.task.id,two.id,three.task.id],answer_ids:[one.task.answer_id,two.answer_id,three.task.answer_id],source_snapshot_sha256:hash(before),queue_preserved:true,old_channel_rejected:true,publications:3,lost_ack_no_duplicate:true,restart_verified:true,blocked,unsafe_legacy_rollback:"closed",mcp_version:manifest.version};
 }finally{if(node)await node.close();server.stop(true);if(db)try{q?.close();}catch{}rmSync(dir,{recursive:true,force:true});}
}

if(import.meta.main){
 const root=process.argv[2];if(!root||!process.argv.includes("--synthetic"))throw Error("Нужны root и --synthetic; рабочая БД не допускается");
 try{const result=await checkChannelGuard(root);const receipt=process.argv[process.argv.indexOf("--receipt")+1];if(process.argv.includes("--receipt"))writeFileSync(receipt!,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));}
 catch{console.error("Совместимость канала/очереди не подтверждена; доставка должна остаться закрытой");process.exitCode=1;}
}
