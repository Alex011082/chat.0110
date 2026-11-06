import { afterEach, expect, test } from "bun:test";
import type { ChatDetail, Person, TimelineResponse } from "@chat0110/chat-protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { setDesign } from "../src/lib/design.ts";
import { createMockApi } from "../src/mock.ts";
import { ChatView } from "../src/screens/ChatView.tsx";
import { InfoColumn } from "../src/screens/InfoColumn.tsx";
import { alreadyInChat, PeopleSearch, searchable } from "../src/screens/Invite.tsx";
import { setLocale } from "../src/strings.ts";

// «+» у кружков участников (макеты владельца 03.11.2026): агента зовут одним
// касанием — ссылкой в буфере, человека — поиском среди вошедших в chat.0110.
afterEach(() => setDesign("device"));

const demo = () => createMockApi("1").timeline("Alex011082/chat.0110", "20261023-k7q2");

function view(data: TimelineResponse, opts: { light: boolean; phone: boolean }): string {
  return renderToStaticMarkup(
    <ChatView
      data={data}
      sync={{ syncedAt: Date.now(), error: null }}
      local={[]}
      me={{ login: "alex011082", display: "alex011082" }}
      now={Date.now()}
      phone={opts.phone}
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
      light={opts.light}
      onToast={() => {}}
    />,
  );
}

const header = (html: string) => html.slice(0, html.indexOf("</header>"));

test("светлая шапка на компьютере: «+» стоит между кружками участников и «⋯»", async () => {
  setLocale("ru");
  setDesign("light");
  const h = header(view(await demo(), { light: true, phone: false }));
  const people = h.indexOf('aria-label="Открыть участника: alex011082 — Участник"');
  const plus = h.indexOf('aria-label="Пригласить в чат"');
  const more = h.indexOf('aria-label="Ещё"');
  expect(people).toBeGreaterThan(-1);
  expect(plus).toBeGreaterThan(people);
  expect(more).toBeGreaterThan(plus);
  // Выбор закрыт, пока «+» не нажали.
  expect(h).not.toContain("Ссылка скопируется сразу");
});

test("телефон в светлом: отдельные участники и приглашение со стрелкой к списку", async () => {
  setLocale("ru");
  setDesign("light");
  const html = view(await demo(), { light: true, phone: true });
  const h = header(html);
  expect(h).toContain('aria-label="Список чатов"');
  expect(h).toContain('aria-label="Пригласить в чат"');
  expect(h).toContain('aria-haspopup="dialog"');
  expect(h).toContain('aria-label="Открыть участника: alex011082 — Участник"');
  expect(h).not.toContain("lang-switch");
});

test("«прибор» сохраняет старую шапку на компьютере; телефон получает общие кружки и приглашение", async () => {
  setLocale("ru");
  for (const phone of [false, true]) {
    const html = view(await demo(), { light: false, phone });
    if(phone)expect(html).toContain('aria-label="Пригласить в чат"');
    else expect(html).not.toContain('aria-label="Пригласить в чат"');
  }
});

test("блок «Ссылка для агента» в сведениях о чате — только у «прибора»", async () => {
  setLocale("ru");
  const data = await demo();
  const info = (agentLink?: boolean) =>
    renderToStaticMarkup(
      <InfoColumn
        chat={data.chat}
        items={data.items}
        now={Date.now()}
        forks={data.forks}
        inherited={data.inherited}
        parentTitle={null}
        decisions={[]}
        outgoing={[]}
        onJump={() => {}}
        onPropose={null}
        {...(agentLink === undefined ? {} : { agentLink })}
      />,
    );
  expect(info()).toContain("Ссылка для агента");
  expect(info(false)).not.toContain("Ссылка для агента");
  expect(info(false)).toContain("Участники");
});

test("искать можно от двух знаков; «@» в начале не в счёт", () => {
  expect(searchable("")).toBeNull();
  expect(searchable(" с ")).toBeNull();
  expect(searchable("@p")).toBeNull();
  expect(searchable("@petr")).toBe("petr");
  expect(searchable(" сер ")).toBe("сер");
});

function chatWith(base: ChatDetail, humans: string[]): ChatDetail {
  return {
    ...base,
    participants: [
      ...base.participants,
      ...humans.map((author) => ({ author, display: author, is_agent: false, last_at: "2026-11-03T10:00:00Z", count: 1 })),
      { author: "sivanov-bot", display: "bot", is_agent: true, last_at: "2026-11-03T10:00:00Z", count: 1 },
    ],
  };
}

test("«уже в чате» — только тот, кто писал сюда человеком; регистр логина не важен", async () => {
  const chat = chatWith((await demo()).chat, ["seraphima"]);
  expect(alreadyInChat(chat, "Seraphima")).toBe(true);
  expect(alreadyInChat(chat, "sivanov")).toBe(false);
  expect(alreadyInChat(chat, "sivanov-bot")).toBe(false);
});

const found: Person[] = [
  { login: "sivanov", name: "Сергей Иванов", avatar_url: "" },
  { login: "seraphima", name: "Серафима Лев", avatar_url: "https://avatars.githubusercontent.com/u/13" },
];

const search = (chat: ChatDetail, initial: string, initialResults: Person[] | null, phone = false) =>
  renderToStaticMarkup(
    <PeopleSearch chat={chat} phone={phone} onClose={() => {}} onBack={phone ? () => {} : null} initial={initial} initialResults={initialResults} />,
  );

test("поиск человека: найденные с кнопкой «Пригласить», кто уже в чате — без кнопки", async () => {
  setLocale("ru");
  const html = search(chatWith((await demo()).chat, ["seraphima"]), "сер", found);
  expect(html).toContain("Вошли в chat.0110");
  expect(html).toContain('aria-label="Пригласить: Сергей Иванов"');
  expect(html).not.toContain('aria-label="Пригласить: Серафима Лев"');
  expect(html).toContain("уже в чате");
  expect(html).toContain("@sivanov");
  expect(html).toContain('src="https://avatars.githubusercontent.com/u/13"');
  expect(html).toContain("доступ к чату — это доступ к репозиторию");
});

test("никого не нашли: объясняем, почему, и даём ссылку на вход в chat.0110", async () => {
  setLocale("ru");
  const html = search((await demo()).chat, "petrov", []);
  expect(html).toContain("Никого не нашли");
  expect(html).toContain("@petrov ещё не входил в chat.0110");
  expect(html).toContain("Скопировать ссылку на chat.0110");
  expect(html).not.toContain("Пригласить:");
});

test("пустая строка поиска — подсказка, а не «никого не нашли»; на телефоне есть «Назад»", async () => {
  setLocale("ru");
  const html = search((await demo()).chat, "", null, true);
  expect(html).toContain("Начни вводить логин GitHub или имя");
  expect(html).not.toContain("Никого не нашли");
  expect(html).toContain('aria-label="Назад"');
});

test("пробный режим: поиск по имени кириллицей, приглашение только вошедшего", async () => {
  const api = createMockApi("1");
  expect((await api.people("сер")).map((p) => p.login)).toEqual(["sivanov", "serg-kim", "seraphima"]);
  expect(await api.people("с")).toEqual([]);
  expect(await api.invite("Alex011082/chat.0110", "20261023-k7q2", "sivanov")).toEqual({ login: "sivanov", status: "invited" });
  await expect(api.invite("Alex011082/chat.0110", "20261023-k7q2", "petrov")).rejects.toMatchObject({ status: 404 });
});
