import { useSyncExternalStore } from "react";

/**
 * Дизайн интерфейса. «Прибор» — исходный (docs/design.md), «светлый» —
 * второй, по макету владельца 03.11.2026: две колонки, участники и действия
 * за кнопками. Старый не убираем, пока владелец не скажет — выбор хранится в
 * браузере, а на странице его видит CSS через html[data-design].
 */
export type Design = "device" | "light";

const KEY = "chat0110.design";
const listeners = new Set<() => void>();

export function parseDesign(saved: string | null): Design {
  return saved === "light" ? "light" : "device";
}

function read(): Design {
  try {
    return parseDesign(localStorage.getItem(KEY));
  } catch {
    return "device";
  }
}

let current: Design = typeof window === "undefined" ? "device" : read();

/** Метка на <html>: светлые токены и правила styles.css включаются по ней. */
export function applyDesign(design: Design = current): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.design = design;
  // Цвет полосы браузера — под фон дизайна. Светлый светел и в тёмной системе;
  // «прибор» возвращает свои два значения (index.html).
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const dark = meta.getAttribute("media")?.includes("dark");
    meta.setAttribute("content", design === "light" ? "#f7f7f5" : dark ? "#0e0f10" : "#d9dbd7");
  }
}

export const getDesign = () => current;

export function subscribeDesign(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setDesign(next: Design): void {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* Приватный режим может запрещать storage — выбор живёт до перезагрузки. */
  }
  applyDesign(next);
  for (const fn of listeners) fn();
}

export function useDesign(): Design {
  return useSyncExternalStore(subscribeDesign, getDesign, getDesign);
}
