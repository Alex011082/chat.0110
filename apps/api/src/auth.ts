// Вход через GitHub App (user-to-server токен): все чтения и записи потом
// идут от имени пользователя и в пределах его прав. Приватный ключ App не нужен.
import { timingSafeEqual } from "node:crypto";
import { isLoginAllowed, type Config } from "./config.ts";
import { HttpError } from "./errors.ts";
import { GitHubClient, type Fetch } from "./github.ts";
import { htmlPage } from "./html.ts";
import { exchangeToken, sessionFromTokens, readCookie, type SessionStore } from "./session.ts";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export interface AuthDeps {
  config: Config;
  sessions: SessionStore;
  fetch?: Fetch;
  now?: () => number;
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

export function createAuth(deps: AuthDeps) {
  const { config, sessions } = deps;
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const redirectUri = `${config.publicUrl}/auth/callback`;
  const retry = { href: "/auth/login", label: "Войти ещё раз" };

  const nextCookieName = config.devCookies ? "chat0110_dev_next" : "__Host-chat0110_next";
  const nextAttrs = `; Path=/; HttpOnly${config.devCookies ? "" : "; Secure"}; SameSite=Lax; Max-Age=`;
  const safeNext = (value: string | null) =>
    value && value.length <= 4096 && (/^\/oauth\/authorize\?/.test(value) || /^\/connect(?:\?|$)/.test(value))
      ? value
      : "/";
  return {
    login(req?: Request): Response {
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      const next = req ? safeNext(new URL(req.url).searchParams.get("next")) : "/";
      return redirect(url.toString(), [
        sessions.stateCookie(state),
        `${nextCookieName}=${encodeURIComponent(next)}${nextAttrs}600`,
      ]);
    },

    async callback(req: Request): Promise<Response> {
      const params = new URL(req.url).searchParams;
      const state = params.get("state") ?? "";
      const expected = sessions.readState(req) ?? "";
      const clear = [sessions.clearStateCookie(), `${nextCookieName}=${nextAttrs}0`];

      if (!state || !expected || !sameState(state, expected)) {
        // Возврат после установки App приходит без нашего state. Код из него
        // не обмениваем: иначе чужая ссылка могла бы залогинить жертву в
        // аккаунт атакующего (login CSRF). Просто начинаем вход заново —
        // GitHub уже знает пользователя и сразу вернёт его с правильным state.
        if (params.get("setup_action")) return redirect("/auth/login", clear);
        return withCookies(
          htmlPage(400, "Вход не удался", "Проверочная cookie потерялась или устарела. Начните вход заново.", retry),
          clear,
        );
      }
      if (params.get("error")) {
        return withCookies(
          htmlPage(400, "Вход отменён", "GitHub не подтвердил вход. Можно попробовать снова.", retry),
          clear,
        );
      }
      const code = params.get("code");
      if (!code) return withCookies(htmlPage(400, "Вход не удался", "GitHub не прислал код входа.", retry), clear);

      try {
        const tokens = await exchangeToken(fetcher, {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        });
        const user = await new GitHubClient({ token: tokens.access_token, userId: 0, fetch: fetcher }).getUser();
        if (!isLoginAllowed(config, user.login)) {
          return withCookies(
            htmlPage(
              403,
              "Вход пока закрыт",
              `Идёт закрытая бета: вход для ${user.login} ещё не открыт. Напишите владельцу chat.0110, чтобы вас добавили.`,
            ),
            clear,
          );
        }
        const session = sessionFromTokens(tokens, user, now());
        let next = "/";
        try {
          next = safeNext(decodeURIComponent(readCookie(req, nextCookieName) ?? "/"));
        } catch {}
        return redirect(next, [...clear, await sessions.cookieFor(session)]);
      } catch (e) {
        const why = e instanceof HttpError ? e.message : "GitHub не ответил";
        if (!(e instanceof HttpError)) console.error("вход: сбой обмена кода");
        return withCookies(htmlPage(400, "Вход не удался", why, retry), clear);
      }
    },

    logout(): Response {
      const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
      headers.append("Set-Cookie", sessions.clearCookie());
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
