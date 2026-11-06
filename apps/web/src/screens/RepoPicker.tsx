import {useEffect,useId,useState} from "react";
import type {RepoInfo} from "@chat0110/chat-protocol";
import {findRepositories} from "../lib/repositories.ts";
import {Sheet} from "../ui/Sheet.tsx";
import {CheckIcon,ChevronIcon,CloseIcon,SearchIcon} from "../ui/icons.tsx";
import {s} from "../strings.ts";

const RECENT="chat0110.recent-repositories";
function recentNames():string[]{try{const value:unknown=JSON.parse(localStorage.getItem(RECENT)??"[]");return Array.isArray(value)?value.filter((name):name is string=>typeof name==="string").slice(0,12):[];}catch{return [];}}

export function RepoPicker({repos,value,onChange}:{repos:RepoInfo[]|null;value:string|null;onChange:(name:string)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[recent,setRecent]=useState(recentNames);
 const id=useId(),en=s.locale==="en",current=repos?.find(repo=>repo.full_name.toLowerCase()===value?.toLowerCase());
 useEffect(()=>{
  if(!current)return;
  const next=[current.full_name,...recentNames().filter(name=>name.toLowerCase()!==current.full_name.toLowerCase())].slice(0,12);
  setRecent(next);try{localStorage.setItem(RECENT,JSON.stringify(next));}catch{/* Приватный режим не должен мешать выбору репозитория. */}
 },[current?.full_name]);
 const found=findRepositories(repos??[],query,recent);
 const choose=(repo:RepoInfo)=>{setOpen(false);setQuery("");onChange(repo.full_name);};
 const row=(repo:RepoInfo)=><button type="button" key={repo.full_name} className="repository-row" onClick={()=>choose(repo)} aria-current={repo===current?"true":undefined}><span className="min-w-0"><strong>{repo.name}</strong><span>{repo.owner}{repo.can_push?"":` · ${s.list.repoReadOnly}`}</span></span>{repo===current?<CheckIcon/>:null}</button>;
 return <>
  <button type="button" className="repository-trigger" disabled={!repos?.length} aria-label={`${s.list.repo}: ${current?.full_name??s.loading}`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><span>{current?.full_name??s.loading}</span><ChevronIcon/></button>
  <Sheet open={open} phone onClose={()=>setOpen(false)} labelledBy={id} dismissOnBackdrop>
   <section className="phone-sheet-surface repository-sheet"><header className="phone-sheet-heading"><h2 id={id}>{en?"Choose repository":"Выбрать репозиторий"}</h2><button type="button" className="settings-trigger" aria-label={en?"Close":"Закрыть"} onClick={()=>setOpen(false)}><CloseIcon/></button></header>
    <label className="repository-search"><SearchIcon/><span className="sr-only-text">{en?"Search repositories":"Поиск репозитория"}</span><input type="search" value={query} placeholder={en?"Name or owner":"Название или владелец"} onChange={event=>setQuery(event.target.value)}/></label>
    <div className="repository-results">
     {found.recent.length?<><h3>{en?"Recent":"Недавние"}</h3>{found.recent.map(row)}</>:null}
     <h3>{query?(en?"Search results":"Результаты поиска"):(en?"All repositories":"Все репозитории")}</h3>
     {found.all.length?found.all.map(row):<p role="status">{en?"No repositories found":"Репозитории не найдены"}</p>}
    </div>
   </section>
  </Sheet>
 </>;
}
