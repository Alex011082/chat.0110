/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { excerpt, initials, plural, sha7 } from "../src/lib/text.ts";
import { forms } from "../src/strings.ts";

describe("initials — буквы на ручке-аватаре", () => {
  test("одно слово — две первые буквы", () => {
    expect(initials("sasha", "Саша")).toBe("Са");
    expect(initials("claude", "Claude")).toBe("Cl");
    expect(initials("alex011082", "alex011082")).toBe("Al");
  });
  test("известные агенты — их знаки", () => {
    expect(initials("codex", "Codex")).toBe("Cx");
    expect(initials("chatgpt", "ChatGPT")).toBe("GP");
  });
  test("два слова — первые буквы слов", () => {
    expect(initials("ad", "Alexander Davidov")).toBe("AD");
  });
  test("знаки препинания пропускаются, пустое — «?»", () => {
    expect(initials("x", "_bot-42")).toBe("Bo");
    expect(initials("", "")).toBe("?");
  });
});

describe("excerpt — начало сообщения для цитаты", () => {
  test("короткое — без многоточия", () => {
    expect(excerpt("Привет")).toBe("Привет");
  });
  test("длинное — 40 знаков по границе слова и «…»", () => {
    expect(excerpt("Обсуждаем передачу коробок между гусеничными платформами. Нужны варианты захвата.")).toBe(
      "Обсуждаем передачу коробок между…",
    );
  });
  test("одно длинное слово режется ровно", () => {
    expect(excerpt("а".repeat(50), 10)).toBe("а".repeat(10) + "…");
  });
  test("разметка Markdown и переносы не попадают в цитату", () => {
    expect(excerpt("## Заголовок\n\n**жирный** `код` [ссылка](https://x.y)")).toBe("Заголовок жирный код ссылка");
  });
});

describe("plural — русские формы", () => {
  test("один, несколько, много", () => {
    expect(plural(1, forms.messages)).toBe("1 сообщение");
    expect(plural(2, forms.messages)).toBe("2 сообщения");
    expect(plural(5, forms.messages)).toBe("5 сообщений");
    expect(plural(11, forms.messages)).toBe("11 сообщений");
    expect(plural(21, forms.messages)).toBe("21 сообщение");
    expect(plural(0, forms.messages)).toBe("0 сообщений");
    expect(plural(3, forms.participants)).toBe("3 участника");
  });
});

describe("sha7", () => {
  test("короткий sha", () => {
    expect(sha7("4e1c07b9d2a1f0")).toBe("4e1c07b");
    expect(sha7(undefined)).toBe("");
  });
});
