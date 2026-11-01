import { resolve } from "node:path";

export interface Config {
  port: number;
  // Публичный адрес без хвостового слэша: из него строятся redirect_uri и
  // проверка Origin, поэтому он должен совпадать с тем, что видит браузер.
  publicUrl: string;
  publicOrigin: string;
  // http://localhost в разработке: там нет TLS, и cookie с Secure/__Host-
  // браузер просто не сохранит.
  devCookies: boolean;
  clientId: string;
  clientSecret: string;
  appSlug: string;
  webhookSecret: string;
  cookieKey: Uint8Array;
  // Вход открыт любому аккаунту GitHub; здесь — только те, кому владелец
  // закрыл вход (злоупотребления). Пусто — закрытых нет.
  blockedLogins: Set<string>;
  webDist: string;
}

type Env = Record<string, string | undefined>;

const REQUIRED = [
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_SLUG",
  "GITHUB_WEBHOOK_SECRET",
  "CHAT0110_COOKIE_KEY",
  "CHAT0110_PUBLIC_URL",
] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Все ошибки собираются в одну: на сервере env правят через configure.sh,
// и чинить по одной переменной за перезапуск — долго и обидно.
export function loadConfig(env: Env): Config {
  const problems: string[] = [];
  const get = (name: string) => env[name]?.trim() ?? "";

  const missing = REQUIRED.filter((name) => !get(name));
  if (missing.length) problems.push(`не заданы переменные окружения: ${missing.join(", ")}`);

  const portRaw = get("CHAT0110_PORT") || "4340";
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) problems.push(`CHAT0110_PORT должен быть числом 1–65535, а не «${portRaw}»`);

  let publicUrl = "";
  let publicOrigin = "";
  let devCookies = false;
  const rawUrl = get("CHAT0110_PUBLIC_URL");
  if (rawUrl) {
    let url: URL | null = null;
    try {
      url = new URL(rawUrl);
    } catch {
      problems.push(`CHAT0110_PUBLIC_URL — не адрес: «${rawUrl}»`);
    }
    if (url) {
      const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
      if (url.protocol !== "https:" && !local) {
        problems.push("CHAT0110_PUBLIC_URL должен начинаться с https:// (http — только для localhost)");
      } else {
        publicUrl = rawUrl.replace(/\/+$/, "");
        publicOrigin = url.origin;
        devCookies = local;
      }
    }
  }

  const keyHex = get("CHAT0110_COOKIE_KEY");
  let cookieKey = new Uint8Array();
  if (keyHex) {
    if (/^[0-9a-fA-F]{64}$/.test(keyHex)) cookieKey = Uint8Array.from(Buffer.from(keyHex, "hex"));
    else problems.push("CHAT0110_COOKIE_KEY должен быть ровно 64 hex-символа (32 байта для AES-256)");
  }

  if (problems.length) throw new Error(`Конфигурация chat.0110 неполная: ${problems.join("; ")}`);

  // Белого списка больше нет: с ним новый человек не мог войти сам, пока
  // владелец не впишет его руками. Старую переменную не читаем, а громко
  // замечаем — иначе на сервере, где она осталась, вход молча открылся бы
  // не так, как ждёт тот, кто её туда записал.
  if (env.CHAT0110_ALLOWED_LOGINS?.trim()) {
    console.warn("CHAT0110_ALLOWED_LOGINS больше не действует: вход открыт всем. Закрыть вход отдельным логинам — CHAT0110_BLOCKED_LOGINS.");
  }
  const blockedLogins = new Set(
    (env.CHAT0110_BLOCKED_LOGINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );

  return {
    port,
    publicUrl,
    publicOrigin,
    devCookies,
    clientId: get("GITHUB_APP_CLIENT_ID"),
    clientSecret: get("GITHUB_APP_CLIENT_SECRET"),
    appSlug: get("GITHUB_APP_SLUG"),
    webhookSecret: get("GITHUB_WEBHOOK_SECRET"),
    cookieKey,
    blockedLogins,
    webDist: get("CHAT0110_WEB_DIST") || resolve(import.meta.dir, "../../web/dist"),
  };
}

export function isLoginAllowed(config: Pick<Config, "blockedLogins">, login: string): boolean {
  return !config.blockedLogins.has(login.toLowerCase());
}
