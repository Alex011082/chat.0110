import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate, routeHref } from "../hooks.ts";
import type { Route } from "../lib/route.ts";

/** Переход по ссылке внутри приложения; Cmd/Ctrl/Shift-клик — как у браузера. */
export function followInApp(e: MouseEvent<Element>, to: Route, opts: { hash?: string; replace?: boolean } = {}): void {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  navigate(to, opts);
}

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: Route; hash?: string; replace?: boolean };

/** Ссылка на экран приложения: настоящий href (новая вкладка, копирование) и переход без перезагрузки. */
export function AppLink({ to, hash, replace, onClick, ...rest }: AppLinkProps) {
  return (
    <a
      href={routeHref(to, hash)}
      onClick={(e) => {
        onClick?.(e);
        followInApp(e, to, { ...(hash ? { hash } : {}), ...(replace ? { replace } : {}) });
      }}
      {...rest}
    />
  );
}
