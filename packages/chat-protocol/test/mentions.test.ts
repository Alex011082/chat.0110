import { expect, test } from "bun:test";
import { mentionRoute } from "../src/mentions.ts";

test("@ адресует первый ход, @@ добавляет обсуждение и возврат", () => {
  expect(mentionRoute("@Клод Проверь мобильную версию. Обсуди с @@Кодекс")).toEqual(["клод", "кодекс", "клод"]);
  expect(mentionRoute("@Claude Проверь")).toEqual(["claude"]);
});

test("цитаты, код, email и ссылки не вызывают участников", () => {
  expect(mentionRoute("> @Claude\n```\n@Grok\n```\n`@Codex` user@example.org [@Claude](https://x)")).toEqual([]);
});

test("неоднозначная цепочка отклоняется, а не запускает всех", () => {
  expect(() => mentionRoute("@@Codex")).toThrow();
  expect(() => mentionRoute("@Claude @Grok")).toThrow();
  expect(() => mentionRoute("@Claude @@Claude")).toThrow();
});

import { canonicalMention, resolveMention } from "../src/mention-aliases.ts";
test("русские падежи, английские имена и регистр ведут к одной модели", () => {
  for (const word of ["клод", "Клод", "клоду", "Клоду", "Claude", "CLAUDE"])
    expect(canonicalMention(word)).toBe("claude");
  for (const word of ["Сол", "Соль", "солу", "Sol", "SOL"]) expect(canonicalMention(word)).toBe("sol");
  for (const word of ["Астра", "астре", "Astra"]) expect(canonicalMention(word)).toBe("astra");
  for (const word of ["чатжпт", "ChatGPT", "чатгпт", "GPT"]) expect(canonicalMention(word)).toBe("chatgpt");
});
test("конкретная сессия приоритетна; общая модель не выбирает случайного адресата", () => {
  const sessions = [
    { id: "a", alias: "claude-site", author: "claude", model: "sonnet" },
    { id: "b", alias: "claude-review", author: "claude", model: "opus" },
  ];
  expect(resolveMention("Claude-Site", sessions)).toBe("a");
  expect(resolveMention("Опусу", sessions)).toBe("b");
  expect(() => resolveMention("Клоду", sessions)).toThrow("ambiguous");
  expect(() => resolveMention("Грок", sessions)).toThrow("unknown");
});

test("имена моделей с версией и точка в конце предложения", () => {
  expect(mentionRoute("@GPT-6.1-Sol Проверь и обсуди с @@Клоду.")).toEqual(["gpt-6.1-sol", "клоду", "gpt-6.1-sol"]);
});
test("вложенные fence и продолжение цитаты не становятся поручением", () => {
  expect(mentionRoute("````text\n```js\n@claude quoted example\n```\n````")).toEqual([]);
  expect(mentionRoute("> quoted example:\n@claude do this")).toEqual([]);
  expect(mentionRoute("> quote\n\n@Claude Проверь")).toEqual(["claude"]);
});
test("цитата внутри fence не скрывает настоящее обращение после кода", () => {
  expect(mentionRoute("```text\n> quoted example\n```\n@claude Please review")).toEqual(["claude"]);
});
