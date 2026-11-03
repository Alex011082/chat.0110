import {Database} from "bun:sqlite";
import {createCipheriv,createDecipheriv,createHmac,randomBytes} from "node:crypto";
import type {TimelineResponse} from "@chat0110/chat-protocol";
import {PRIVACY_POLICY_VERSION} from "./privacy-cache.ts";

/** Снимок содержит только результат privacy.object, никогда исходную историю. */
export class TimelineCache {
 private key:Buffer;
 private pending=new Map<string,Promise<TimelineResponse>>();
 private backgroundJobs=new Set<string>();
 constructor(private db:Database,key:Uint8Array,private policy=PRIVACY_POLICY_VERSION){
  this.key=createHmac("sha256",key).update("chat0110:timeline:v1").digest();
  db.exec("CREATE TABLE IF NOT EXISTS timeline_checked (id TEXT PRIMARY KEY, revision TEXT NOT NULL, sealed TEXT NOT NULL, touched INTEGER NOT NULL)");
 }
 private id(scope:string){return createHmac("sha256",this.key).update(this.policy+":"+scope).digest("hex");}
 get(scope:string,revision:string):TimelineResponse|null{
  const id=this.id(scope+":"+revision),row=this.db.query<{sealed:string;revision:string},[string]>("SELECT sealed,revision FROM timeline_checked WHERE id=?").get(id);
  if(!row||row.revision!==revision)return null;
  try{
   const b=Buffer.from(row.sealed,"base64"),d=createDecipheriv("aes-256-gcm",this.key,b.subarray(0,12));
   d.setAAD(Buffer.from(id+":"+revision));d.setAuthTag(b.subarray(12,28));
   return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());
  }catch{return null;}
 }
 put(scope:string,revision:string,value:TimelineResponse){
  const id=this.id(scope+":"+revision),iv=randomBytes(12),c=createCipheriv("aes-256-gcm",this.key,iv);
  c.setAAD(Buffer.from(id+":"+revision));
  const encrypted=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
  this.db.query("INSERT OR REPLACE INTO timeline_checked VALUES(?,?,?,?)").run(id,revision,Buffer.concat([iv,c.getAuthTag(),encrypted]).toString("base64"),Date.now());
  // Кеш ограничен отдельно от истории и не может вытеснить проверенные тексты.
  while(true){
   const size=this.db.query<{n:number;bytes:number},[]>("SELECT count(*) AS n,coalesce(sum(length(sealed)),0) AS bytes FROM timeline_checked").get()!;
   if(size.n<=100&&size.bytes<=32*1024*1024)break;
   this.db.exec("DELETE FROM timeline_checked WHERE id=(SELECT id FROM timeline_checked ORDER BY touched LIMIT 1)");
  }
 }
 active(scope:string,revision:string){return this.backgroundJobs.has(scope+":"+revision);}
 due(scope:string,revision:string){return !this.active(scope,revision)&&(this.db.query<{touched:number},[string]>("SELECT touched FROM timeline_checked WHERE id=?").get(this.id(scope+":"+revision))?.touched??0)<Date.now()-30_000;}
 background(scope:string,revision:string,work:()=>Promise<void>){
  const key=scope+":"+revision;
  if(this.backgroundJobs.has(key))return;
  this.backgroundJobs.add(key);
  setTimeout(()=>{void work().catch(()=>{}).finally(()=>this.backgroundJobs.delete(key));},0);
 }
 load(scope:string,revision:string,build:()=>Promise<TimelineResponse>){
  const key=this.id(scope)+":"+revision,old=this.pending.get(key);if(old)return old;
  const p=build().then(value=>{this.put(scope,revision,value);return value;}).finally(()=>this.pending.delete(key));
  this.pending.set(key,p);return p;
 }
}
