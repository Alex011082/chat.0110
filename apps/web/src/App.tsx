import { ConnectAgents } from "./screens/ConnectAgents.tsx";
import { Plugins } from "./screens/Plugins.tsx";
import type { AppConfig, Me } from "@chat0110/chat-protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiFailure, mockRequested, setUnauthorizedHandler } from "./api.ts";
import { s, getLocale, subscribeLocale, setLocale } from "./strings.ts";
import { Mark } from "./ui/kit.tsx";
import { Login } from "./screens/Login.tsx";
import { Shell } from "./screens/Shell.tsx";
import {drafts} from "./lib/drafts.ts";

type Auth = { state: "loading" } | { state: "anon"; notice?: "forbidden" | "offline" } | { state: "in"; me: Me };

export function App() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  useEffect(() => {
    setLocale(locale);
  }, [locale]);
  const [auth, setAuth] = useState<Auth>({ state: "loading" });
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth({ state: "anon" }));
    api()
      .config()
      .then(setConfig, () => setConfig(null));
    api()
      .me()
      .then(
        (me) => {drafts.activate(me.id);setAuth({ state: "in", me });},
        (e: unknown) => {
          // 403 на /api/me — вход закрыт списком беты: объясняем, а не крутим вход по кругу.
          if (e instanceof ApiFailure && e.status === 403) {
            setAuth({ state: "anon", notice: "forbidden" });
          } else if (e instanceof ApiFailure && e.status === 401) {
            setAuth({ state: "anon" });
          } else {
            setAuth({ state: "anon", notice: "offline" });
          }
        },
      );
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = async () => {
    drafts.clear();
    try {
      await api().logout();
    } catch {
      // cookie всё равно уйдёт с перезагрузкой, если сервер её снял; иначе покажем вход ещё раз
    }
    // Полная перезагрузка стирает черновики и очередь отправки — на чужом компьютере это важно.
    location.assign(mockRequested() ? "/?mock=login" : "/");
  };

  if (location.pathname === "/connect") return <ConnectAgents />;
  if (location.pathname === "/plugins") return <Plugins />;
  if (auth.state === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ground" role="status" aria-label={s.loading}>
        <Mark cell={5} className="opacity-40" />
      </div>
    );
  }
  if (auth.state === "anon")
    return (
      <Login
        config={config}
        notice={
          auth.notice
            ? auth.notice === "forbidden"
              ? { title: s.login.forbiddenTitle, text: s.login.forbidden }
              : { title: s.errors.generic, text: s.login.serverDown }
            : undefined
        }
      />
    );
  return <Shell me={auth.me} config={config} onLogout={() => void logout()} />;
}
