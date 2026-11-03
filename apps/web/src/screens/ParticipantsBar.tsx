import {useEffect,useId,useMemo,useRef,useState} from "react";
import type {ChatDetail} from "@chat0110/chat-protocol";
import {useAgentConnections} from "../lib/agent-connections.ts";
import {participantTargets} from "../lib/participant-targets.ts";
import {agentConnectionLabel,agentDeliveryState} from "../lib/auto-replies.ts";
import {initials} from "../lib/text.ts";
import {s} from "../strings.ts";
import {PlusIcon,CloseIcon} from "../ui/icons.tsx";
import {ParticipantAutoReplies} from "./ParticipantAutoReplies.tsx";
import {PluginInstallHelp} from "./PluginInstallHelp.tsx";

export function ParticipantsBar({chat,limit=4}:{chat:ChatDetail;limit?:number}){
 const key=`${chat.repo}/${chat.chat_id}`;
 const {data:view,error,setView}=useAgentConnections(key),en=s.locale==="en";
 const targets=useMemo(()=>participantTargets(chat.participants,view?.sessions??[]),[chat.participants,view?.sessions]);
 const [selected,setSelected]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null),triggers=useRef(new Map<string,HTMLButtonElement>()),id=useId();
 const target=targets.find(row=>row.id===selected),shown=targets.slice(0,limit);
 const close=(restore=false)=>{if(restore&&selected)(triggers.current.get(selected)??triggers.current.get("list"))?.focus();setSelected(null);};
 useEffect(()=>{setSelected(null);},[key]);
 useEffect(()=>{
  if(!selected)return;
  panel.current?.querySelector<HTMLElement>("button")?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setSelected(null);};
  const esc=(e:KeyboardEvent)=>{if(e.defaultPrevented||(e.target as Element)?.closest?.("dialog[open]"))return;if(e.key==="Escape"&&root.current?.contains(e.target as Node)){e.preventDefault();close(true);}};
  document.addEventListener("pointerdown",outside);document.addEventListener("keydown",esc);
  return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",esc);};
 },[selected]);
 return <div ref={root} className="participant-controls">
  <div className="participant-buttons" aria-label={s.info.participants}>
   {shown.map(row=>{
    const state=row.session&&view?agentDeliveryState(row.session,view):"off";
    const status=row.session&&view?agentConnectionLabel(row.session,view,en):row.participant.is_agent?(en?"Session not connected":"Сессия не подключена"):(en?"Participant":"Участник");
    const title=`${row.name}${row.session?.model?` · ${row.session.model}`:""}${row.session?` · @${row.session.alias}`:""} — ${status}`;
    return <button key={row.id} ref={node=>{if(node)triggers.current.set(row.id,node);else triggers.current.delete(row.id);}} type="button" className="participant-face" aria-label={`${en?"Open participant":"Открыть участника"}: ${row.name}${row.session?` · @${row.session.alias}`:""} — ${status}`} title={title} aria-haspopup="dialog" aria-controls={selected===row.id?id:undefined} aria-expanded={selected===row.id} data-state={state} data-human={!row.participant.is_agent||undefined} onClick={()=>setSelected(selected===row.id?null:row.id)}>
     <span aria-hidden="true">{initials(row.author,row.name)}</span>
     {row.participant.is_agent?<i aria-hidden="true" className="participant-status"/>:null}
    </button>;
   })}
   {targets.length>limit?<button type="button" ref={node=>{if(node)triggers.current.set("list",node);}} className="participant-overflow" aria-label={en?"All participants":"Все участники"} aria-haspopup="dialog" aria-expanded={selected==="list"} onClick={()=>setSelected(selected==="list"?null:"list")}>+{targets.length-limit}</button>:null}
   {chat.can_push&&chat.state==="open"?<PluginInstallHelp author="agent" repo={chat.repo} chatId={chat.chat_id} icon={<PlusIcon/>} label={en?"Invite AI to this chat":"Пригласить ИИ в этот чат"}/>:null}
  </div>
  {selected&&(target||selected==="list")?<section ref={panel} id={id} role="dialog" aria-label={target?`${en?"Participant":"Участник"}: ${target.name}`:s.info.participants} className="participant-popover">
   <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="m-0 text-section font-semibold [overflow-wrap:anywhere]">{target?.name??s.info.participants}</h2>{target?.session?.model?<p className="mb-0 mt-1 text-cap text-ink-2">{target.session.model}</p>:null}</div><button type="button" className="settings-trigger shrink-0" aria-label={en?"Close participant":"Закрыть участника"} onClick={()=>close(true)}><CloseIcon/></button></header>
   {selected==="list"?<div className="flex flex-col gap-1">{targets.map(row=><button key={row.id} type="button" className="participant-list-row" onClick={()=>setSelected(row.id)}><strong className="text-key font-semibold">{row.name}</strong>{row.session?<span className="text-cap text-ink-2">@{row.session.alias}</span>:null}</button>)}</div>:target?.participant.is_agent?<>
    <p className="m-0 text-cap text-ink-2">{en?"Controls for this chat only":"Управление только в этом чате"}</p>
    {error?<p role="status" className="m-0 text-cap text-action-ink">{en?"Status unavailable. Retrying…":"Статус недоступен. Повторяем проверку…"}</p>:null}
    <ParticipantAutoReplies author={target.author} sessions={target.session?[target.session]:[]} view={view} repo={chat.repo} chatId={chat.chat_id} canPush={chat.can_push&&chat.state==="open"} compact onChange={setView}/>
   </>:<p className="m-0 text-copy text-ink-2">{target?.author===chat.created_by?(en?"Chat owner":"Владелец чата"):(en?"Chat participant":"Участник чата")}</p>}
  </section>:null}
 </div>;
}
