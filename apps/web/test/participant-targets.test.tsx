import {expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {participantTargets} from "../src/lib/participant-targets.ts";
import {ParticipantAutoReplies} from "../src/screens/ParticipantAutoReplies.tsx";
import {setLocale} from "../src/strings.ts";

test("две сессии Claude получают независимые цели; исторический участник сохраняется",()=>{
 const people=[{author:"claude",display:"Claude",is_agent:true,count:3,last_at:""},{author:"grok",display:"Grok",is_agent:true,count:1,last_at:""}];
 const sessions=[{id:"one",author:"claude",alias:"claude-site",name:"Сайт",model:"sonnet",online:true},{id:"two",author:"claude",alias:"claude-api",name:"API",model:"opus",online:false}];
 const targets=participantTargets(people,sessions);
 expect(targets.map(t=>t.id)).toEqual(["one","two","history:grok"]);
 expect(targets[0]!.session?.alias).toBe("claude-site");expect(targets[1]!.session?.alias).toBe("claude-api");
});
test("переключатель показывает сохранённое включение, а статус отдельно говорит о недоступном приёмнике",()=>{
 setLocale("ru");
 const session={id:"one",author:"claude",alias:"claude-site",name:"Сайт",model:"sonnet",online:true,auto_enabled:true,delivery_ready:false};
 const html=renderToStaticMarkup(<ParticipantAutoReplies author="claude" sessions={[session]} view={{sessions:[session],chains:[]}} repo="a/b" chatId="20261103-abcd" canPush compact onChange={()=>{}}/>);
 expect(html).toContain('role="switch" aria-checked="true"');
 expect(html).toContain("Нужно подключить");
 expect(html).not.toContain("Выключить автоответы");
 expect(html).toContain("Настроить подключение");
});
