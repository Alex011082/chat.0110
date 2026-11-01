// Живая проверка без публикаций: действующая сессия остаётся только в памяти.
// Скрипт копируется на сервер и запускается с env существующего приложения.
import { Database } from "bun:sqlite";
import { loadConfig } from "/opt/chat0110/current/apps/api/src/config.ts";
import { importCookieKey, unseal, SessionStore } from "/opt/chat0110/current/apps/api/src/session.ts";
import { GitHubClient } from "/opt/chat0110/current/apps/api/src/github.ts";
import { getTimeline } from "/opt/chat0110/current/apps/api/src/chats.ts";
import { Privacy } from "/opt/chat0110/current/apps/api/src/privacy.ts";
import { SqlitePrivacyCache } from "/opt/chat0110/current/apps/api/src/privacy-cache.ts";

const [repo, chat, uidText, mode = "http"] = process.argv.slice(2);
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !chat || !/^\d{8}-[a-z0-9]{4}$/.test(chat) || !uidText || !/^\d+$/.test(uidText) || !["http", "offline"].includes(mode)) throw Error("Нужны repo chat uid [http|offline]");
const uid = Number(uidText);
const config = loadConfig({ ...process.env, CHAT0110_PUBLIC_URL: "https://chat.0110.digital" });
const db = new Database("/var/lib/chat0110/dispatch.sqlite");
if (!db.query("SELECT 1 FROM mcp_oauth_grants WHERE uid=? AND expires>? LIMIT 1").get(uid, Date.now())) throw Error("Нет действующего подключения");
const key = await importCookieKey(config.cookieKey);
async function account() {
  const row = db.query<{ sealed: string }, [number]>("SELECT sealed FROM mcp_oauth_accounts WHERE uid=?").get(uid);
  const result = row && await unseal(key, row.sealed, Date.now());
  if (!result || result.uid !== uid) throw Error("Нет действующей сессии");
  return result;
}
let session = await account();
const sessions = new SessionStore({ key, dev: false, clientId: config.clientId, clientSecret: config.clientSecret });
let cookie = (await sessions.cookieFor(session)).split(";")[0]!;
if (session.exp < Date.now() + 120_000) {
  // Обновление выполняет работающий сервер, чтобы не конкурировать за одноразовый refresh.
  const me = await fetch(config.publicUrl + "/api/me", { headers: { Cookie: cookie } });
  if (!me.ok) throw Error(`Требуется вход владельца: HTTP ${me.status}`);
  session = await account();
  cookie = (await sessions.cookieFor(session)).split(";")[0]!;
}
const started = performance.now();
if (mode === "http") {
  const response = await fetch(config.publicUrl + `/api/chats/${repo}/${chat}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(235_000) });
  if (!response.ok) throw Error(`API: HTTP ${response.status}`);
  const body = await response.json() as { items: unknown[] };
  console.log(JSON.stringify({ mode, status: response.status, ms: Math.round(performance.now() - started), items: body.items.length }));
} else {
  let scans = 0;
  const privacy = new Privacy(async () => { scans++; throw Error("Модель намеренно отключена в проверке"); }, new SqlitePrivacyCache(db, config.cookieKey));
  const [owner, name] = repo.split("/");
  const timeline = await getTimeline(new GitHubClient({ token: session.at, userId: uid }), { owner: owner!, name: name! }, chat, privacy);
  console.log(JSON.stringify({ mode, ms: Math.round(performance.now() - started), items: timeline.items.length, model_calls: scans }));
}
db.close();
