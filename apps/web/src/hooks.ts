import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { mockRequested } from "./api.ts";
import { parseRoute, routePath, type Route } from "./lib/route.ts";

// --- Адрес (History API) ---------------------------------------------------------

const ROUTE_EVENT = "chat0110:route";

function subscribeRoute(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(ROUTE_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(ROUTE_EVENT, cb);
  };
}

const getPath = () => location.pathname;

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribeRoute, getPath, getPath);
  return useMemo(() => parseRoute(path), [path]);
}

/** Переход внутри приложения. Пробный режим (?mock) сохраняется в адресе. */
export function navigate(route: Route, opts: { replace?: boolean; hash?: string } = {}): void {
  const mock = mockRequested();
  const search = mock && import.meta.env.DEV ? `?mock=${encodeURIComponent(mock)}` : "";
  const url = routePath(route) + search + (opts.hash ? `#${opts.hash}` : "");
  if (url === location.pathname + location.search + location.hash) return;
  if (opts.replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

// --- Ширина экрана ------------------------------------------------------------------

export type Layout = "phone" | "tablet" | "desktop";

function media(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = media(query);
      m?.addEventListener("change", cb);
      return () => m?.removeEventListener("change", cb);
    },
    () => media(query)?.matches ?? false,
    () => false,
  );
}

/** < 700 — телефон, 700–1100 — без правой колонки, ≥ 1100 — всё сразу. */
export function useLayout(): Layout {
  const wide = useMedia("(min-width: 1100px)");
  const mid = useMedia("(min-width: 700px)");
  return wide ? "desktop" : mid ? "tablet" : "phone";
}

export function prefersReducedMotion(): boolean {
  return media("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

// --- Время, которое тикает ----------------------------------------------------------

/** «2 мин назад» должно стареть само: перерисовка раз в 30 с. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// --- Копирование ----------------------------------------------------------------------

/** Копирует текст; `copied` — true на 2 с, чтобы показать «Скопировано». */
export function useCopy(): { copied: boolean; failed: boolean; copy: (text: string) => void } {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    const done = (ok: boolean) => {
      setState(ok ? "ok" : "fail");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    };
    if (!navigator.clipboard?.writeText) return done(false);
    navigator.clipboard.writeText(text).then(
      () => done(true),
      () => done(false),
    );
  }, []);
  return { copied: state === "ok", failed: state === "fail", copy };
}

// --- Хранилище браузера ---------------------------------------------------------------

/** localStorage может бросить (приватное окно, запрет cookies) — не страшно. */
export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // удобство, не данные: молча пропускаем
  }
}
