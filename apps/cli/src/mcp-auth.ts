import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, fstatSync, lstatSync, renameSync, unlinkSync, constants } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function mcpOrigin(value: string): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/" ||
      !(u.origin === "https://chat.0110.digital" || (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))))
    throw Error("Разрешён только CHAT.0110 или локальный тестовый сервер.");
  return u.origin;
}
type Saved = { origin: string; client: string; access: string; refresh: string; expires: number };
const random = () => randomBytes(32).toString("base64url");

/** Наш OAuth-токен остаётся у клиента; токен GitHub сюда не передаётся. */
export class McpCredentials {
  readonly origin: string;
  constructor(readonly file: string, origin: string, private fetcher: typeof fetch = fetch) { this.origin = mcpOrigin(origin); }
  private read(): Saved | null {
    let fd: number;
    try { fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e: any) { if (e.code === "ENOENT") return null; throw Error("Не удалось безопасно прочитать авторизацию MCP."); }
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > 16384 || (process.platform !== "win32" && ((st.mode & 0o077) || st.uid !== process.getuid?.())))
        throw Error("Файл авторизации MCP должен быть приватным обычным файлом (600).");
      const data = JSON.parse(readFileSync(fd, "utf8"));
      if (data.origin !== this.origin || ![data.client, data.access, data.refresh].every(v => typeof v === "string" && v.length > 0 && v.length < 1024) || !Number.isFinite(data.expires))
        throw Error("Файл авторизации не принадлежит этому серверу MCP.");
      return data;
    } finally { closeSync(fd); }
  }
  private save(data: Saved) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${random()}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    renameSync(tmp, this.file);
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`, nonce = random(), end = Date.now() + 15_000;
    while (true) {
      try { writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce }), { flag: "wx", mode: 0o600 }); break; }
      catch (e: any) {
        if (e.code !== "EEXIST") throw e;
        try {
          const st = lstatSync(lock);
          if (st.isSymbolicLink() || st.size > 1024) throw Error("Некорректная блокировка OAuth.");
          const old = JSON.parse(readFileSync(lock, "utf8"));
          if (!Number.isInteger(old.pid) || old.pid <= 0) throw Error("Некорректная блокировка OAuth.");
          try { process.kill(old.pid, 0); }
          catch (err: any) { if (err.code === "ESRCH" && lstatSync(lock).ino === st.ino) unlinkSync(lock); }
        } catch (err: any) { if (err.code !== "ENOENT") throw err; }
        if (Date.now() >= end) throw Error("Авторизация уже обновляется в другом процессе. Повтори подключение.");
        await delay(50);
      }
    }
    try { return await fn(); }
    finally { try { if (JSON.parse(readFileSync(lock, "utf8")).nonce === nonce) unlinkSync(lock); } catch (e: any) { if (e.code !== "ENOENT") throw e; } }
  }
  private async post(path: string, body: Record<string, string> | { redirect_uris: string[]; client_name: string; token_endpoint_auth_method: string }) {
    const registration = path === "/oauth/register";
    const response = await this.fetcher(this.origin + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": registration ? "application/json" : "application/x-www-form-urlencoded" },
      body: registration ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>).toString(),
    });
    if (!response.ok) throw Error(`Авторизация MCP отклонена (HTTP ${response.status}). Выполни setup повторно.`);
    const text = await response.text();
    if (text.length > 16384) throw Error("Некорректный ответ OAuth.");
    return JSON.parse(text);
  }
  private storeTokens(client: string, value: any) {
    if (value.token_type?.toLowerCase() !== "bearer" || ![value.access_token, value.refresh_token].every(v => typeof v === "string" && v.length > 0 && v.length < 1024) || !Number.isFinite(value.expires_in) || value.expires_in <= 0)
      throw Error("Некорректный ответ OAuth.");
    this.save({ origin: this.origin, client, access: value.access_token, refresh: value.refresh_token, expires: Date.now() + value.expires_in * 1000 });
    return value.access_token as string;
  }
  async token(rejected?: string): Promise<string> {
    const cached = this.read();
    if (!cached) throw Error("MCP ещё не авторизован. Сначала выполни команду setup.");
    if (cached.expires > Date.now() + 60_000 && cached.access !== rejected) return cached.access;
    // Refresh rotation одноразовая: два MCP-процесса не должны отзывать друг друга.
    return this.locked(async () => {
      const current = this.read()!;
      if (current.expires > Date.now() + 60_000 && current.access !== rejected) return current.access;
      return this.storeTokens(current.client, await this.post("/oauth/token", {
        grant_type: "refresh_token", client_id: current.client, refresh_token: current.refresh, resource: this.origin + "/mcp",
      }));
    });
  }
  async login(showUrl: (url: URL) => void | Promise<void>, timeoutMs = 300_000): Promise<void> {
    try { const old = this.read(); if (old) { await this.token(old.access); return; } }
    catch { /* Проверяем grant обновлением: отозванный, но ещё не истёкший токен не означает готовый вход. */ }
    await this.locked(async () => {
      const state = random(), verifier = random();
      let resolveCode!: (code: string) => void, rejectCode!: (error: Error) => void;
      const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
      // Catch прикреплён до первого await: ошибка/таймаут не становятся unhandled.
      void code.catch(() => {});
      const server = createServer((req, res) => {
        let u: URL;
        try { u = new URL(req.url ?? "/", "http://127.0.0.1"); } catch { res.writeHead(400); res.end(); return; }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        if (req.method !== "GET" || u.pathname !== "/callback" || u.searchParams.getAll("state").length !== 1 || u.searchParams.get("state") !== state) { res.writeHead(400); res.end("Некорректный callback"); return; }
        if (u.searchParams.getAll("iss").length !== 1 || u.searchParams.get("iss") !== this.origin) { res.writeHead(400); res.end("Некорректный issuer"); return; }
        if (u.searchParams.has("error")) { res.writeHead(400); res.end("Подключение отменено"); rejectCode(Error("Подключение отменено владельцем.")); return; }
        const value = u.searchParams.get("code");
        if (!value || u.searchParams.getAll("code").length !== 1 || value.length > 512) { res.writeHead(400); res.end("Нет кода авторизации"); return; }
        res.end("Разрешение получено. Результат подключения появится в терминале."); resolveCode(value);
      });
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const timer = setTimeout(() => rejectCode(Error("Время подтверждения OAuth истекло. Повтори setup.")), timeoutMs);
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw Error("Не удалось открыть loopback callback.");
        const redirect = `http://127.0.0.1:${address.port}/callback`;
        const registered = await this.post("/oauth/register", { redirect_uris: [redirect], client_name: "CHAT.0110 local MCP", token_endpoint_auth_method: "none" });
        if (typeof registered.client_id !== "string" || !registered.client_id || registered.client_id.length > 1024) throw Error("Некорректный OAuth client id.");
        const url = new URL(this.origin + "/oauth/authorize");
        url.search = new URLSearchParams({ response_type: "code", client_id: registered.client_id, redirect_uri: redirect, scope: "chat:agent", resource: this.origin + "/mcp", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
        await showUrl(url);
        this.storeTokens(registered.client_id, await this.post("/oauth/token", { grant_type: "authorization_code", client_id: registered.client_id, redirect_uri: redirect, code: await code, code_verifier: verifier, resource: this.origin + "/mcp" }));
      } finally { clearTimeout(timer); server.close(); server.closeAllConnections(); }
    });
  }
}
