// OAuth выдаёт доступ только к нашему MCP. Токены GitHub не покидают сервер:
// в SQLite лежит та же AES-GCM сессия, что используется для входа на сайт.
import { consentPage, type ConsentLocale } from "./mcp-consent.ts";
import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { isLoginAllowed, type Config } from "./config.ts";
import { readCookie, seal, unseal, type SessionData, type SessionStore } from "./session.ts";

interface Options {
  db: Database;
  key: CryptoKey;
  publicUrl: string;
  sessions: SessionStore;
  config: Config;
  now?: () => number;
}
export interface McpPrincipal { session: SessionData; connectionId: string }
interface Client { id: string; redirects: string; expires: number }
interface Authorization { client_id: string; redirect_uri: string; response_type: string; scope: string; resource: string; code_challenge: string; code_challenge_method: string; state: string }
interface Code { hash: string; uid: number; client_id: string; redirect_uri: string; resource: string; challenge: string; expires: number; sealed: string }
interface Token { access_hash: string; refresh_hash: string; grant_id: string; access_exp: number; refresh_exp: number; uid: number; client_id: string; resource: string }

const SCOPE = "chat:agent";
const CODE_MS = 5 * 60_000;
const CONSENT_MS = 10 * 60_000;
const ACCESS_MS = 3600_000;
const REFRESH_MS = 30 * 86400_000;
const CLIENT_MS = 90 * 86400_000;
const PENDING_CLIENT_MS = 3600_000;
const BODY_LIMIT = 16_384;
const MAX_CLIENTS = 1000;
const MAX_TRANSIENT = 10_000;
const random = () => randomBytes(32).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const pkce = (s: string) => createHash("sha256").update(s).digest("base64url");
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const AUTH_KEYS = ["client_id", "redirect_uri", "response_type", "scope", "resource", "code_challenge", "code_challenge_method", "state"] as const;

class OAuthError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
function fail(code = "invalid_request", status = 400): never { throw new OAuthError(code, status); }
function headers(contentType = "application/json"): Headers {
  return new Headers({ "Content-Type": contentType, "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
}
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: headers() }); }
function redirect(location: string): Response { return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }

function allowedRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 512) return false;
  try {
    const u = new URL(uri);
    if (u.href !== uri || u.username || u.password || u.search || u.hash) return false;
    // CLI возвращает результат только на зарегистрированный loopback-порт.
    // Проверяем строковый hostname: DNS не должен превращать чужой домен
    // в разрешённый localhost во время обмена кодом.
    if (u.protocol === "http:") return ["localhost", "127.0.0.1"].includes(u.hostname) && !!u.port && ["/callback", "/oauth/callback"].includes(u.pathname);
    if (u.protocol !== "https:" || u.port) return false;
    if (u.hostname === "chatgpt.com") return u.pathname === "/connector_platform_oauth_redirect" || /^\/connector\/oauth\/[A-Za-z0-9-]+$/.test(u.pathname);
    if (["claude.ai", "claude.com"].includes(u.hostname)) return u.pathname === "/api/mcp/auth_callback";
    if (u.hostname === "grok.com") return true;
    return false;
  } catch { return false; }
}

function unique(params: URLSearchParams): void {
  const seen = new Set<string>();
  for (const [k, v] of params) {
    if (seen.has(k) || k.length > 80 || v.length > 2048) fail();
    seen.add(k);
  }
}
async function limitedBody(req: Request): Promise<string> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) fail("invalid_request", 413);
  if (!req.body) return "";
  const reader = req.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > BODY_LIMIT) { await reader.cancel(); fail("invalid_request", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(all);
}
async function form(req: Request): Promise<URLSearchParams> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") fail("invalid_request", 415);
  const params = new URLSearchParams(await limitedBody(req)); unique(params); return params;
}

export class McpOAuth {
  private readonly db: Database;
  private readonly key: CryptoKey;
  private readonly publicUrl: string;
  private readonly origin: string;
  private readonly resource: string;
  private readonly sessions: SessionStore;
  private readonly config: Config;
  private readonly now: () => number;
  private readonly consentCookie: string;

