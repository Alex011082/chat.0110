import { test,expect } from "bun:test";
import { DraftStore } from "../src/lib/drafts.ts";
import { installPlatform } from "../src/lib/pwa.ts";
import { workerSource } from "../pwa-plugin.ts";
import { createContext,runInContext } from "node:vm";

test("update откладывается при draft, reply и незавершённой отправке; очистка не отправляет текст",()=>{
 const store=new DraftStore();store.activate(7);expect(store.canUpdate()).toBe(true);
 store.set("chat","черновик");expect(store.canUpdate()).toBe(false);expect(store.get("chat").text).toBe("черновик");
 store.set("chat","","reply-id");expect(store.canUpdate()).toBe(false);
 store.set("chat","");store.pending=true;expect(store.canUpdate()).toBe(false);store.pending=false;expect(store.canUpdate()).toBe(true);
 store.set("chat","приватный текст");store.activate(8);expect(store.get("chat")).toEqual({text:""});store.clear();expect(store.canUpdate()).toBe(true);
});
test("платформа установки не обещает beforeinstallprompt в Safari/iPad",()=>{
 expect(installPlatform("Mozilla iPhone",1)).toBe("ios");expect(installPlatform("Mozilla Macintosh",5)).toBe("ios");expect(installPlatform("Mozilla Macintosh",0)).toBe("mac");expect(installPlatform("Mozilla Android",1)).toBe("other");
});
test("SW не перехватывает API/auth/MCP/POST и не кэширует приватную навигацию",async()=>{
 const handlers:Record<string,(e:any)=>void>={};const values=new Map<string,Response>();let network=0;
 const cache={async addAll(urls:Request[]){for(const u of urls)values.set(new URL(u.url).pathname,new Response("public"));},async match(u:string){return values.get(u)?.clone();}};
 const ctx=createContext({URL,Response,Request:class extends Request{constructor(url:string,init?:RequestInit){super(new URL(url,"https://chat.0110.digital"),init);}},Promise,self:{location:{origin:"https://chat.0110.digital"},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name:string,fn:any)=>handlers[name]=fn},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async()=>{network++;throw Error("offline");}});
 runInContext(workerSource("fixture"),ctx);
 let ready:Promise<unknown>|undefined;handlers.install!({waitUntil:(p:Promise<unknown>)=>ready=p});await ready;
 for(const path of ["/api/me","/api/chats/a/b/c","/auth/callback?code=private","/mcp","/oauth/authorize","/webhook"]){let called=false;handlers.fetch!({request:new Request("https://chat.0110.digital"+path),respondWith:()=>called=true});expect(called).toBe(false);}
 let called=false;handlers.fetch!({request:new Request("https://chat.0110.digital/offline.html",{method:"POST",body:"private"}),respondWith:()=>called=true});expect(called).toBe(false);
 let response:Promise<Response>|undefined;handlers.fetch!({request:{url:"https://chat.0110.digital/A/B/20261030-pp11",method:"GET",mode:"navigate",headers:new Headers()},respondWith:(p:Promise<Response>)=>response=p});
 expect(await (await response!).text()).toBe("public");expect(network).toBe(1);
 expect([...values.keys()].every(x=>!x.includes("20261030")&&!x.startsWith("/api"))).toBe(true);
});

test("изменение только публичного offline-ресурса меняет версию SW",async()=>{
 const {pwaVersion}=await import("../pwa-plugin.ts");const names=["index.html","assets/main-fixed.js"];
 expect(pwaVersion(names,[new TextEncoder().encode("old offline")])).not.toBe(pwaVersion(names,[new TextEncoder().encode("new offline")]));
});
