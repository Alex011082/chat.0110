import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {getLocale,subscribeLocale} from "../strings.ts";
import {drafts} from "../lib/drafts.ts";
import {installPlatform,useOnline} from "../lib/pwa.ts";
import {Key} from "./kit.tsx";
interface InstallEvent extends Event {prompt():Promise<unknown>;userChoice:Promise<{outcome:string}>}
export function AppFrame({children}:{children:ReactNode}){
 const en=useSyncExternalStore(subscribeLocale,getLocale,getLocale)==="en";
 const online=useOnline();const bar=useRef<HTMLDivElement>(null);
 const [prompt,setPrompt]=useState<InstallEvent|null>(null),[installed,setInstalled]=useState(()=>matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
 const [waiting,setWaiting]=useState<ServiceWorker|null>(null),[blocked,setBlocked]=useState(false),[installError,setInstallError]=useState(false);
 const reloading=useRef(false);
 const platform=installPlatform(navigator.userAgent,navigator.maxTouchPoints);
 useEffect(()=>{
  const before=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent);};
  const done=()=>{setInstalled(true);setPrompt(null);};
  window.addEventListener("beforeinstallprompt",before);window.addEventListener("appinstalled",done);
  return()=>{window.removeEventListener("beforeinstallprompt",before);window.removeEventListener("appinstalled",done);};
 },[]);
 useEffect(()=>{
  const resize=()=>{const height=window.visualViewport?.height??window.innerHeight;document.documentElement.style.setProperty("--app-height",`${height}px`);document.documentElement.style.setProperty("--stage-height",`${Math.max(100,height-(bar.current?.offsetHeight??0))}px`);};
  const observer=new ResizeObserver(resize);if(bar.current)observer.observe(bar.current);resize();window.addEventListener("resize",resize);window.visualViewport?.addEventListener("resize",resize);
  return()=>{observer.disconnect();window.removeEventListener("resize",resize);window.visualViewport?.removeEventListener("resize",resize);};
 },[]);
 useEffect(()=>{
  if(!import.meta.env.PROD||!("serviceWorker" in navigator))return;
  let alive=true;
  const changed=()=>{if(!reloading.current)return;if(drafts.canUpdate())location.reload();else{reloading.current=false;setBlocked(true);}};
  navigator.serviceWorker.addEventListener("controllerchange",changed);
  void navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).then(reg=>{
   if(!alive)return;if(reg.waiting)setWaiting(reg.waiting);
   reg.addEventListener("updatefound",()=>{const worker=reg.installing;worker?.addEventListener("statechange",()=>{if(alive&&worker.state==="installed"&&navigator.serviceWorker.controller)setWaiting(reg.waiting);});});
  }).catch(()=>{/* Установка остаётся возможной без offline-функции; не выдаём ошибку за успех. */});
  return()=>{alive=false;navigator.serviceWorker.removeEventListener("controllerchange",changed);};
 },[]);
 const update=()=>{if(!drafts.canUpdate()){setBlocked(true);return;}setBlocked(false);if(waiting?.state==="activated"){location.reload();return;}reloading.current=true;waiting?.postMessage({type:"ACTIVATE_UPDATE"});};
 const install=async()=>{try{const event=prompt;setPrompt(null);await event?.prompt();await event?.userChoice;}catch{setInstallError(true);}};
 return <div className="app-frame"><div ref={bar} className="app-status-bar">
  <span className="text-cap text-ink-2">{!online?(en?"Offline · sending is unavailable":"Нет сети · отправка недоступна"):"CHAT.0110"}</span>
  <div className="flex flex-wrap items-center gap-2">
   {!installed&&(prompt?<Key onClick={()=>void install()}>{en?"Install app":"Установить приложение"}</Key>:<details className="app-install-help"><summary>{en?"Install app":"Установить приложение"}</summary><p>{platform==="mac"?(en?"In Safari, choose File → Add to Dock, or Share → Add to Dock. CHAT.0110 will open in its own window.":"В Safari выбери «Файл → Добавить в Dock» или «Поделиться → Добавить в Dock». CHAT.0110 будет открываться отдельным окном."):platform==="ios"?(en?"In Safari, tap Share → Add to Home Screen. Enable Open as Web App, then tap Add.":"В Safari нажми «Поделиться → На экран Домой». Включи «Открывать как веб-приложение» и нажми «Добавить»."):(en?"Open your browser menu and choose Install app or Add to Home Screen, if available.":"Открой меню браузера и выбери «Установить приложение» или «На главный экран», если такой пункт доступен.")}</p></details>)}
   {waiting?<Key onClick={update}>{en?"Update app":"Обновить приложение"}</Key>:null}
  </div>
  {blocked?<p role="status" className="m-0 w-full text-cap text-ink-2">{en?"Finish sending or clear drafts and replies before updating. Your text remains in this window.":"Перед обновлением заверши отправку или очисти черновики и ответы. Текст остаётся в этом окне."}</p>:null}
  {installError?<p role="status" className="m-0 w-full text-cap text-ink-2">{en?"The browser did not confirm installation. Use its menu.":"Браузер не подтвердил установку. Используй его меню."}</p>:null}
 </div><div className="app-stage">{children}</div></div>;
}
