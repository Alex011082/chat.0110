import {useState} from "react";
import {canonicalMention} from "@chat0110/chat-protocol";
import {pluginPackages,pluginDownload,pluginVersion} from "../lib/plugins.ts";
import {agentCards,endpoint} from "../lib/agent-catalog.ts";
import {mcpSetupCommand} from "../lib/mcp-setup.ts";
import {Key} from "../ui/kit.tsx";
import {s} from "../strings.ts";

export function PluginInstallHelp({author,repo,chatId}:{author:string;repo:string;chatId:string}){
 const en=s.locale==="en",canonical=canonicalMention(author),pack=pluginPackages.find(p=>p.id===canonical);
 const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
 const card=agentCards(en).find(c=>c.id===(canonical==="claude"?"claude-code":canonical==="grok"?"grok-build":canonical))??agentCards(en).find(c=>c.id==="other-ai")!;
 const command=mcpSetupCommand(card),task=command??endpoint;
 const setupUrl=`/connect?repo=${encodeURIComponent(repo)}&chat=${encodeURIComponent(chatId)}#${card.id}`;
 return <details className="text-cap text-ink-2"><summary className="cursor-pointer py-1">{en?"Plugin setup":"Настроить плагин"}</summary>
  <div className="mt-2 flex flex-col gap-2">
   <p className="m-0">{en?"Install the MCP server and authorize the account. Delivery to the existing session is checked separately.":"Установи MCP-сервер и разреши доступ аккаунта. Доставка в существующую сессию проверяется отдельно."}</p>
   {pack?<a href={pluginDownload(pack.file)} download className="py-1 text-action-ink">{en?"Download":"Скачать"} {pack.name} · {pluginVersion}</a>:null}
   <Key className="self-start text-cap" onClick={async()=>{try{await navigator.clipboard.writeText(task);setCopied(true);setFailed(false);}catch{setFailed(true);}}}>{copied?(en?"Copied":"Скопировано"):command?(en?"Copy MCP command":"Скопировать команду MCP"):(en?"Copy MCP address":"Скопировать адрес MCP")}</Key>
   {failed?<p role="alert" className="m-0">{en?"Copy the request below:":"Скопируй запрос ниже:"}<br/>{task}</p>:null}
   {canonical==="codex"?<p className="m-0">{en?"Local automatic delivery needs an active Codex host adapter; connecting MCP alone does not wake the session.":"Для локальной автодоставки нужен живой host-адаптер Codex; одного подключения MCP недостаточно для пробуждения сессии."}</p>:null}
   {canonical==="claude"?<p className="m-0">{en?"Automatic delivery requires an enabled channel in Claude Code. Channel approval is separate from installing the plugin.":"Для автодоставки нужен включённый канал Claude Code. Допуск канала проверяется отдельно от установки плагина."}</p>:null}
   <a href={setupUrl} className="py-1 text-action-ink">{en?"Connection and reply test":"Подключение и проверка ответа"} ↗</a>
  </div>
 </details>;
}
