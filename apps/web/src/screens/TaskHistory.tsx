import {useState} from "react";
import type {DispatchView} from "@chat0110/chat-protocol";
import {dispatchText} from "../dispatch.ts";
import {s} from "../strings.ts";

/** Краткая строка у ввода не должна лишать остальные цепочки кнопки остановки. */
export function TaskHistory({view,canStop,onStop}:{view:DispatchView;canStop:boolean;onStop:(id:string)=>void|Promise<unknown>}){
 const d=dispatchText(s.locale==="en"),[busy,setBusy]=useState<string|null>(null),[failed,setFailed]=useState(false);
 if(!view.chains.length)return <p>{s.locale==="en"?"No tasks yet":"Пока нет заданий"}</p>;
 const stop=async(id:string)=>{if(busy)return;setBusy(id);setFailed(false);try{await onStop(id);}catch{setFailed(true);}finally{setBusy(null);}};
 return <div className="flex flex-col gap-3">
  {view.chains.map(chain=><div key={chain.id} data-chain={chain.id} className="task-history-row">
   <span>{chain.route.map(id=>view.sessions.find(session=>session.id===id)?.name??"?").join(" → ")}</span>
   <div className="flex items-center justify-between gap-3"><span className="text-cap text-ink-2">{d.status[chain.status]}</span>
    {canStop&&["preparing","waiting","running","interrupted"].includes(chain.status)?<button type="button" className="min-h-11 border-0 bg-transparent px-2 text-action-ink" disabled={!!busy} onClick={()=>void stop(chain.id)}>{d.stop}</button>:null}
   </div>
  </div>)}
  {failed?<p role="alert" className="text-cap text-action-ink">{d.failed}</p>:null}
 </div>;
}
