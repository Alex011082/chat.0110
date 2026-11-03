import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getDesign, parseDesign, setDesign } from "../src/lib/design.ts";
import { Composer } from "../src/screens/Composer.tsx";
import { LightSidebar } from "../src/screens/LightSidebar.tsx";
import { setLocale } from "../src/strings.ts";

// Светлый дизайн (макет владельца 03.11.2026) живёт рядом с «прибором»:
// старый остаётся по умолчанию, пока владелец не решит иначе.
afterEach(() => setDesign("device"));

test("по умолчанию — «прибор»; светлый включается только явным выбором", () => {
  expect(parseDesign(null)).toBe("device");
  expect(parseDesign("dark")).toBe("device");
  expect(parseDesign("light")).toBe("light");
  setDesign("light");
  expect(getDesign()).toBe("light");
  setDesign("device");
  expect(getDesign()).toBe("device");
});

const composer = (light: boolean) =>
  renderToStaticMarkup(
    <Composer
      chatKey="a/b/20261103-abcd"
      branch="chat/20261103-abcd"
      canPush
      reply={null}
      onClearReply={() => {}}
      onSend={() => {}}
      phone={false}
      focusTick={0}
      light={light}
    />,
  );

test("поле ввода светлого: подсказка про @ — в самом поле, ветка — во всплывающей подсказке", () => {
  setLocale("ru");
  const html = composer(true);
  const area = html.match(/<textarea[^>]*>/)?.[0] ?? "";
  expect(area).toContain("@ — кому, @@ — обсудить и вернуть итог");
  expect(area).toContain('title="станет файлом-коммитом в chat/20261103-abcd"');
  // Строка про коммит в ветку больше не стоит под полем текстом…
  expect(html.replace(area, "")).not.toContain("станет файлом-коммитом");
  // …а подсказка для чтеца экрана на месте: на неё ссылается поле.
  expect(html).toMatch(/id="mention-help" class="sr-only-text"/);
  expect(html).toContain("Отправить");
});

test("«прибор» не изменился: прежние подсказки под полем", () => {
  setLocale("ru");
  const html = composer(false);
  expect(html).toContain("станет файлом-коммитом в chat/20261103-abcd");
  expect(html).toContain("Сообщение в чат…");
});

test("боковая колонка светлого: новый чат и дерево — значками, остальное — в настройках", () => {
  setLocale("ru");
  const html = renderToStaticMarkup(
    <LightSidebar login="alex011082" view="chats" onChats={() => {}} onTree={() => {}} onNew={() => {}} canCreate={false} onLogout={() => {}}>
      <div>список</div>
    </LightSidebar>,
  );
  expect(html).toMatch(/aria-label="Новый чат"[^>]*disabled=""/);
  expect(html).toContain('aria-label="Дерево разговоров"');
  expect(html).toContain('aria-label="Настройки"');
  // Язык, плагины, дизайн и выход не висят на экране — они в закрытом меню.
  expect(html).not.toContain("Выйти");
  expect(html).not.toContain("Плагины ИИ");
});
