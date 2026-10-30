import {test,expect} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {ParticipantAutoReplies} from "../src/screens/ParticipantAutoReplies.tsx";
import {setLocale} from "../src/strings.ts";

test("исторический участник получает настоящую кнопку в чате, без ссылки на connect или popup",()=>{
 setLocale("ru");
 const html=renderToStaticMarkup(<ParticipantAutoReplies author="claude" sessions={[]} view={{sessions:[],chains:[],auto_requests:[]}} repo="a/b" chatId="20261031-abcd" canPush onChange={()=>{}}/>);
 expect(html).toContain("<button");expect(html).toContain("Включить автоответы");expect(html).not.toContain("href=\"/connect");
});
test("сохранённое включение без клиента честно показывает ожидание плагина",()=>{
 setLocale("en");
 const html=renderToStaticMarkup(<ParticipantAutoReplies author="codex" sessions={[]} view={{sessions:[],chains:[],auto_requests:[{author:"codex",enabled:true}]}} repo="a/b" chatId="20261031-abcd" canPush onChange={()=>{}}/>);
 expect(html).toContain("Waiting for the plugin");expect(html).toContain("Turn off automatic replies");expect(html).not.toContain("Listening for addressed turns");setLocale("ru");
});
