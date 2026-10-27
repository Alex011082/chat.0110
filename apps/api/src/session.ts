// Cookie зашифрована AES-256-GCM. Для подключённого MCP свежая сессия также
// хранится на сервере: браузер и агент делят одноразовый refresh GitHub.
import { HttpError } from "./errors.ts";
import type { Fetch } from "./github.ts";

export interface SessionData {
  uid: number;
  login: string;
  at: string; // access-токен
  rt: string; // refresh-токен ("" — если у App выключено истечение токенов)
  exp: number; // когда истекает access, мс
  rexp: number; // когда истекает refresh = срок жизни сессии, мс
}

export interface TokenSet {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface SessionPersistence {
  load(uid: number): Promise<SessionData | null>;
  save(data: SessionData): Promise<void>;
}

const AAD = new TextEncoder().encode("chat0110:session:v1");
const PREFIX = "v1.";
const REFRESH_AHEAD_MS = 5 * 60_000;
const ROTATED_TTL_MS = 60_000;
// Если App выдаёт вечные токены (истечение выключено), сессию всё равно
// ограничиваем: месяц — и вход заново.
const NO_EXPIRY_SESSION_MS = 30 * 24 * 3600_000;
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export async function importCookieKey(raw: Uint8Array): Promise<CryptoKey> {
  // Копия: WebCrypto хочет ArrayBuffer, а не SharedArrayBuffer-совместимый вид.
  return crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, data: SessionData): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plain));
  const out = new Uint8Array(iv.length + enc.length);
  out.set(iv);
  out.set(enc, iv.length);
  return PREFIX + Buffer.from(out).toString("base64url");
}

export async function unseal(key: CryptoKey, value: string, now: number): Promise<SessionData | null> {
  if (!value.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
    if (raw.length < 13) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: AAD },
      key,
      raw.subarray(12),
    );
    const d = JSON.parse(new TextDecoder().decode(plain)) as SessionData;
    if (typeof d.uid !== "number" || typeof d.login !== "string" || typeof d.at !== "string") return null;
    if (!(d.rexp > now)) return null;
    return d;
  } catch {
    return null;
  }
}

// Токен-эндпоинт GitHub сообщает об ошибке статусом 200 и полем error в теле,
// поэтому проверяем тело, а не только статус.
export async function exchangeToken(fetcher: Fetch, params: Record<string, string>): Promise<TokenSet> {
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "chat0110" },
    body: new URLSearchParams(params).toString(),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // ниже это превратится в ошибку
  }
  if (!res.ok || !body || body.error || typeof body.access_token !== "string") {
    const why = body?.error ? `${body.error}${body.error_description ? `: ${body.error_description}` : ""}` : `HTTP ${res.status}`;
    throw new HttpError(401, "unauthorized", `GitHub не выдал токен (${why})`);
  }
  return body as TokenSet;
}

export function sessionFromTokens(t: TokenSet, user: { id: number; login: string }, now: number): SessionData {
  const rexp = t.refresh_token && t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : now + NO_EXPIRY_SESSION_MS;
  return {
    uid: user.id,
    login: user.login,
    at: t.access_token,
    rt: t.refresh_token ?? "",
    exp: t.expires_in ? now + t.expires_in * 1000 : rexp,
    rexp,
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export class SessionStore {
  readonly cookieName: string;
  readonly stateCookieName: string;
  private readonly key: CryptoKey;
  private readonly dev: boolean;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: Fetch;
  private readonly now: () => number;
  private persistence?: SessionPersistence;
  // Refresh-токены GitHub одноразовые и ротируются. Две вкладки (или SSE и
  // fetch) со старой cookie одновременно пойдут обновляться, и вторая получит
  // bad_refresh_token — пользователя выкинет. Поэтому: одно обновление на
  // refresh-токен в процессе, и минуту помним «старый → новая пара».
  private inflight = new Map<string, Promise<SessionData>>();
  private rotated = new Map<string, { data: SessionData; until: number }>();

  constructor(opts: { key: CryptoKey; dev: boolean; clientId: string; clientSecret: string; fetch?: Fetch; now?: () => number }) {
    this.key = opts.key;
    this.dev = opts.dev;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.fetcher = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    // __Host- требует Secure, а на http://localhost Secure-cookie не сохранится.
    this.cookieName = this.dev ? "chat0110_dev" : "__Host-chat0110";
    this.stateCookieName = this.dev ? "chat0110_dev_state" : "__Host-chat0110_state";
  }

  private attrs(maxAge: number): string {
    // Lax, а не Strict: со Strict cookie теряется на возврате с github.com.
    return `; Path=/; HttpOnly${this.dev ? "" : "; Secure"}; SameSite=Lax; Max-Age=${maxAge}`;
  }

  setPersistence(persistence: SessionPersistence): void {
    this.persistence = persistence;
  }

  private async latest(data: SessionData): Promise<SessionData> {
    const saved = await this.persistence?.load(data.uid);
    return saved && saved.uid === data.uid && saved.exp > data.exp ? saved : data;
  }

  async cookieFor(data: SessionData): Promise<string> {
    await this.persistence?.save(data);
    data = await this.latest(data);
    const maxAge = Math.max(0, Math.floor((data.rexp - this.now()) / 1000));
    return `${this.cookieName}=${await seal(this.key, data)}${this.attrs(maxAge)}`;
  }

  clearCookie(): string {
    return `${this.cookieName}=${this.attrs(0)}`;
  }

  stateCookie(state: string): string {
    return `${this.stateCookieName}=${state}${this.attrs(600)}`;
  }

  clearStateCookie(): string {
    return `${this.stateCookieName}=${this.attrs(0)}`;
  }

  readState(req: Request): string | null {
    return readCookie(req, this.stateCookieName) || null;
  }

  async read(req: Request): Promise<{ session: SessionData; setCookie?: string } | null> {
    const raw = readCookie(req, this.cookieName);
    if (!raw) return null;
    const now = this.now();
    const original = await unseal(this.key, raw, now);
    if (!original) return null;
    const session = await this.latest(original);
    await this.persistence?.save(session);
    if (!session.rt || session.exp - now > REFRESH_AHEAD_MS) {
      return session.exp > now ? { session, ...(session !== original ? { setCookie: await this.cookieFor(session) } : {}) } : null;
    }
    try {
      let fresh = await this.refresh(session);
      await this.persistence?.save(fresh);
      fresh = await this.latest(fresh);
      return { session: fresh, setCookie: await this.cookieFor(fresh) };
    } catch {
      // Обновить не вышло (сеть, отозванный токен). Пока access жив — работаем,
      // дальше пользователь просто войдёт заново.
      const saved = await this.latest(session);
      return saved.exp > now ? { session: saved, ...(saved !== original ? { setCookie: await this.cookieFor(saved) } : {}) } : null;
    }
  }

  private refresh(session: SessionData): Promise<SessionData> {
    const now = this.now();
    for (const [rt, v] of this.rotated) if (v.until <= now) this.rotated.delete(rt);
    const done = this.rotated.get(session.rt);
    if (done) return Promise.resolve(done.data);
    const running = this.inflight.get(session.rt);
    if (running) return running;
    const p = (async () => {
      const tokens = await exchangeToken(this.fetcher, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: session.rt,
      });
      const at = this.now();
      const fresh = sessionFromTokens(tokens, { id: session.uid, login: session.login }, at);
      this.rotated.set(session.rt, { data: fresh, until: at + ROTATED_TTL_MS });
      return fresh;
    })();
    this.inflight.set(session.rt, p);
    p.finally(() => this.inflight.delete(session.rt)).catch(() => {});
    return p;
  }
}
