import type {Database} from "bun:sqlite";
import {createHash,timingSafeEqual} from "node:crypto";
import type {SessionRow} from "./dispatch.ts";
import {badRequest,forbidden,HttpError,notFound} from "./errors.ts";

const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const valid=(s:unknown):s is string=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
interface Permit {code_hash:string;session_id:string;uid:number;expected_external:string;expires:number;used_external:string|null;key_hash:string|null}

/** Разрешение владельца и ключ канала независимы от общего OAuth аккаунта. */
export class ChannelReplacements {
 constructor(private db:Database){
  db.exec(`CREATE TABLE IF NOT EXISTS channel_bindings (session_id TEXT PRIMARY KEY,key_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS channel_publications (task_id TEXT PRIMARY KEY,session_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS channel_replacements (code_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL,uid INTEGER NOT NULL,expected_external TEXT NOT NULL,expires INTEGER NOT NULL,used_external TEXT,key_hash TEXT)`);
 }
 private session(uid:number,id:string):SessionRow{
  const s=this.db.query<SessionRow,[string,number]>("SELECT * FROM sessions WHERE id=? AND uid=?").get(id,uid);
  if(!s)throw notFound("Сессия не найдена");return s;
 }
 assert(uid:number,id:string,key?:unknown){
  this.session(uid,id);
  const binding=this.db.query<{key_hash:string},[string]>("SELECT key_hash FROM channel_bindings WHERE session_id=?").get(id);
  if(binding&&(!valid(key)||!timingSafeEqual(Buffer.from(binding.key_hash,"hex"),Buffer.from(digest(key),"hex"))))
   throw forbidden("Канал участника заменён. Нужен приватный ключ действующего канала");
 }
 issue(uid:number,id:string,code:unknown){
  if(!valid(code))throw badRequest("Неверный код замены");
  return this.db.transaction(()=>{
   const s=this.session(uid,id);
   if(s.external.startsWith("cloud:"))throw new HttpError(409,"conflict","Облачный канал ChatGPT заменяется отдельно");
   const hash=digest(code),old=this.db.query<Permit,[string]>("SELECT * FROM channel_replacements WHERE code_hash=?").get(hash);
   if(old)throw new HttpError(409,"conflict","Подготовь новое разрешение на замену");
   this.db.query("DELETE FROM channel_replacements WHERE session_id=? AND used_external IS NULL").run(id);
   const expires=Date.now()+10*60_000;
   this.db.query("INSERT INTO channel_replacements VALUES (?,?,?,?,?,NULL,NULL)").run(hash,id,uid,s.external,expires);
   return {session_id:id,alias:s.alias,name:s.name,author:s.author,expires_at:expires};
  }).immediate();
 }
 replace(uid:number,repo:string,chat:string,alias:string,author:string,external:string,key:unknown,code:unknown):{session:SessionRow;changed:boolean}{
  if(!valid(code)||!valid(key)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(external))throw badRequest("Неверное доказательство нового канала");
  return this.db.transaction(()=>{
   const hash=digest(code),keyHash=digest(key),permit=this.db.query<Permit,[string,number]>("SELECT * FROM channel_replacements WHERE code_hash=? AND uid=?").get(hash,uid);
   if(!permit)throw new HttpError(409,"conflict","Нет разрешения владельца на замену этого канала");
   const s=this.session(uid,permit.session_id);
   if(s.repo!==repo.toLowerCase()||s.chat!==chat||s.alias!==alias.toLowerCase()||s.author!==author)throw forbidden("Разрешение выдано другому участнику или чату");
   if(permit.used_external!==null){
    if(permit.used_external!==external||permit.key_hash!==keyHash||s.external!==external)throw new HttpError(409,"conflict","Разрешение уже использовано другим каналом");
    this.assert(uid,s.id,key);return {session:s,changed:false};
   }
   if(permit.expires<=Date.now()||s.external!==permit.expected_external)throw new HttpError(409,"conflict","Разрешение истекло или привязка уже изменилась");
   const binding=this.db.query<{key_hash:string},[string]>("SELECT key_hash FROM channel_bindings WHERE session_id=?").get(s.id);
   if(s.external===external||binding?.key_hash===keyHash)throw new HttpError(409,"conflict","Новый канал должен иметь собственные идентичность и ключ");
   // Даже Stop/expiry не доказывает, что внешнее действие или публикация не состоялись.
   if(this.db.query("SELECT id FROM tasks WHERE session_id=? AND claim IS NOT NULL AND status!='done' LIMIT 1").get(s.id))
    throw new HttpError(409,"conflict","Есть взятое задание с неподтверждённым исходом. Сначала сверьте результат; повторная выдача запрещена");
   if(this.db.query("SELECT task_id FROM channel_publications WHERE session_id=? LIMIT 1").get(s.id))throw new HttpError(409,"conflict","Публикация ответа ещё не подтверждена. Сначала сверьте результат прежнего канала");
   if(this.db.query("SELECT id FROM sessions WHERE uid=? AND repo=? AND chat=? AND external=? AND id!=?").get(uid,s.repo,s.chat,external,s.id))throw new HttpError(409,"conflict","Новый канал уже занят другим участником");
   this.db.query("UPDATE sessions SET external=?,seen=0,auto_generation=auto_generation+1 WHERE id=?").run(external,s.id);
   this.db.query("INSERT INTO channel_bindings VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET key_hash=excluded.key_hash").run(s.id,keyHash);
   this.db.query("UPDATE channel_replacements SET used_external=?,key_hash=? WHERE code_hash=?").run(external,keyHash,hash);
   return {session:this.session(uid,s.id),changed:true};
  }).immediate();
 }
}