  constructor(opts: Options) {
    this.db = opts.db; this.key = opts.key; this.publicUrl = opts.publicUrl.replace(/\/+$/, "");
    this.origin = new URL(this.publicUrl).origin; this.resource = this.publicUrl + "/mcp";
    this.sessions = opts.sessions; this.config = opts.config; this.now = opts.now ?? Date.now;
    this.consentCookie = opts.config.devCookies ? "chat0110_dev_mcp_consent" : "__Host-chat0110_mcp_consent";
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS mcp_oauth_clients (id TEXT PRIMARY KEY, redirects TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_oauth_client_meta (client_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, authorized INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS mcp_oauth_client_fingerprint ON mcp_oauth_client_meta(fingerprint);
      CREATE TABLE IF NOT EXISTS mcp_oauth_consents (hash TEXT PRIMARY KEY, uid INTEGER NOT NULL, cookie_hash TEXT NOT NULL, request_hash TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_oauth_codes (hash TEXT PRIMARY KEY, uid INTEGER NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL, sealed TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_oauth_accounts (uid INTEGER PRIMARY KEY, sealed TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_oauth_grants (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, client_id TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (access_hash TEXT PRIMARY KEY, refresh_hash TEXT NOT NULL UNIQUE, grant_id TEXT NOT NULL, access_exp INTEGER NOT NULL, refresh_exp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_oauth_used_refresh (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, client_id TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS mcp_oauth_grants_uid ON mcp_oauth_grants(uid);
      CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_grant ON mcp_oauth_tokens(grant_id);`);
    if (!this.db.query<{ name: string }, []>("PRAGMA table_info(mcp_oauth_accounts)").all().some((column) => column.name === "expires")) {
      this.db.exec("ALTER TABLE mcp_oauth_accounts ADD COLUMN expires INTEGER NOT NULL DEFAULT 0");
    }
    this.sessions.setPersistence({
      load: async (uid) => {
        const row = this.db.query<{ sealed: string }, [number]>("SELECT sealed FROM mcp_oauth_accounts WHERE uid = ?").get(uid);
        const data = row ? await unseal(this.key, row.sealed, this.now()) : null;
        if (data) this.db.query("UPDATE mcp_oauth_accounts SET expires = ? WHERE uid = ? AND sealed = ?").run(data.rexp, uid, row!.sealed);
        return data;
      },
      save: async (data) => {
        // CAS не даёт запоздалому ответу браузера перезаписать уже
        // обновлённый refresh агента. Без согласия строка не создаётся.
        let encrypted: string | undefined;
        while (true) {
          const row = this.db.query<{ sealed: string }, [number]>("SELECT sealed FROM mcp_oauth_accounts WHERE uid = ?").get(data.uid);
          if (!row) return;
          const current = await unseal(this.key, row.sealed, this.now());
          if (current && current.exp >= data.exp) {
            this.db.query("UPDATE mcp_oauth_accounts SET expires = ? WHERE uid = ? AND sealed = ?").run(current.rexp, data.uid, row.sealed);
            return;
          }
          encrypted ??= await seal(this.key, data);
          if (this.db.query("UPDATE mcp_oauth_accounts SET sealed = ?, expires = ? WHERE uid = ? AND sealed = ?").run(encrypted, data.rexp, data.uid, row.sealed).changes) return;
        }
      },
    });
  }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url); const path = url.pathname;
    const protectedMetadata = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(path);
    const metadata = protectedMetadata || path === "/.well-known/oauth-authorization-server";
    const endpoint = ["/oauth/register", "/oauth/authorize", "/oauth/token", "/oauth/revoke"].includes(path);
    if (!metadata && !endpoint) return null;
    try {
      let res: Response;
      if (req.method === "OPTIONS" && path !== "/oauth/authorize") {
        res = new Response(null, { status: 204 });
      } else if (metadata) {
        if (req.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET, OPTIONS" } });
        res = protectedMetadata ? json({ resource: this.resource, authorization_servers: [this.publicUrl], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "chat.0110 MCP" }) : json({
          issuer: this.publicUrl, authorization_endpoint: this.publicUrl + "/oauth/authorize", token_endpoint: this.publicUrl + "/oauth/token", registration_endpoint: this.publicUrl + "/oauth/register", revocation_endpoint: this.publicUrl + "/oauth/revoke",
          response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [SCOPE], authorization_response_iss_parameter_supported: true,
        });
      } else {
        this.cleanup();
        if (path === "/oauth/authorize" && ["GET", "POST"].includes(req.method)) return await this.authorize(req, url);
        if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: path === "/oauth/authorize" ? "GET, POST" : "POST, OPTIONS" } });
        if (path === "/oauth/register") res = await this.register(req);
        else if (path === "/oauth/token") res = await this.token(req);
        else if (path === "/oauth/revoke") res = await this.revoke(req);
        else fail();
      }
      res.headers.set("Access-Control-Allow-Origin", "*");
      res.headers.set("Access-Control-Allow-Methods", metadata ? "GET, OPTIONS" : "POST, OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Content-Type");
      return res;
    } catch (e) {
      if (e instanceof OAuthError) return json({ error: e.code }, e.status);
      throw e;
    }
  }

  private cleanup(): void {
    const now = this.now();
    this.db.transaction(() => {
      this.db.query("DELETE FROM mcp_oauth_clients WHERE expires <= ?").run(now);
      this.db.query("DELETE FROM mcp_oauth_client_meta WHERE client_id NOT IN (SELECT id FROM mcp_oauth_clients)").run();
      this.db.query("DELETE FROM mcp_oauth_consents WHERE expires <= ?").run(now);
      this.db.query("DELETE FROM mcp_oauth_codes WHERE expires <= ?").run(now);
      this.db.query("DELETE FROM mcp_oauth_grants WHERE expires <= ? OR client_id NOT IN (SELECT id FROM mcp_oauth_clients)").run(now);
      this.db.query("DELETE FROM mcp_oauth_tokens WHERE grant_id NOT IN (SELECT id FROM mcp_oauth_grants)").run();
      this.db.query("DELETE FROM mcp_oauth_used_refresh WHERE expires <= ? OR grant_id NOT IN (SELECT id FROM mcp_oauth_grants)").run(now);
      // Даже после отключения MCP браузеру нужна последняя ротация GitHub:
      // его cookie ещё может содержать уже потраченный refresh.
      this.db.query("DELETE FROM mcp_oauth_accounts WHERE expires > 0 AND expires <= ?").run(now);
    }).immediate();
  }
  private client(id: string): Client | null {
    return this.db.query<Client, [string, number]>("SELECT * FROM mcp_oauth_clients WHERE id = ? AND expires > ?").get(id, this.now());
  }
  private async register(req: Request): Promise<Response> {
    if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") fail("invalid_client_metadata", 415);
    const raw = await limitedBody(req);
    let body: any; try { body = JSON.parse(raw); } catch { fail("invalid_client_metadata"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("invalid_client_metadata");
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 5 || !body.redirect_uris.every(allowedRedirect)) fail("invalid_redirect_uri");
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") fail("invalid_client_metadata");
    if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || !body.grant_types.length || body.grant_types.length > 2 || !body.grant_types.every((x: unknown) => x === "authorization_code" || x === "refresh_token"))) fail("invalid_client_metadata");
    if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== "code")) fail("invalid_client_metadata");
    if (body.scope !== undefined && body.scope !== SCOPE) fail("invalid_scope");
    if (body.client_name !== undefined && (typeof body.client_name !== "string" || body.client_name.length > 80)) fail("invalid_client_metadata");
    const redirects = [...new Set<string>(body.redirect_uris)].sort();
    const canonical = JSON.stringify(redirects); const fingerprint = hash(canonical);
    let id = random(); let issued = this.now(); const expires = this.now() + PENDING_CLIENT_MS;
    this.db.transaction(() => {
      const existing = this.db.query<{ id: string; created: number }, [string, number]>("SELECT c.id, m.created FROM mcp_oauth_clients c JOIN mcp_oauth_client_meta m ON m.client_id = c.id WHERE m.fingerprint = ? AND c.expires > ? LIMIT 1").get(fingerprint, this.now());
      if (existing) { id = existing.id; issued = existing.created; return; }
      if (this.count("mcp_oauth_clients") >= MAX_CLIENTS) {
        const unused = this.db.query<{ id: string }, []>("SELECT c.id FROM mcp_oauth_clients c LEFT JOIN mcp_oauth_client_meta m ON m.client_id = c.id WHERE COALESCE(m.authorized, 0) = 0 AND c.id NOT IN (SELECT client_id FROM mcp_oauth_grants) AND c.id NOT IN (SELECT client_id FROM mcp_oauth_codes) ORDER BY COALESCE(m.created, 0), c.id LIMIT 1").get();
        if (!unused) fail("temporarily_unavailable", 429);
        this.db.query("DELETE FROM mcp_oauth_clients WHERE id = ?").run(unused.id);
        this.db.query("DELETE FROM mcp_oauth_client_meta WHERE client_id = ?").run(unused.id);
      }
      this.db.query("INSERT INTO mcp_oauth_clients (id, redirects, expires) VALUES (?, ?, ?)").run(id, canonical, expires);
      this.db.query("INSERT INTO mcp_oauth_client_meta (client_id, fingerprint, created) VALUES (?, ?, ?)").run(id, fingerprint, this.now());
    }).immediate();
    return json({ client_id: id, client_id_issued_at: Math.floor(issued / 1000), redirect_uris: redirects, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: SCOPE }, 201);
  }
  private count(table: "mcp_oauth_clients" | "mcp_oauth_consents" | "mcp_oauth_codes" | "mcp_oauth_grants" | "mcp_oauth_used_refresh"): number {
    return this.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
  }
  private authorization(params: URLSearchParams): Authorization {
    unique(params);
    const p = Object.fromEntries(AUTH_KEYS.map((key) => [key, params.get(key) ?? ""])) as unknown as Authorization;
    const c = this.client(p.client_id);
    if (!c || !allowedRedirect(p.redirect_uri) || !(JSON.parse(c.redirects) as string[]).includes(p.redirect_uri)) fail("invalid_client");
    if (p.response_type !== "code") fail("unsupported_response_type");
    if (p.scope !== SCOPE) fail("invalid_scope");
    if (p.resource !== this.resource) fail("invalid_target");
    if (p.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) fail();
    if (p.state.length > 1024) fail();
    return p;
  }
  private requestHash(p: Authorization): string { return hash(JSON.stringify(AUTH_KEYS.map((key) => p[key]))); }
  private consentCookieValue(value: string, clear = false): string {
    return `${this.consentCookie}=${clear ? "" : value}; Path=/; HttpOnly${this.config.devCookies ? "" : "; Secure"}; SameSite=Lax; Max-Age=${clear ? 0 : CONSENT_MS / 1000}`;
  }
  private async authorize(req: Request, url: URL): Promise<Response> {
    if (req.url.length > 8192) fail("invalid_request", 414);
    if (req.method === "POST" && req.headers.get("origin") !== this.origin) fail("access_denied", 403);
    const params = req.method === "POST" ? await form(req) : url.searchParams;
    const p = this.authorization(params);
    const auth = await this.sessions.read(req);
    if (!auth || !isLoginAllowed(this.config, auth.session.login)) {
      if (req.method === "POST") fail("access_denied", 403);
      return redirect("/auth/login?next=" + encodeURIComponent(url.pathname + url.search));
    }
    let response: Response;
    if (req.method === "GET") {
      const nonce = random(); const binding = random();
      this.db.transaction(() => {
        if (this.count("mcp_oauth_consents") >= MAX_TRANSIENT) fail("temporarily_unavailable", 429);
        this.db.query("INSERT INTO mcp_oauth_consents (hash, uid, cookie_hash, request_hash, expires) VALUES (?, ?, ?, ?, ?)").run(hash(nonce), auth.session.uid, hash(binding), this.requestHash(p), this.now() + CONSENT_MS);
      }).immediate();
      const hidden = AUTH_KEYS.map((key) => `<input type="hidden" name="${key}" value="${escape(p[key])}">`).join("");
      const hostname = new URL(p.redirect_uri).hostname;
      const application = hostname === "chatgpt.com" ? "ChatGPT" : hostname.startsWith("claude.") ? "Claude" : hostname === "grok.com" ? "Grok" : "MCP-клиент на этом компьютере";
      const locale: ConsentLocale = params.get("lang") === "en" ? "en" : "ru";
      const html = consentPage({
        application,
        login: auth.session.login,
        callback: p.redirect_uri,
        hidden,
        nonce,
        locale,
        languageUrl: (lang) => {
          const query = new URLSearchParams(
            AUTH_KEYS.map((key) => [key, p[key]]),
          );
          query.set("lang", lang);
          return "/oauth/authorize?" + query;
        },
      });
      const h = headers("text/html; charset=utf-8");
      // У HTML-форм no-referrer обнуляет Origin даже при POST на свой домен.
      // same-origin сохраняет проверку CSRF, не раскрывая URL сайту клиента.
      h.set("Referrer-Policy", "same-origin");
      // form-action проверяет и переход после POST. Callback уже проверен
      // по allowlist и регистрации клиента; остальные внешние цели запрещены.
      h.set("Content-Security-Policy", `default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; form-action 'self' ${p.redirect_uri}; frame-ancestors 'none'; base-uri 'none'`);
      h.set("X-Frame-Options", "DENY"); h.append("Set-Cookie", this.consentCookieValue(binding));
      response = new Response(html, { headers: h });
    } else {
      const nonce = params.get("consent_nonce") ?? ""; const binding = readCookie(req, this.consentCookie) ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(binding)) fail("access_denied", 403);
      const decision = params.get("decision"); if (decision !== "allow" && decision !== "deny") fail();
      // Шифрование выполняется до синхронной транзакции: одно согласие
      // нельзя потратить дважды даже при параллельных запросах.
      const sealed = decision === "allow" ? await seal(this.key, auth.session) : "";
      const code = random();
      this.db.transaction(() => {
        const consumed = this.db.query("DELETE FROM mcp_oauth_consents WHERE hash = ? AND uid = ? AND cookie_hash = ? AND request_hash = ? AND expires > ?").run(hash(nonce), auth.session.uid, hash(binding), this.requestHash(p), this.now());
        if (!consumed.changes) fail("access_denied", 403);
        if (decision === "allow") {
          this.db.query("UPDATE mcp_oauth_clients SET expires = ? WHERE id = ?").run(this.now() + CLIENT_MS, p.client_id);
          this.db.query("UPDATE mcp_oauth_client_meta SET authorized = 1 WHERE client_id = ?").run(p.client_id);
          if (this.count("mcp_oauth_codes") >= MAX_TRANSIENT) fail("temporarily_unavailable", 429);
          this.db.query("INSERT INTO mcp_oauth_codes (hash, uid, client_id, redirect_uri, resource, challenge, expires, sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(hash(code), auth.session.uid, p.client_id, p.redirect_uri, p.resource, p.code_challenge, this.now() + CODE_MS, sealed);
        }
      }).immediate();
      const target = new URL(p.redirect_uri);
      if (decision === "allow") target.searchParams.set("code", code); else target.searchParams.set("error", "access_denied");
      if (p.state) target.searchParams.set("state", p.state);
      target.searchParams.set("iss", this.publicUrl);
      response = redirect(target.toString()); response.headers.append("Set-Cookie", this.consentCookieValue("", true));
    }
    if (auth.setCookie) response.headers.append("Set-Cookie", auth.setCookie);
    return response;
  }

  private async token(req: Request): Promise<Response> {
    const p = await form(req);
    const client = p.get("client_id") ?? "";
    if (!this.client(client) || req.headers.has("authorization") || p.has("client_secret")) fail("invalid_client");
    if (p.get("resource") !== this.resource) fail("invalid_target");
    if (p.has("scope") && p.get("scope") !== SCOPE) fail("invalid_scope");
    const type = p.get("grant_type");
    if (type === "authorization_code") {
      const raw = p.get("code") ?? ""; const verifier = p.get("code_verifier") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(raw) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail("invalid_grant");
      const c = this.db.query<Code, [string]>("SELECT * FROM mcp_oauth_codes WHERE hash = ?").get(hash(raw));
      if (!c || c.expires <= this.now() || c.client_id !== client || c.redirect_uri !== p.get("redirect_uri") || c.resource !== this.resource || c.challenge !== pkce(verifier)) fail("invalid_grant");
      const session = await unseal(this.key, c.sealed, this.now());
      if (!session || session.uid !== c.uid || !isLoginAllowed(this.config, session.login)) fail("invalid_grant");
      const response = this.db.transaction(() => {
        if (!this.db.query("DELETE FROM mcp_oauth_codes WHERE hash = ? AND expires > ?").run(c.hash, this.now()).changes) fail("invalid_grant");
        if (this.count("mcp_oauth_grants") >= MAX_TRANSIENT) fail("temporarily_unavailable", 429);
        const grantId = random(); const end = Math.min(this.now() + REFRESH_MS, session.rexp);
        this.db.query("INSERT INTO mcp_oauth_accounts (uid, sealed, expires) VALUES (?, ?, ?) ON CONFLICT(uid) DO NOTHING").run(c.uid, c.sealed, session.rexp);
        this.db.query("INSERT INTO mcp_oauth_grants (id, uid, client_id, resource, expires) VALUES (?, ?, ?, ?, ?)").run(grantId, c.uid, client, this.resource, end);
        return this.mint(grantId, end);
      }).immediate();
      // Код мог ждать несколько минут: уже обновлённую браузером сессию
      // нельзя заменить его старым снимком. Общий адаптер сохраняет свежую.
      await this.sessions.cookieFor(session);
      return response;
    }
    if (type === "refresh_token") {
      const raw = p.get("refresh_token") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) fail("invalid_grant");
      const digest = hash(raw);
      const t = this.findToken("refresh_hash", digest);
      if (!t || t.refresh_exp <= this.now() || t.client_id !== client || t.resource !== this.resource) {
        const used = this.db.query<{ grant_id: string }, [string, string, string]>("SELECT grant_id FROM mcp_oauth_used_refresh WHERE hash = ? AND client_id = ? AND resource = ?").get(digest, client, this.resource);
        if (used) this.revokeGrant(used.grant_id);
        fail("invalid_grant");
      }
      if (!(await this.connection(`chatgpt:${t.uid}`))) fail("invalid_grant");
      return this.db.transaction(() => {
        // Проверка в транзакции нужна: параллельный refresh уже мог
        // потратить токен, пока обновлялась сессия GitHub.
        if (!this.findToken("refresh_hash", digest)) fail("invalid_grant");
        if (this.count("mcp_oauth_used_refresh") >= MAX_TRANSIENT) fail("temporarily_unavailable", 429);
        this.db.query("DELETE FROM mcp_oauth_tokens WHERE refresh_hash = ?").run(digest);
        this.db.query("INSERT INTO mcp_oauth_used_refresh (hash, grant_id, client_id, resource, expires) VALUES (?, ?, ?, ?, ?)").run(digest, t.grant_id, client, this.resource, t.refresh_exp);
        return this.mint(t.grant_id, t.refresh_exp);
      }).immediate();
    }
    fail("unsupported_grant_type");
  }
  private mint(grantId: string, end: number): Response {
    const access = random(); const refresh = random(); const accessEnd = Math.min(this.now() + ACCESS_MS, end);
    this.db.query("INSERT INTO mcp_oauth_tokens (access_hash, refresh_hash, grant_id, access_exp, refresh_exp) VALUES (?, ?, ?, ?, ?)").run(hash(access), hash(refresh), grantId, accessEnd, end);
    return json({ access_token: access, token_type: "Bearer", expires_in: Math.max(0, Math.floor((accessEnd - this.now()) / 1000)), refresh_token: refresh, scope: SCOPE });
  }
  private findToken(column: "access_hash" | "refresh_hash", digest: string): Token | null {
    return this.db.query<Token, [string, number, number]>(`SELECT t.*, g.uid, g.client_id, g.resource FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id JOIN mcp_oauth_clients c ON c.id = g.client_id WHERE t.${column} = ? AND g.expires > ? AND c.expires > ?`).get(digest, this.now(), this.now());
  }
  private revokeGrant(id: string): void {
    this.db.transaction(() => {
      this.db.query("DELETE FROM mcp_oauth_tokens WHERE grant_id = ?").run(id);
      this.db.query("DELETE FROM mcp_oauth_used_refresh WHERE grant_id = ?").run(id);
      this.db.query("DELETE FROM mcp_oauth_grants WHERE id = ?").run(id);
    }).immediate();
  }
  private async revoke(req: Request): Promise<Response> {
    const p = await form(req); const client = p.get("client_id") ?? "";
    if (!this.client(client) || req.headers.has("authorization")) fail("invalid_client");
    const raw = p.get("token") ?? "";
    if (!raw || raw.length > 512) fail();
    const t = this.findToken("refresh_hash", hash(raw)) ?? this.findToken("access_hash", hash(raw));
    if (t?.client_id === client) this.revokeGrant(t.grant_id);
    return json({});
  }

  async principal(req: Request): Promise<McpPrincipal | null> {
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    if (!bearer) return null;
    const token = this.findToken("access_hash", hash(bearer));
    if (!token || token.access_exp <= this.now() || token.resource !== this.resource) return null;
    const connection = await this.connection(`chatgpt:${token.uid}`);
    // Отзыв, произошедший во время сетевого обновления GitHub, действует
    // уже на этот запрос, а не только на следующий.
    return this.findToken("access_hash", hash(bearer)) && token.access_exp > this.now() ? connection : null;
  }
  async connection(connectionId: string): Promise<McpPrincipal | null> {
    const uid = this.connectionUid(connectionId); if (uid === null || !this.hasGrant(uid)) return null;
    const account = this.db.query<{ sealed: string }, [number]>("SELECT sealed FROM mcp_oauth_accounts WHERE uid = ?").get(uid);
    if (!account) return null;
    const initial = await unseal(this.key, account.sealed, this.now());
    if (!initial || initial.uid !== uid || !isLoginAllowed(this.config, initial.login)) return null;
    const current = await this.sessions.read(new Request(this.resource, { headers: { Cookie: `${this.sessions.cookieName}=${account.sealed}` } }));
    if (!current || current.session.uid !== uid || !isLoginAllowed(this.config, current.session.login) || !this.hasGrant(uid)) return null;
    return this.hasGrant(uid) ? { session: current.session, connectionId } : null;
  }
  private connectionUid(id: string): number | null {
    const match = /^chatgpt:([1-9]\d{0,15})$/.exec(id); const uid = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(uid) ? uid : null;
  }
  private hasGrant(uid: number): boolean {
    return !!this.db.query("SELECT 1 FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id = g.client_id WHERE g.uid = ? AND g.resource = ? AND g.expires > ? AND c.expires > ? LIMIT 1").get(uid, this.resource, this.now(), this.now());
  }
  hasAuthorization(connectionId: string, hostname: string): boolean {
    const uid = this.connectionUid(connectionId);
    if (uid === null) return false;
    const clients = this.db
      .query<
        { redirects: string },
        [number, string, number, number]
      >("SELECT c.redirects FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id = g.client_id WHERE g.uid = ? AND g.resource = ? AND g.expires > ? AND c.expires > ?")
      .all(uid, this.resource, this.now(), this.now());
    return clients.some((client) =>
      (JSON.parse(client.redirects) as string[]).some(
        (uri) => new URL(uri).hostname === hostname,
      ),
    );
  }
  async disconnect(connectionId: string): Promise<void> {
    const uid = this.connectionUid(connectionId); if (uid === null) return;
    this.db.transaction(() => {
      this.db.query("DELETE FROM mcp_oauth_tokens WHERE grant_id IN (SELECT id FROM mcp_oauth_grants WHERE uid = ?)").run(uid);
      this.db.query("DELETE FROM mcp_oauth_used_refresh WHERE grant_id IN (SELECT id FROM mcp_oauth_grants WHERE uid = ?)").run(uid);
      this.db.query("DELETE FROM mcp_oauth_grants WHERE uid = ?").run(uid);
      this.db.query("DELETE FROM mcp_oauth_codes WHERE uid = ?").run(uid);
      this.db.query("DELETE FROM mcp_oauth_consents WHERE uid = ?").run(uid);
    }).immediate();
  }
}
