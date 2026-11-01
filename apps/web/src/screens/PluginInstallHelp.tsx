import {useState} from "react";
import {canonicalMention} from "@chat0110/chat-protocol";
import {pluginPackages,pluginDownload,pluginVersion} from "../lib/plugins.ts";
import {Key} from "../ui/kit.tsx";
import {s} from "../strings.ts";

export function PluginInstallHelp({author,repo,chatId}:{author:string;repo:string;chatId:string}){
 const en=s.locale==="en",canonical=canonicalMention(author),pack=pluginPackages.find(p=>p.id===canonical);
 const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
 const task=en?`Connect this existing ${canonical} session to CHAT.0110 repo ${repo}, chat ${chatId}, with a unique alias. Check chat0110_status and report the real delivery capability. Do not start model polling or create another session.`:`Подключи эту существующую сессию ${canonical} к CHAT.0110: репозиторий ${repo}, чат ${chatId}, с уникальным alias. Проверь chat0110_status и сообщи фактическую готовность доставки. Не включай модельный опрос и не создавай другую сессию.`;
 return <details className="text-cap text-ink-2"><summary className="cursor-pointer py-1">{en?"Plugin setup":"Настроить плагин"}</summary>
  <div className="mt-2 flex flex-col gap-2">
   <p className="m-0">{en?"Install and authorize once in the existing AI session. This switch then controls participation in this chat.":"Один раз установи плагин и разреши участие в существующей сессии ИИ. После этого переключатель управляет участием в этом чате."}</p>
   {pack?<a href={pluginDownload(pack.file)} download className="py-1 text-action-ink">{en?"Download":"Скачать"} {pack.name} · {pluginVersion}</a>:null}
   <Key className="self-start text-cap" onClick={async()=>{try{await navigator.clipboard.writeText(task);setCopied(true);setFailed(false);}catch{setFailed(true);}}}>{copied?(en?"Copied":"Скопировано"):(en?"Copy setup request":"Скопировать запрос подключения")}</Key>
   {failed?<p role="alert" className="m-0">{en?"Copy the request below:":"Скопируй запрос ниже:"}<br/>{task}</p>:null}
   {canonical==="codex"?<p className="m-0">{en?"Local automatic delivery needs an active Codex host adapter; connecting MCP alone does not wake the session.":"Для локальной автодоставки нужен живой host-адаптер Codex; одного подключения MCP недостаточно для пробуждения сессии."}</p>:null}
   {canonical==="claude"?<p className="m-0">{en?"Automatic delivery requires an enabled channel in Claude Code. Channel approval is separate from installing the plugin.":"Для автодоставки нужен включённый канал Claude Code. Допуск канала проверяется отдельно от установки плагина."}</p>:null}
  </div>
 </details>;
}
