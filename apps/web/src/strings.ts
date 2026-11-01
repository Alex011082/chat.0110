import { s as ru, forms as ruForms } from "./locales/ru.ts";
import { s as en, forms as enForms } from "./locales/en.ts";
export type { Forms } from "./locales/ru.ts";
type Widen<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => R
  : T extends string
    ? string
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;
export type Dictionary = Widen<typeof ru>;
export type Locale = "ru" | "en";
export function chooseLocale(saved: string | null, browser: string): Locale {
  return saved === "en" || saved === "ru" ? saved : browser.toLowerCase().startsWith("ru") ? "ru" : "en";
}
function initialLocale(): Locale {
  if (typeof document === "undefined") return "ru";
  try {
    return chooseLocale(localStorage.getItem("chat0110.locale"), navigator.language);
  } catch {
    return chooseLocale(null, navigator.language);
  }
}
let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const subscribeLocale = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function setLocale(next: Locale) {
  locale = next;
  try {
    localStorage.setItem("chat0110.locale", next);
  } catch {
    /* Приватный режим может запрещать storage. */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
    document.querySelector('meta[name="description"]')?.setAttribute("content", `chat.0110 — ${s.login.title}`);
  }
  for (const fn of listeners) fn();
}
// Стабильный объект сохраняет совместимость утилит; React подписан на locale в App.
export const s: Dictionary = new Proxy(ru, { get: (_, key) => Reflect.get(locale === "en" ? en : ru, key) });
export const forms: { [K in keyof typeof ruForms]: readonly [string, string, string] } = new Proxy(ruForms, {
  get: (_, key) => Reflect.get(locale === "en" ? enForms : ruForms, key),
});
