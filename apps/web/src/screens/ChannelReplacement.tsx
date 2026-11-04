import {useState} from "react";
import type {AgentSession} from "@chat0110/chat-protocol";
import {Sheet} from "../ui/Sheet.tsx";
import {Key,Plate} from "../ui/kit.tsx";
import {s} from "../strings.ts";
import {useCopy} from "../hooks.ts";

/** Разрешение не меняет привязку: его должен предъявить выбранный владельцем новый канал. */
export function ChannelReplacement({session,repo,chatId}:{session:AgentSession;repo:string;chatId:string}){
 const en=s.locale==="en",[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[request,setRequest]=useState(""),[error,setError]=useState("");
 const {copy,copied}=useCopy();
 if(session.author==="chatgpt")return null;
 const prepare=async()=>{
  setBusy(true);setError("");
  try{
   const code=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
   const path=`/api/chats/${[...repo.split("/"),chatId].map(encodeURIComponent).join("/")}/channel-replacement`;
   const response=await fetch(path,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:session.id,code})});
   if(!response.ok)throw Error(response.status===403?(en?"Only the owner of this open chat can replace the channel.":"Заменить канал может только владелец открытого чата."):(en?"Could not prepare replacement. Try again.":"Не удалось подготовить замену. Повтори попытку."));
   const args={repo,chat_id:chatId,alias:session.alias,name:session.name,author:session.author,...(session.model?{model:session.model}:{}),replacement_code:code};
   setRequest(`${en?"In this existing AI session, use the local chat0110-local MCP. Check that chat0110_connect accepts replacement_code. If missing, update CHAT.0110 to 0.4.2 and restart this MCP only. Then call chat0110_connect once with":"В этой существующей сессии ИИ используй локальный MCP chat0110-local. Убедись, что chat0110_connect принимает replacement_code. Если поля нет, обнови CHAT.0110 до 0.4.2 и перезапусти только этот MCP. Затем вызови chat0110_connect один раз с"}:\n${JSON.stringify(args,null,2)}\n${en?"Check chat0110_status. Do not change alias, revoke OAuth, start tasks or publish this code. On a busy/uncertain task error, stop and reconcile the previous result; never re-execute it. MCP availability does not prove automatic idle delivery.":"Проверь chat0110_status. Не меняй alias, не отзывай OAuth, не запускай задания и не публикуй этот код. При ошибке занятого/неопределённого хода остановись и сверь прежний результат; повторное исполнение запрещено. Наличие MCP ещё не доказывает автодоставку в простаивающую сессию."}`);
  }catch(e){setError(e instanceof Error?e.message:(en?"Replacement unavailable":"Замена недоступна"));}finally{setBusy(false);}
 };
 return <>
  <Key className="self-start text-cap" onClick={()=>{setRequest("");setError("");setOpen(true);}}>{en?"Replace channel":"Заменить канал"}</Key>
  <Sheet open={open} onClose={()=>setOpen(false)} label={en?"Replace participant channel":"Заменить канал участника"} className="mx-auto my-4 w-[min(640px,calc(100vw-28px))]">
   <Plate className="flex max-h-[calc(100dvh-32px)] flex-col gap-4 overflow-auto p-6">
    <h2 className="m-0 text-section font-semibold">{en?"Replace channel":"Заменить канал"}: {session.name}</h2>
    <p className="m-0 text-copy [overflow-wrap:anywhere]">@{session.alias} · {repo} · {chatId}</p>
    <p className="m-0 text-cap text-ink-2">{en?"Your name, history and queue stay. The old channel loses access only when the new local MCP presents this permission and its private key. A claimed task with an uncertain result blocks replacement.":"Имя, история и очередь сохранятся. Старый канал потеряет доступ, когда новый локальный MCP предъявит разрешение и свой приватный ключ. Взятое задание с неопределённым результатом блокирует замену."}</p>
    {request?<><p className="m-0 text-cap text-ink-2">{en?"Valid for 10 minutes. Send privately to the chosen existing AI session; do not publish in a chat or PR.":"Действует 10 минут. Передай лично выбранной существующей сессии ИИ; не публикуй в чате или PR."}</p><textarea readOnly rows={9} className="w-full rounded-field bg-ground p-3 text-cap" value={request} aria-label={en?"Private replacement request":"Приватный запрос замены"}/><Key onClick={()=>void copy(request)}>{copied?(en?"Copied":"Скопировано"):(en?"Copy request":"Скопировать запрос")}</Key></>:<Key disabled={busy} onClick={()=>void prepare()}>{busy?(en?"Preparing…":"Подготовка…"):(en?"Allow replacement for this participant":"Разрешить замену этого участника")}</Key>}
    {error?<p role="alert" className="m-0 text-cap text-action-ink">{error}</p>:null}
    <Key onClick={()=>setOpen(false)}>{en?"Close":"Закрыть"}</Key>
   </Plate>
  </Sheet>
 </>;
}
