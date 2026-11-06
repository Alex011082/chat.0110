import {createContext,useContext,useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {getLocale,subscribeLocale} from "../strings.ts";
import {drafts} from "../lib/drafts.ts";
import {installPlatform,useOnline} from "../lib/pwa.ts";
import {Key} from "./kit.tsx";
import {watchViewport} from "../lib/viewport.ts";
const AppActions=createContext<ReactNode>(null);
export function AppInstallControls(){return <>{useContext(AppActions)}</>;}
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
  const stop=watchViewport(window,document.documentElement.style,()=>bar.current?.offsetHeight??0);
  const observer=new ResizeObserver(stop.refresh);if(bar.current)observer.observe(bar.current);
  return()=>{observer.disconnect();stop();};
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
 const controls=<>
   {!installed&&(prompt?<Key onClick={()=>void install()}>{en?"Install app":"Установить приложение"}</Key>:<details className="app-install-help"><summary>{en?"Install app":"Установить приложение"}</summary><p>{platform==="mac"?(en?"In Safari, choose File → Add to Dock, or Share → Add to Dock. CHAT.0110 will open in its own window.":"В Safari выбери «Файл → Добавить в Dock» или «Поделиться → Добавить в Dock». CHAT.0110 будет открываться отдельным окном."):platform==="ios"?(en?"In Safari, tap Share → Add to Home Screen. Enable Open as Web App, then tap Add.":"В Safari нажми «Поделиться → На экран Домой». Включи «Открывать как веб-приложение» и нажми «Добавить»."):(en?"Open your browser menu and choose Install app or Add to Home Screen, if available.":"Открой меню браузера и выбери «Установить приложение» или «На главный экран», если такой пункт доступен.")}</p></details>)}
   {waiting?<Key onClick={update}>{en?"Update app":"Обновить приложение"}</Key>:null}
   {blocked?<p role="status" className="m-0 text-cap text-ink-2">{en?"Finish sending or clear drafts before updating. Your text stays here.":"Перед обновлением заверши отправку или очисти черновики. Текст остаётся здесь."}</p>:null}
   {installError?<p role="status" className="m-0 text-cap text-ink-2">{en?"Use the browser menu to install.":"Для установки используй меню браузера."}</p>:null}
 </>;
 return <AppActions.Provider value={controls}><div className="app-frame"><div ref={bar} className="app-status-bar" data-offline={!online||undefined}>
  <span className="text-cap text-ink-2">{!online?(en?"Offline · sending is unavailable":"Нет сети · отправка недоступна"):"CHAT.0110"}</span>
  <div className="flex flex-wrap items-center gap-2">
   {controls}
  </div>
 </div><div className="app-stage">{children}</div></div></AppActions.Provider>;
}
