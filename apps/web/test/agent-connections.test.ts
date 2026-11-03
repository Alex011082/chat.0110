import {expect,test} from "bun:test";
import {AgentConnections} from "../src/lib/agent-connections.ts";

test("шапка, панель и поле ввода используют один запрос и одну обновляемую копию состояния",async()=>{
 let calls=0,finish!:(value:any)=>void;
 const store=new AgentConnections(async()=>{calls++;return new Promise(r=>finish=r);});
 const offA=store.subscribe("a/b/chat",()=>{}),offB=store.subscribe("A/B/chat",()=>{});
 expect(calls).toBe(1);
 store.publish("a/b/chat",{sessions:[],chains:[],auto_requests:[{author:"claude",enabled:true}]});
 finish({sessions:[],chains:[],auto_requests:[]});await Bun.sleep(0);
 expect(store.snapshot("a/b/chat").data?.auto_requests?.[0]?.enabled).toBe(true);
 offA();expect(store.snapshot("a/b/chat").data).not.toBeNull();
 offB();expect(store.snapshot("a/b/chat").data).toBeNull();
});
test("запоздалое состояние закрытого чата не попадает в другое подключение",async()=>{
 let finish!:(value:any)=>void;
 const store=new AgentConnections(async()=>new Promise(r=>finish=r));
 const off=store.subscribe("old",()=>{});off();finish({sessions:[{id:"old"}],chains:[]});await Bun.sleep(0);
 expect(store.snapshot("old").data).toBeNull();expect(store.snapshot("new").data).toBeNull();
});
test("ответ старого POST не перезаписывает новое подключение к тому же чату",async()=>{
 const store=new AgentConnections(async()=>({sessions:[],chains:[]}));
 const stop=store.subscribe("a/b/chat",()=>{});await Bun.sleep(0);
 const staleWriter=store.writer("a/b/chat");stop();
 const stopNew=store.subscribe("a/b/chat",()=>{});await Bun.sleep(0);
 store.publish("a/b/chat",{sessions:[],chains:[],auto_requests:[{author:"claude",enabled:false}]});
 staleWriter({sessions:[],chains:[],auto_requests:[{author:"claude",enabled:true}]});
 expect(store.snapshot("a/b/chat").data?.auto_requests?.[0]?.enabled).toBe(false);
 stopNew();
});
