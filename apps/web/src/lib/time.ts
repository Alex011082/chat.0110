import { s } from "../strings.ts";

// Время в интерфейсе: относительное («2 мин назад») и календарное (разделители
// дней). Часовой пояс — параметр: в браузере он местный, в тестах — фиксированный.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const FRESH_MS = 15 * MINUTE;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, tz?: string, locale: string = s.locale): Intl.DateTimeFormat {
  const key = `${locale}|${tz ?? ""}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, tz ? { ...opts, timeZone: tz } : opts);
    fmtCache.set(key, f);
  }
  return f;
}

function ms(iso: string): number {
  return Date.parse(iso);
}

/** Лампа «живо»: событие было не раньше 15 минут назад. */
export function isFresh(iso: string, now: number, windowMs: number = FRESH_MS): boolean {
  const t = ms(iso);
  return Number.isFinite(t) && now - t <= windowMs;
}

/** Календарный день в поясе человека: «2026-10-23». */
export function dayKey(iso: string | number, tz?: string): string {
  return fmt({ year: "numeric", month: "2-digit", day: "2-digit" }, tz, "en-CA").format(new Date(iso));
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

function keyDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** «10:03» — 24 часа. */
export function clock(iso: string, tz?: string): string {
  return fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, tz).format(new Date(iso));
}

/** «23 окт., 10:02». */
export function dateTimeShort(iso: string, tz?: string): string {
  return `${shortDate(iso, Date.parse(iso), tz)}, ${clock(iso, tz)}`;
}

function shortDate(iso: string, now: number, tz?: string): string {
  const sameYear = dayKey(iso, tz).slice(0, 4) === dayKey(now, tz).slice(0, 4);
  return fmt(sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }, tz).format(
    new Date(iso),
  );
}

type Relative = { kind: "now" } | { kind: "min"; n: number } | { kind: "hours"; n: number } | { kind: "yesterday" } | { kind: "date"; text: string };

function relative(iso: string, now: number, tz?: string): Relative {
  const t = ms(iso);
  if (!Number.isFinite(t)) return { kind: "date", text: "" };
  const diff = now - t;
  if (diff < MINUTE) return { kind: "now" };
  if (diff < HOUR) return { kind: "min", n: Math.floor(diff / MINUTE) };
  const today = dayKey(now, tz);
  const day = dayKey(t, tz);
  if (day === today) return { kind: "hours", n: Math.floor(diff / HOUR) };
  if (day === shiftKey(today, -1)) return { kind: "yesterday" };
  return { kind: "date", text: shortDate(iso, now, tz) };
}

/** «только что», «2 мин назад», «3 ч назад», «вчера», «20 окт.». */
export function ago(iso: string, now: number, tz?: string): string {
  const r = relative(iso, now, tz);
  switch (r.kind) {
    case "now":
      return s.time.justNow;
    case "min":
      return s.time.minAgo(r.n);
    case "hours":
      return s.time.hoursAgo(r.n);
    case "yesterday":
      return s.time.yesterday;
    case "date":
      return r.text;
  }
}

/** То же без «назад» — для тесных строк списка: «2 мин», «1 ч». */
export function agoShort(iso: string, now: number, tz?: string): string {
  const r = relative(iso, now, tz);
  switch (r.kind) {
    case "now":
      return s.time.justNow;
    case "min":
      return s.time.min(r.n);
    case "hours":
      return s.time.hours(r.n);
    case "yesterday":
      return s.time.yesterday;
    case "date":
      return r.text;
  }
}

/** Подпись разделителя дня: «Сегодня, 23 октября», «Вчера, 22 октября», «21 октября 2025». */
export function dayLabel(key: string, now: number, tz?: string): string {
  const today = dayKey(now, tz);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const date = fmt(sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" }, "UTC")
    .format(keyDate(key))
    .replace(/\s*г\.$/, "");
  if (key === today) return `${s.time.today}, ${date}`;
  if (key === shiftKey(today, -1)) return `${s.time.yesterdayDay}, ${date}`;
  return date;
}

export interface DayGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/** Подряд идущие элементы одного календарного дня — в одну группу. */
export function groupByDay<T>(items: readonly T[], at: (item: T) => string, now: number, tz?: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const iso = at(item);
    const key = Number.isFinite(ms(iso)) ? dayKey(iso, tz) : dayKey(now, tz);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(key, now, tz), items: [item] });
  }
  return groups;
}
