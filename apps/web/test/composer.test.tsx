import {test,expect} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {Composer} from "../src/screens/Composer.tsx";
import {setLocale} from "../src/strings.ts";

// У заказчика на Windows (низкое окно браузера) блок ввода в три строки
// вместе с шапкой съедал всю высоту, и лента чата сжималась в полоску.
// Поле на компьютере должно начинаться с одной строки и расти не выше
// доли окна.
test("поле ввода на компьютере в одну строку и с потолком по высоте окна",()=>{
 setLocale("ru");
 const html=renderToStaticMarkup(<Composer chatKey="a/b/20261101-abcd" branch="chat/20261101-abcd" canPush reply={null} onClearReply={()=>{}} onSend={()=>{}} phone={false} focusTick={0}/>);
 const area=html.match(/<textarea[^>]*>/)?.[0]??"";
 expect(area).toContain('rows="1"');
 expect(area).toContain("max-h-[min(160px,20svh)]");
 expect(html).toContain("Отправить");
});
