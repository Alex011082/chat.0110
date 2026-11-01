import {watch,readFileSync,writeFileSync,renameSync,existsSync,lstatSync,readdirSync,type FSWatcher} from "node:fs";
import {join,basename} from "node:path";
import {randomUUID} from "node:crypto";

function save(path:string,value:unknown){const tmp=`${path}.${randomUUID()}.tmp`;writeFileSync(tmp,JSON.stringify(value),{mode:0o600});renameSync(tmp,path);}
export function waitLocalFile(root:string,name:string,timeoutMs=45_000):Promise<any>{
 return new Promise((resolve,reject)=>{
  let finished=false;
  const close=()=>{clearTimeout(timer);clearInterval(reconcile);watcher.close();};
  const check=()=>{if(finished||!existsSync(join(root,name)))return;finished=true;close();try{resolve(JSON.parse(readFileSync(join(root,name),"utf8")));}catch{reject(Error("Неверный ответ локального listener"));}};
  const watcher=watch(root,(_event,file)=>{if(file&&basename(String(file))===name)check();});
  const timer=setTimeout(()=>{if(finished)return;finished=true;close();reject(Error("Локальный listener не ответил; работа не подтверждена"));},timeoutMs);
  // FSEvents может объединять rename; сверяем только приватную локальную квитанцию, не модель/PR.
  const reconcile=setInterval(check,50);
  check();
 });
}
/** HTTP и gh выполняет уже разрешённый listener; получатель работает только с файлами. */
export async function readLocalContext(root:string,taskId:string,timeoutMs=45_000):Promise<unknown>{
 if(!/^[a-zA-Z0-9-]{1,100}$/.test(taskId))throw Error("Неверный task_id");
 const id=randomUUID(),response=`${id}.context-response.json`;
 save(join(root,`${id}.context-request.json`),{task_id:taskId});
 const result=await waitLocalFile(root,response,timeoutMs);
 if(!result.ok)throw Error("Контекст недоступен: listener не подтвердил текущий claim");
 return result.value;
}
export class ContextMailbox {
 private watcher:FSWatcher;
 private seen=new Set<string>();
 private closed=false;
 private reconcile:ReturnType<typeof setInterval>;
 constructor(private root:string,private context:(id:string)=>Promise<unknown>){
  this.watcher=watch(root,(_event,name)=>{if(name)void this.handle(basename(String(name)));});
  this.reconcile=setInterval(()=>{for(const name of readdirSync(root))void this.handle(name);},250);
 }
 private async handle(name:string){
  if(this.closed||!/^([0-9a-f-]{36})\.context-request\.json$/.test(name)||this.seen.has(name))return;
  if(!existsSync(join(this.root,name)))return;
  this.seen.add(name);
  const response=join(this.root,name.replace("context-request","context-response"));
  if(existsSync(response))return;
  try{
   const path=join(this.root,name),st=lstatSync(path);
   if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||st.size>512)throw Error();
   const request=JSON.parse(readFileSync(path,"utf8"));
   if(typeof request.task_id!=="string"||!/^[a-zA-Z0-9-]{1,100}$/.test(request.task_id))throw Error();
   const value=await this.context(request.task_id);if(!this.closed)save(response,{ok:true,value});
  }catch{if(!this.closed)save(response,{ok:false});}
 }
 close(){this.closed=true;clearInterval(this.reconcile);this.watcher.close();}
}
