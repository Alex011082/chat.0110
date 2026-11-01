import {useEffect,useState} from "react";
import {Body,KeyLink,Mark,Screen} from "../ui/kit.tsx";
import {LanguageSwitch} from "../ui/LanguageSwitch.tsx";
import {s} from "../strings.ts";
import {pluginPackages,pluginDownload,pluginVersion} from "../lib/plugins.ts";

type Artifact={id:string;version:string;url:string;sha256:string;bytes:number};

export function Plugins(){
 const en=s.locale==="en";
 const [artifacts,setArtifacts]=useState<Artifact[]>([]),[failed,setFailed]=useState(false);
 useEffect(()=>{const controller=new AbortController();
  fetch("/downloads/plugins.json",{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error("manifest");
   const data=await response.json();if(!Array.isArray(data.plugins))throw Error("manifest");
   setArtifacts(data.plugins.filter((p:Artifact)=>p.version===pluginVersion&&/^[a-f0-9]{64}$/.test(p.sha256)&&Number.isFinite(p.bytes)&&p.bytes>0));
  }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>controller.abort();
 },[]);
 return <main className="min-h-dvh bg-ground px-4 py-6 text-ink tab:px-8 tab:py-10">
  <div className="mx-auto flex max-w-6xl flex-col gap-8">
   <header className="flex items-center justify-between gap-4"><a href="/" aria-label="CHAT.0110"><Mark cell={3}/></a><LanguageSwitch/></header>
   <div className="max-w-3xl">
    <a href="/" className="inline-flex min-h-10 items-center text-cap text-ink-2">← {en?"Back to chats":"К чатам"}</a>
    <h1 className="m-0 mt-3 text-title font-semibold">{en?"CHAT.0110 plugins":"Плагины CHAT.0110"}</h1>
    <p className="mb-0 mt-4 text-copy text-ink-2">{en?"Connect your existing Codex or Claude Code session. Choose its alias in the chat, then control automatic replies next to its name.":"Подключи свою существующую сессию Codex или Claude Code. Выбери её alias в чате — дальше управляй автоответами рядом с её именем."}</p>
   </div>
   <div className="grid items-stretch gap-6 tab:grid-cols-2">
    {pluginPackages.map(pack=>{
     const artifact=artifacts.find(p=>p.id===pack.id&&p.url===pluginDownload(pack.file));
     return <Body key={pack.id} className="flex min-w-0 flex-col gap-5 p-6 pb-8 tab:p-8 tab:pb-10">
      <div className="flex items-start justify-between gap-3"><h2 className="m-0 text-section font-semibold">{pack.name}</h2><span className="text-cap text-ink-2">v{pluginVersion}</span></div>
      <p className="m-0 text-cap text-action-ink">{en?"Review candidate · not submitted":"Кандидат для ревью · не отправлен"}</p>
      <p className="m-0 text-copy">{pack.id==="codex"?(en?"Remote MCP + setup skill":"Удалённый MCP + навык подключения"):(en?"Local MCP + incoming channel":"Локальный MCP + входящий канал")}</p>
      <p className="m-0 text-cap text-ink-2">{pack.id==="codex"?(en?"OAuth access to permitted GitHub chats. Local automatic wake needs an active Codex host adapter; this package does not install one.":"Доступ по OAuth к разрешённым чатам GitHub. Для локального пробуждения нужен активный host-адаптер Codex; этот пакет его не устанавливает."):(en?"Requires Bun, an existing gh login and a channel approved by Claude Code. Delivery starts only after a real channel acknowledgement.":"Нужны Bun, существующий вход gh и допущенный канал Claude Code. Доставка начинается после настоящего подтверждения канала.")}</p>
      <ol className="m-0 flex flex-col gap-3 pl-5 text-cap">
       <li>{en?"Download and unpack the ZIP. Read README and REVIEW before installing.":"Скачай и распакуй ZIP. Перед установкой прочитай README и REVIEW."}</li>
       <li>{pack.id==="codex"?(en?"Import the plugin in your client's plugin settings and authorize OAuth.":"Импортируй плагин в настройках клиента и разреши доступ OAuth."):(en?"Install the unpacked plugin using Claude Code's plugin controls. Channel approval is a separate step.":"Установи распакованный плагин средствами Claude Code. Допуск канала — отдельный шаг.")}</li>
       <li>{en?"Open Plugin setup next to the participant in your chat. Copy the request to the existing AI session, then enable its exact alias.":"В чате раскрой «Настроить плагин» рядом с участником. Скопируй запрос в существующую сессию ИИ, затем включи её точный alias."}</li>
      </ol>
      <div className="mt-auto flex flex-col items-start gap-3 border-t border-line pt-5">
       {artifact?<><KeyLink href={artifact.url} download>{en?"Download ZIP":"Скачать ZIP"} · {Math.ceil(artifact.bytes/1024)} {en?"KB":"КБ"}</KeyLink><a href={artifact.url+".sha256"} download className="inline-flex min-h-10 items-center text-cap text-ink-2">{en?"Download checksum":"Скачать контрольную сумму"} · SHA-256</a><code className="max-w-full break-all text-scale text-ink-2">{artifact.sha256}</code></>:<p role="status" className="m-0 text-cap text-ink-2">{failed?(en?"Packages could not be loaded. Reload this page.":"Не удалось загрузить пакеты. Обнови страницу."):(en?"Loading package details…":"Загружаем данные пакетов…")}</p>}
      </div>
     </Body>;
    })}
   </div>
   <Screen className="p-5 tab:p-6">
    <h2 className="m-0 text-section font-semibold">{en?"What is inside":"Что внутри"}</h2>
    <p className="mb-0 mt-3 max-w-3xl text-cap text-ink-2">{en?"Manifests, setup skills, access descriptions and a review dossier. Claude Code also includes the bundled MCP server and dependency notices. No model API keys or paid services are required. Both candidates require CHAT.0110 MCP 2.1.0; installing a ZIP does not approve a plugin or channel.":"Манифесты, навыки подключения, описание доступа и досье для проверки. В Claude Code также включены MCP-сервер и сведения о зависимостях. Новые API-ключи моделей и платные сервисы не нужны. Оба кандидата требуют CHAT.0110 MCP 2.1.0; установка ZIP не даёт официального статуса плагину или каналу."}</p>
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-cap"><a className="inline-flex min-h-10 items-center text-action-ink" href="https://github.com/Alex011082/chat.0110">{en?"Source repository":"Исходный код"} ↗</a><a className="inline-flex min-h-10 items-center text-action-ink" href="/connect">{en?"Connect ChatGPT and other AI apps":"Подключить ChatGPT и другие ИИ"} →</a></div>
   </Screen>
  </div>
 </main>;
}
