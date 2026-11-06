import {test,expect} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {ParticipantAutoReplies} from "../src/screens/ParticipantAutoReplies.tsx";
import {setLocale} from "../src/strings.ts";
import {agentConnectionLabel} from "../src/lib/auto-replies.ts";
import {ConnectAgents} from "../src/screens/ConnectAgents.tsx";

test("исторический участник получает настоящую кнопку в чате, без ссылки на connect или popup",()=>{
 setLocale("ru");
 const html=renderToStaticMarkup(<ParticipantAutoReplies author="claude" sessions={[]} view={{sessions:[],chains:[],auto_requests:[]}} repo="a/b" chatId="20261031-abcd" canPush onChange={()=>{}}/>);
 expect(html).toContain("<button");expect(html).toContain("Включить автоответы");expect(html).not.toMatch(/<a[^>]*>Включить автоответы<\/a>/);
 expect(html).toContain("Настроить подключение");
});
test("готовность приёмника важнее недавней активности и относится к конкретному чату",()=>{
 const view={sessions:[],chains:[]},session={id:"one",author:"claude",name:"Claude Code",alias:"claude-one",auto_enabled:true,online:true,delivery_ready:false} as any;
 expect(agentConnectionLabel(session,view,false)).toBe("Нужно подключить");
 expect(agentConnectionLabel({...session,online:false,delivery_ready:true},view,false)).toBe("Получает обращения");
});
test("мастер показывает общий удалённый адрес без команды локальной установки",()=>{
 setLocale("ru");
 const html=renderToStaticMarkup(<ConnectAgents embedded chatContext={{repo:"owner/product",chat_id:"20261103-abcd"}} initialClient="claude-code"/>);
 expect(html).toContain("owner/product");expect(html).toContain("20261103-abcd");
 expect(html).toContain("https://chat.0110.digital/mcp");
 expect(html).not.toContain("chat0110 setup --client");
 expect(html).toContain("Установка на компьютер не нужна");
 expect(html).toContain("Скопировать запрос для этой сессии");
 expect(html).not.toContain("Скачать Claude Code");
});
test("сохранённое включение без клиента честно показывает ожидание плагина",()=>{
 setLocale("en");
 const html=renderToStaticMarkup(<ParticipantAutoReplies author="codex" sessions={[]} view={{sessions:[],chains:[],auto_requests:[{author:"codex",enabled:true}]}} repo="a/b" chatId="20261031-abcd" canPush onChange={()=>{}}/>);
 expect(html).toContain("Waiting for the plugin");expect(html).toContain("Turn off automatic replies");expect(html).not.toContain("Listening for addressed turns");setLocale("ru");
});
