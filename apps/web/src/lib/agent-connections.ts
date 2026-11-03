import {useCallback,useMemo,useSyncExternalStore} from "react";
import {dispatchRequest} from "../dispatch.ts";
import type {AutoReplyView} from "./auto-replies.ts";

type Snapshot={data:AutoReplyView|null;error:boolean};
type Entry={snapshot:Snapshot;listeners:Set<()=>void>;timer:ReturnType<typeof setInterval>|null;epoch:number;loading:boolean};
const EMPTY:Snapshot={data:null,error:false};

/** Одно наблюдение на открытый чат; панели не создают собственный опрос. */
export class AgentConnections {
 private entries=new Map<string,Entry>();
 constructor(private load:(key:string)=>Promise<AutoReplyView>=dispatchRequest){}
 snapshot=(key:string):Snapshot=>this.entries.get(key.toLowerCase())?.snapshot??EMPTY;
 subscribe=(key:string,listener:()=>void)=>{
  if(!key)return()=>{};
  key=key.toLowerCase();
  let entry=this.entries.get(key);
  if(!entry){
   entry={snapshot:EMPTY,listeners:new Set(),timer:null,epoch:0,loading:false};
   this.entries.set(key,entry);
   entry.listeners.add(listener);
   const refresh=async()=>{
    if(entry!.loading)return;
    if(typeof document!=="undefined"&&document.visibilityState==="hidden")return;
    entry!.loading=true;
    const epoch=entry!.epoch;
    try{
     const data=await this.load(key);
     if(this.entries.get(key)!==entry||entry!.epoch!==epoch)return;
     entry!.snapshot={data,error:false};
    }catch{
     if(this.entries.get(key)!==entry||entry!.epoch!==epoch)return;
     entry!.snapshot={...entry!.snapshot,error:true};
    }finally{entry!.loading=false;}
    for(const notify of entry!.listeners)notify();
   };
   entry.timer=setInterval(()=>void refresh(),5000);
   void refresh();
  }else entry.listeners.add(listener);
  const current=entry;
  return()=>{
   current.listeners.delete(listener);
   if(!current.listeners.size){if(current.timer)clearInterval(current.timer);if(this.entries.get(key)===current)this.entries.delete(key);}
  };
 };
 publish=(key:string,data:AutoReplyView)=>{
  key=key.toLowerCase();
  const entry=this.entries.get(key);if(!entry)return;
  // GET, начавшийся до переключения, не должен вернуть старое положение.
  entry.epoch++;entry.snapshot={data,error:false};
  for(const notify of entry.listeners)notify();
 };
 writer=(key:string)=>{
  key=key.toLowerCase();const entry=this.entries.get(key);
  return(data:AutoReplyView)=>{if(entry&&this.entries.get(key)===entry)this.publish(key,data);};
 };
}
const connections=new AgentConnections();
export function useAgentConnections(key:string){
 const subscribe=useCallback((fn:()=>void)=>connections.subscribe(key,fn),[key]);
 const snapshot=useSyncExternalStore(subscribe,useCallback(()=>connections.snapshot(key),[key]),()=>EMPTY);
 const setView=useMemo(()=>connections.writer(key),[key,snapshot]);
 return {...snapshot,setView};
}
