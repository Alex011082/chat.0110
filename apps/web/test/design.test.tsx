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

// --- Шапка и лента светлого на демо-данных -------------------------------------

import type { MessageItem, TimelineResponse } from "@chat0110/chat-protocol";
import { createMockApi } from "../src/mock.ts";
import { ChatView } from "../src/screens/ChatView.tsx";

async function demoChat(): Promise<TimelineResponse> {
  const data = await createMockApi("1").timeline("Alex011082/chat.0110", "20261023-k7q2");
  // Один ответ агента делаем длинным: такие в светлом приходят свёрнутыми.
  const items = data.items.map((it) => it);
  const i = items.findIndex((it) => it.kind === "message" && (it as MessageItem).author === "codex");
  items[i] = { ...(items[i] as MessageItem), text: "Длинный расчёт. ".repeat(60) };
  return { ...data, items };
}

function view(data: TimelineResponse, light: boolean): string {
  return renderToStaticMarkup(
    <ChatView
      data={data}
      sync={{ syncedAt: Date.now(), error: null }}
      local={[]}
      me={{ login: "alex011082", display: "alex011082" }}
      now={Date.now()}
      phone={false}
      infoKnob={false}
      infoOpen={false}
      onInfo={() => {}}
      onBack={() => {}}
      path="/Alex011082/chat.0110/20261023-k7q2"
      reply={null}
      focusTick={0}
      onReply={() => {}}
      onClearReply={() => {}}
      onSend={() => {}}
      onRetry={() => {}}
      onAccept={async () => {}}
      parentTitle={null}
      onFork={() => {}}
      onDecide={() => {}}
      onDecision={async () => {}}
      onPropose={null}
      light={light}
    />,
  );
}

test("шапка светлого: каждый участник — отдельная кнопка, сведения о чате отделены", async () => {
  setLocale("ru");
  setDesign("light");
  const html = view(await demoChat(), true);
  const header = html.slice(0, html.indexOf("</header>"));
  expect(header).toContain('aria-label="Открыть участника: Claude —');
  expect(header).toContain('aria-label="Открыть участника: Codex —');
  expect(header).not.toContain('-ml-2');
  expect(header).toContain('>О чате</button>');
  expect(header).toContain('aria-label="Ещё"');
  expect(header).toContain("PR #3 · на связи");
  expect(html).not.toContain("Открыть в GitHub");
  expect(header).not.toContain(">Fork</button>");
});

test("лента светлого: действия помечены для показа при наведении, длинный ответ агента свёрнут", async () => {
  setLocale("ru");
  setDesign("light");
  const html = view(await demoChat(), true);
  expect(html).toContain('class="msg-actions');
  expect(html).toContain('class="msg-clamp"');
  expect(html).toContain("Показать полностью");
  // Подробности строки — во всплывающей подсказке времени, а не текстом.
  expect(html).toMatch(/title="агент · [^"]*"/);
});

test("«прибор» на тех же данных — как был: крупная шапка, ничего не свёрнуто", async () => {
  setLocale("ru");
  setDesign("device");
  const html = view(await demoChat(), false);
  expect(html).toContain("Открыть в GitHub");
  expect(html).not.toContain('class="msg-clamp"');
  expect(html).not.toContain("Показать полностью");
});
