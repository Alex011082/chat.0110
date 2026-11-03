import {useMemo,useState} from "react";
import {canonicalMention} from "@chat0110/chat-protocol";
import {Key} from "../ui/kit.tsx";
import {Sheet} from "../ui/Sheet.tsx";
import {ConnectAgents} from "./ConnectAgents.tsx";
import {s} from "../strings.ts";

export function PluginInstallHelp({author,repo,chatId}:{author:string;repo:string;chatId:string}){
 const [open,setOpen]=useState(false),en=s.locale==="en";
 const canonical=canonicalMention(author),context=useMemo(()=>({repo,chat_id:chatId}),[repo,chatId]);
 return <>
  <Key className="self-start text-cap" onClick={()=>setOpen(true)}>{en?"Set up connection":"Настроить подключение"}</Key>
  <Sheet open={open} onClose={()=>setOpen(false)} label={en?"MCP connection setup":"Настройка подключения MCP"} className="mx-auto my-4 w-[min(900px,calc(100vw-28px))]">
   <div className="max-h-[calc(100dvh-32px)] overflow-y-auto rounded-device bg-ground">
    <div className="flex justify-end px-4 pt-3"><Key onClick={()=>setOpen(false)}>{en?"Close":"Закрыть"}</Key></div>
    <ConnectAgents embedded chatContext={context} initialClient={canonical==="claude"?"claude-code":canonical}/>
   </div>
  </Sheet>
 </>;
}
