import {expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {Composer} from "../src/screens/Composer.tsx";
import {agentConnectionLabel} from "../src/lib/auto-replies.ts";
import {watchViewport} from "../src/lib/viewport.ts";
import {findRepositories} from "../src/lib/repositories.ts";
import {setLocale} from "../src/strings.ts";
import {TaskHistory} from "../src/screens/TaskHistory.tsx";

test("клавиатура Safari: scroll видимой области меняет положение кадра, закрытие возвращает высоту",()=>{
 const host=Object.assign(new EventTarget(),{innerHeight:844,visualViewport:Object.assign(new EventTarget(),{height:510,offsetTop:86,scale:1})});
 const values=new Map<string,string>(),style={setProperty:(k:string,v:string)=>values.set(k,v),removeProperty:(k:string)=>values.delete(k)};
 const stop=watchViewport(host as unknown as Window,style as unknown as CSSStyleDeclaration,()=>0);
 expect(values.get("--app-height")).toBe("510px");expect(values.get("--app-top")).toBe("86px");
 host.visualViewport.offsetTop=120;host.visualViewport.dispatchEvent(new Event("scroll"));expect(values.get("--app-top")).toBe("120px");
 host.visualViewport.height=844;host.visualViewport.offsetTop=0;host.visualViewport.dispatchEvent(new Event("resize"));
 expect(values.get("--stage-height")).toBe("844px");expect(values.get("--app-top")).toBe("0px");
 host.visualViewport.scale=2;host.visualViewport.height=422;host.visualViewport.dispatchEvent(new Event("resize"));expect(values.get("--app-height")).toBe("844px");
 stop();host.visualViewport.scale=1;host.visualViewport.height=300;host.visualViewport.dispatchEvent(new Event("resize"));expect(values.has("--app-height")).toBe(false);
});

test("мобильное поле сохраняет ввод и кнопку, редкие действия не занимают место постоянно",()=>{
 setLocale("ru");
 const html=renderToStaticMarkup(<Composer chatKey="a/b/20261106-abcd" branch="chat/20261106-abcd" canPush reply={null} onClearReply={()=>{}} onSend={()=>{}} phone focusTick={0}/>);
 expect(html).toContain("<textarea");expect(html).toContain('aria-label="Отправить"');
 expect(html).not.toContain("Подключить ИИ");expect(html).not.toContain("Защита данных · включена");
 expect(html).toContain('id="mention-help" class="sr-only-text"');
});

test("готовность участника названа кратко и не выводится из online",()=>{
 const view={sessions:[],chains:[]},session={id:"a",alias:"claude",author:"claude",model:"",name:"Claude",online:true,auto_enabled:true,delivery_ready:false};
 expect(agentConnectionLabel(session,view,false)).toBe("Нужно подключить");
 expect(agentConnectionLabel({...session,delivery_ready:true,online:false},view,false)).toBe("Получает обращения");
 expect(agentConnectionLabel({...session,auto_enabled:false},view,false)).toBe("Приостановлен");
 expect(agentConnectionLabel(session,view,true)).toBe("Needs connection");
});

test("поиск репозиториев учитывает владельца и имя, недавние чужие записи не раскрываются",()=>{
 const repos=[{full_name:"Owner/Website",owner:"Owner",name:"Website",can_push:true,private:true,default_branch:"main",installation_id:1},{full_name:"Team/API",owner:"Team",name:"API",can_push:false,private:false,default_branch:"main",installation_id:2}];
 expect(findRepositories(repos,"web",["foreign/private","Team/API"]).all.map(r=>r.full_name)).toEqual(["Owner/Website"]);
 expect(findRepositories(repos,"",["foreign/private","Team/API","Team/API"]).recent.map(r=>r.full_name)).toEqual(["Team/API"]);
 expect(findRepositories(repos,"TEAM",[]).all.map(r=>r.full_name)).toEqual(["Team/API"]);
});

test("на телефоне можно остановить каждую активную цепочку, а не только последнюю",()=>{
 setLocale("ru");
 const session={id:"a",alias:"codex",author:"codex",model:"",name:"Codex",online:true};
 const view={sessions:[session],chains:[
  {id:"new",message_id:"m2",route:["a"],step:0,status:"waiting" as const},
  {id:"old",message_id:"m1",route:["a"],step:0,status:"running" as const},
  {id:"ended",message_id:"m0",route:["a"],step:0,status:"expired" as const},
 ]};
 const html=renderToStaticMarkup(<TaskHistory view={view} canStop onStop={()=>{}}/>);
 expect(html.match(/>Остановить<\/button>/g)?.length).toBe(2);
 expect(html).toContain('data-chain="new"');expect(html).toContain('data-chain="old"');
 const readOnly=renderToStaticMarkup(<TaskHistory view={view} canStop={false} onStop={()=>{}}/>);
 expect(readOnly).not.toContain(">Остановить</button>");
});
