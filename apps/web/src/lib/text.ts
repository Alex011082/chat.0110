import { s, type Forms } from "../strings.ts";

// У агентов нет цветов — только подписи. Знак на ручке-аватаре для известных
// агентов задан явно, чтобы Codex и Claude не слились в одинаковое «C…».
const AGENT_MARKS: Record<string, string> = {
  claude: "Cl",
  codex: "Cx",
  chatgpt: "GP",
  gemini: "Ge",
  grok: "Gr",
};

const WORD_RE = /[\p{L}\p{N}]+/gu;

export function initials(author: string, display: string): string {
  const mark = AGENT_MARKS[author];
  if (mark) return mark;
  const all = display.match(WORD_RE) ?? author.match(WORD_RE) ?? [];
  // Хвосты из цифр («alex-011082») не делают второе слово: «Al», а не «A0».
  const lettered = all.filter((w) => /\p{L}/u.test(w));
  const words = lettered.length ? lettered : all;
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  if (second) return (first[0]! + second[0]!).toUpperCase();
  const chars = Array.from(first);
  return chars[0]!.toUpperCase() + (chars[1] ?? "").toLowerCase();
}

/** Простой текст из Markdown: для цитат и подсказок, не для показа сообщения. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Начало сообщения: до max знаков по границе слова и «…». */
export function excerpt(markdown: string, max = 40): string {
  const text = plainText(markdown);
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  if (space >= max / 2) cut = cut.slice(0, space);
  return cut.replace(/[\s,.;:—–-]+$/u, "") + "…";
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** «1 сообщение», «3 участника», «5 файлов». */
export function plural(n: number, forms: Forms, locale: string = s.locale): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const cat = rules.select(n);
  const word = cat === "one" ? forms[0] : cat === "few" ? forms[1] : forms[2];
  return `${n} ${word}`;
}

export function sha7(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}
