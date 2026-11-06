import {readdir, realpath} from "node:fs/promises";
import {join, resolve} from "node:path";
import {API_PATH, CHAT, CHAT_PATH, REPO, chatSummary, notice, phases, replayTimeline, sourceSnapshot} from "./fixture.ts";

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const esc=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
const apiQueries=new Map([
 ["/api/me",[""]],["/api/config",[""]],
 ...["repos"].map(name=>[`/api/${name}`,[""]] as [string,string[]]),
 ...["chats","activation","migration"].map(name=>[`/api/${name}`,[`repo=${encodeURIComponent(REPO)}`]] as [string,string[]]),
 [API_PATH,["","limit=10"]],[`${API_PATH}/dispatch`,[""]],[`${API_PATH}/auto-replies`,[""]],
 ["/api/events",[`repo=${encodeURIComponent(REPO)}`]],
]);

function allowedApi(url:URL):boolean {
 const queries=apiQueries.get(url.pathname.toLowerCase());
 return Boolean(queries?.some(query=>new URLSearchParams(query).toString().toLowerCase()===url.searchParams.toString().toLowerCase()));
}
export function allowedBrowserRequest(raw:string,method:string,origin:string,assets:Set<string>):boolean {
 const url=new URL(raw);
 if(method!=="GET"||url.origin!==origin)return false;
 return allowedApi(url)||(!url.search&&(["/__recording","/__evidence",CHAT_PATH].includes(url.pathname)||assets.has(url.pathname)));
}

export async function createReplayHandler(dist:string){
 const root=await realpath(dist),files=new Map<string,string>();
 // Только обычные файлы собранного web/dist: symlink и downloads не открываются.
 const scan=async(directory:string,prefix="")=>{
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const path=`${prefix}/${entry.name}`;
   if(entry.isDirectory()&&entry.name==="assets")await scan(join(directory,entry.name),path);
   else if(entry.isFile()&&(prefix.startsWith("/assets")||["/index.html","/favicon.ico","/icon.svg"].includes(path)))files.set(path,join(directory,entry.name));
  }
 };
 await scan(root);
 if(!files.has("/index.html"))throw Error("Built application is missing");
 const assets=new Set(files.keys());
 let phase=0;
 const streams=new Set<ReadableStreamDefaultController<Uint8Array>>(),encoder=new TextEncoder();
 const emit=()=>{
  const data=encoder.encode(`event: chat.updated\ndata: ${JSON.stringify({repo:REPO,chat_id:CHAT,number:206})}\n\n`);
  for(const stream of streams){try{stream.enqueue(data);}catch{streams.delete(stream);}}
 };
 const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; form-action 'none'; object-src 'none'; base-uri 'none'"};
 const recording=`<!doctype html><html lang="en"><meta charset="utf-8"><title>CHAT.0110 · historical review demo</title><style>*{box-sizing:border-box}body{margin:0;background:#101112;color:#f6f3ed;font:22px/1.45 system-ui,sans-serif;height:100vh;display:grid;grid-template-rows:62px 1fr 144px}header{padding:16px 28px;font-size:17px;letter-spacing:.03em;border-bottom:1px solid #414242;display:flex;justify-content:space-between}header strong{color:#ff995e}iframe{border:0;width:100%;height:100%;background:#f7f7f5}footer{padding:18px 38px;display:grid;grid-template-columns:310px 1fr;gap:28px;align-items:center;border-top:3px solid #e15a16}h1{font-size:25px;line-height:1.2;margin:0}p{font-size:21px;margin:0;color:#e4e1db}</style><header><span>CHAT.0110 / Dream Knesset PR #206</span><strong>${notice}</strong></header><iframe title="Actual CHAT.0110 interface" src="${CHAT_PATH}"></iframe><footer><h1 id="phase-title">${phases[0]!.title}</h1><p id="caption">${phases[0]!.caption}</p></footer></html>`;
 const evidence=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Source evidence</title><style>body{margin:0;padding:36px 64px;background:#f7f7f5;color:#1d2021;font:21px/1.4 system-ui}h1{font-size:34px;margin:0 0 8px}p{margin:6px 0 20px}li{margin:14px 0}a{color:#ae420e;overflow-wrap:anywhere;font-size:16px}code{font-size:17px}small{color:#5c6366}</style><h1>Source evidence</h1><p>Historical public conversation · English summaries / excerpts</p><small>Snapshot: ${sourceSnapshot.sourceHeadSha}</small><ol>${sourceSnapshot.messages.map(message=>`<li><strong>${esc(message.author)}</strong> · <code>${esc(message.id)}</code><br><a href="${esc(message.sourceUrl)}">${esc(message.sourceUrl)}</a></li>`).join("")}</ol><p>Code change: PR #238 · <code>fb7eb23</code><br>Release remains the owner's decision.</p><small>No live AI calls · No deployment · No real-client acceptance</small></html>`;
 return {
  assets,
  setPhase(next:number){if(!phases[next])throw Error("Unknown replay phase");phase=next;emit();},
  async fetch(request:Request):Promise<Response>{
   const url=new URL(request.url),path=url.pathname.toLowerCase();
   if(url.hostname!=="127.0.0.1"||url.protocol!=="http:")return json({error:"loopback_only"},403);
   if(request.method!=="GET")return json({error:"read_only_replay"},405);
   if(!allowedBrowserRequest(url.href,request.method,url.origin,assets))return json({error:"not_found"},404);
   if(path==="/__recording")return new Response(recording,{headers});
   if(path==="/__evidence")return new Response(evidence,{headers});
   if(path==="/api/events"){
    let controller:ReadableStreamDefaultController<Uint8Array>;
    const body=new ReadableStream<Uint8Array>({start(value){controller=value;streams.add(value);value.enqueue(encoder.encode(": historical replay\n\n"));},cancel(){streams.delete(controller);}});
    return new Response(body,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-store"}});
   }
   if(path==="/api/me")return json({login:"reviewer-sample",id:1,name:"Sample reviewer",avatar_url:""});
   if(path==="/api/config")return json({app_slug:"chat0110",install_url:"#historical-replay"});
   if(path==="/api/repos")return json([{full_name:REPO,owner:"Alex011082",name:"dream_knesset",private:false,default_branch:"main",can_push:false,installation_id:0}]);
   if(path==="/api/chats")return json([chatSummary]);
   if(path==="/api/activation")return json({repo:REPO,activated:true,agents_doc:true,legacy_chats:false,protocol_invalid:false,can_push:false,default_branch:"main",gaps:[]});
   if(path==="/api/migration")return json({repo:REPO,can_push:false,items:[]});
   if(path===API_PATH)return json(replayTimeline(phase));
   if(path===`${API_PATH}/dispatch`||path===`${API_PATH}/auto-replies`)return json({sessions:[],chains:[]});
   const file=url.pathname===CHAT_PATH?files.get("/index.html"):files.get(url.pathname);
   if(!file)return json({error:"not_found"},404);
   return new Response(Bun.file(file),{headers:{"Cache-Control":"no-store","Content-Security-Policy":headers["Content-Security-Policy"]}});
  },
 };
}

export async function startReplay(dist=resolve("apps/web/dist")){
 const handler=await createReplayHandler(dist);
 // Нет настройки публичного bind: этот сервер никогда не служит demo-login.
 const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,fetch:handler.fetch});
 return {...handler,origin:`http://127.0.0.1:${server.port}`,stop:()=>server.stop(true)};
}
