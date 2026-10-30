import {createInterface,type Interface} from "node:readline";
import type {Readable} from "node:stream";
import type {NativeSendResult} from "./native-delivery.ts";

/** Host держит штатные tools; runner не получает его приватный RPC или credentials. */
export class CodexToolTransport {
 private lines:Interface;
 private closed=false;
 private current:{id:string;finish:(result:NativeSendResult)=>void}|null=null;
 constructor(private thread:string,input:Readable,private emit:(line:string)=>void,private timeoutMs=60_000){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread))throw new Error("Нужен точный UUID существующей Codex-сессии");
  this.lines=createInterface({input,terminal:false});
  this.lines.on("line",line=>{
   if(line.length>4096){this.close();return;}
   let receipt:any;try{receipt=JSON.parse(line);}catch{return;}
   if(receipt.type!=="chat0110.codex.receipt"||receipt.id!==this.current?.id||!["not_sent","sent_unconfirmed","uncertain"].includes(receipt.status))return;
   this.current?.finish(receipt.status);
  });
  this.lines.on("close",()=>this.close());input.on("error",()=>this.close());
 }
 async send(text:string,id:string):Promise<NativeSendResult>{
  if(this.closed)return "not_sent";
  if(this.current)throw new Error("Host ещё не подтвердил предыдущую доставку");
  if(!text.trim()||text.length>60_000||!/^[\x21-\x7e]{1,200}$/.test(id))throw new Error("Неверный конверт доставки");
  return new Promise(resolve=>{
   const timer=setTimeout(()=>finish("uncertain"),this.timeoutMs);
   const finish=(result:NativeSendResult)=>{if(this.current?.id!==id)return;clearTimeout(timer);this.current=null;resolve(result);};
   this.current={id,finish};
   try{this.emit(JSON.stringify({type:"chat0110.codex.deliver",id,thread_id:this.thread,text}));}catch{finish("uncertain");}
  });
 }
 close(){if(this.closed)return;this.closed=true;this.current?.finish("uncertain");this.lines.close();}
}
