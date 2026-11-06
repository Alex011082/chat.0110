import {useId,useState} from "react";
import {setDesign,useDesign} from "../lib/design.ts";
import {s} from "../strings.ts";
import {Sheet} from "../ui/Sheet.tsx";
import {LanguageSwitch} from "../ui/LanguageSwitch.tsx";
import {GearIcon,ArrowRightIcon} from "../ui/icons.tsx";
import {Key} from "../ui/kit.tsx";
import {AppInstallControls} from "../ui/AppFrame.tsx";

export function GlobalSettings({login,onLogout,triggerLabel}:{login:string;onLogout:()=>void;triggerLabel?:string}){
 const [open,setOpen]=useState(false),design=useDesign(),en=s.locale==="en",id=useId();
 return <>
  <button type="button" className="settings-trigger" data-labelled={!!triggerLabel||undefined} aria-label={s.design.settings} title={s.design.settings} onClick={()=>setOpen(true)}><GearIcon/>{triggerLabel}</button>
  <Sheet open={open} onClose={()=>setOpen(false)} labelledBy={id} dismissOnBackdrop className="global-settings-dialog mx-auto mt-[max(16px,12vh)] w-[min(440px,calc(100vw-28px))]">
   <section className="settings-surface">
    <header className="flex items-start justify-between gap-4"><div><h2 id={id} className="m-0 text-section font-semibold">{en?"App settings":"Настройки приложения"}</h2><p className="mb-0 mt-1 text-cap text-ink-2">{en?"For all your chats on this device":"Для всех чатов на этом устройстве"}</p></div><Key onClick={()=>setOpen(false)}>{en?"Close":"Закрыть"}</Key></header>
    <div className="control-row"><span>{en?"Language":"Язык"}</span><LanguageSwitch/></div>
    <div className="flex flex-col gap-3 border-t border-line py-4"><span>{en?"Design":"Дизайн"}</span><div role="radiogroup" aria-label={en?"Design":"Дизайн"} className="settings-choice" onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))return;e.preventDefault();const value=e.key==="Home"?"light":e.key==="End"?"device":design==="light"?"device":"light";setDesign(value);e.currentTarget.querySelector<HTMLButtonElement>(`[data-design-choice="${value}"]`)?.focus();}}>
     {(["light","device"] as const).map(value=><button key={value} data-design-choice={value} type="button" role="radio" tabIndex={design===value?0:-1} aria-checked={design===value} onClick={()=>setDesign(value)}>{value==="light"?(en?"Light":"Светлый"):(en?"Device":"Прибор")}</button>)}
    </div></div>
    <a className="control-row text-ink no-underline" href="/plugins">{s.design.plugins}<ArrowRightIcon/></a>
    <div className="flex flex-col gap-2 border-t border-line pt-3"><AppInstallControls/></div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-cap"><span className="text-ink-2">{login}</span><button type="button" className="min-h-10 border-0 bg-transparent px-2 text-ink-2" onClick={onLogout}>{s.rail.logout}</button></footer>
   </section>
  </Sheet>
 </>;
}
