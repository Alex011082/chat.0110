import { canonicalMention, resolveMention, isAuthor, newMessageId } from "@chat0110/chat-protocol";
import { Database } from "bun:sqlite";
import { randomUUID, createHash } from "node:crypto";
import type { AgentSession, DispatchChain, DispatchView } from "@chat0110/chat-protocol";
import { badRequest, forbidden, HttpError, notFound } from "./errors.ts";

export interface SessionRow {
  id: string;
  uid: number;
  repo: string;
  chat: string;
  external: string;
  alias: string;
  name: string;
  author: string;
  model: string;
  seen: number;
  auto_enabled: number;
  auto_generation: number;
}
export interface Task {
  id: string;
  chain_id: string;
  session_id: string;
  step: number;
  status: string;
  claim: string | null;
  reply_to: string;
  answer_id: string;
  text: string | null;
  started: number | null;
  outcome: string | null;
}
interface ChainRow {
  id: string;
  uid: number;
  repo: string;
  chat: string;
  message_id: string;
  prompt: string;
  route: string;
  step: number;
  status: DispatchChain["status"];
  expires_at: number;
}

/** SQLite хранит доставку и блокировки; сообщения по-прежнему хранятся в Git. */
export class DispatchStore {
  private db: Database;
  private waiters = new Map<string, number>();
  constructor(path: string | Database) {
    this.db = typeof path === "string" ? new Database(path, { create: true }) : path;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS publications (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, message_id TEXT NOT NULL, author TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, external TEXT NOT NULL, alias TEXT NOT NULL, name TEXT NOT NULL, author TEXT NOT NULL, model TEXT NOT NULL, seen INTEGER NOT NULL, UNIQUE(uid,repo,chat,external), UNIQUE(uid,repo,chat,alias));
      CREATE TABLE IF NOT EXISTS chains (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, message_id TEXT NOT NULL, prompt TEXT NOT NULL, route TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, chain_id TEXT NOT NULL, session_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, claim TEXT, reply_to TEXT NOT NULL, answer_id TEXT NOT NULL, text TEXT, started INTEGER, UNIQUE(chain_id,step));`);
    if (!this.db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().some(column => column.name === "auto_enabled"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN auto_enabled INTEGER NOT NULL DEFAULT 1");
    if (!this.db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().some(column => column.name === "auto_generation"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN auto_generation INTEGER NOT NULL DEFAULT 0");
    // Отдельная таблица сохраняет совместимость старого INSERT INTO chains VALUES при откате.
    this.db.exec("CREATE TABLE IF NOT EXISTS chain_limits (chain_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
    this.db.query("INSERT OR IGNORE INTO chain_limits SELECT id,? FROM chains").run(Date.now() + 15 * 60_000);
    if (!this.db.query<{ name: string }, []>("PRAGMA table_info(tasks)").all().some(column => column.name === "outcome"))
      this.db.exec("ALTER TABLE tasks ADD COLUMN outcome TEXT");
  }
  preparePublication(requestId: string, uid: number, repo: string, chat: string, author: string, text: string, replyTo: unknown, legacyId?: string): { id: string; author: string } {
    if (!isAuthor(author)) throw badRequest("Логин не подходит как автор сообщения");
    const id = `${uid}:${requestId}`;
    // Только отпечаток уже очищенного содержимого. Исходник здесь не хранится.
    const fingerprint = createHash("sha256").update(JSON.stringify([repo.toLowerCase(), chat, text, replyTo || null])).digest("hex");
    return this.db.transaction(() => {
      const old = this.db.query<{ fingerprint: string; message_id: string; author: string }, [string]>("SELECT * FROM publications WHERE request_id=?").get(id);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new HttpError(409, "conflict", "Повтор запроса с другим содержимым");
        return { id: old.message_id, author: old.author };
      }
      const messageId = legacyId ?? newMessageId(new Date(), author);
      this.db.query("INSERT INTO publications VALUES (?,?,?,?)").run(id, fingerprint, messageId, author);
      return { id: messageId, author };
    })();
  }
  ensureCloud(uid:number,repo:string,chat:string):SessionRow {
    const external=`cloud:chatgpt:${uid}`;
    const old=this.db.query<SessionRow,[number,string,string,string]>("SELECT * FROM sessions WHERE uid=? AND repo=? AND chat=? AND external=?").get(uid,repo.toLowerCase(),chat,external);
    if(old)return old;
    const created=this.register(uid,repo,chat,external,"chatgpt-cloud","ChatGPT","chatgpt");
    this.db.query("UPDATE sessions SET seen=0,auto_enabled=0 WHERE id=?").run(created.id);
    return {...created,seen:0,auto_enabled:0};
  }
  cloudTasks():Array<Task & {uid:number;repo:string;chat:string;prompt:string;auto_generation:number}> {
    this.expire();
    return this.db.query<Task & {uid:number;repo:string;chat:string;prompt:string;auto_generation:number},[]>(`SELECT t.*, c.uid,c.repo,c.chat,c.prompt,s.auto_generation FROM tasks t JOIN chains c ON c.id=t.chain_id JOIN sessions s ON s.id=t.session_id
      WHERE t.status='waiting' AND s.auto_enabled=1 AND s.external LIKE 'cloud:chatgpt:%' AND NOT EXISTS(SELECT 1 FROM tasks busy WHERE busy.session_id=t.session_id AND busy.status IN ('running','interrupted'))
      AND t.rowid=(SELECT MIN(first.rowid) FROM tasks first WHERE first.session_id=t.session_id AND first.status='waiting') ORDER BY t.rowid LIMIT 100`).all();
  }
  remoteReady(uid:number,author:string,sessionId:string|null=null):Array<{id:string;repo:string;chat:string}> {
    this.expire();
    return this.db.query<{id:string;repo:string;chat:string},[number,string,string|null,string|null]>(`SELECT t.id,c.repo,c.chat FROM tasks t JOIN chains c ON c.id=t.chain_id JOIN sessions s ON s.id=t.session_id WHERE c.uid=? AND s.author=? AND s.auto_enabled=1 AND (? IS NULL OR s.id=?) AND (s.external LIKE 'remote:%' OR s.external LIKE 'cloud:%') AND t.status='waiting' AND NOT EXISTS(SELECT 1 FROM tasks b WHERE b.session_id=t.session_id AND b.status IN ('running','interrupted')) ORDER BY t.rowid LIMIT 30`).all(uid,author,sessionId,sessionId);
  }
  ownedTask(id:string,uid:number,allowStopped=false):Task & {repo:string;chat:string;prompt:string;author:string;external:string;uid:number} {
    this.expire();
    const t=this.db.query<Task & {repo:string;chat:string;prompt:string;author:string;external:string;uid:number},[string,number]>(`SELECT t.*,c.uid,c.repo,c.chat,c.prompt,s.author,s.external FROM tasks t JOIN chains c ON c.id=t.chain_id JOIN sessions s ON s.id=t.session_id WHERE t.id=? AND c.uid=?`).get(id,uid);
    if(!t)throw notFound("Ход не найден");
    if(!allowStopped && ['cancelled','expired'].includes(t.status))throw new HttpError(409,"dispatch_cancelled","Цепочка остановлена или её срок истёк");
    return t;
  }
  close() {
    this.db.close();
  }
  register(
    uid: number,
    repo: string,
    chat: string,
    external: string,
    alias: string,
    name: string,
    author = alias,
    model = "",
  ): SessionRow {
    repo = repo.toLowerCase();
    alias = alias.toLowerCase();
    author = canonicalMention(author);
    model = canonicalMention(model);
    if (
      !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u.test(alias) ||
      !isAuthor(author) ||
      !external ||
      external.length > 150 ||
      !name.trim() ||
      name.length > 80 ||
      model.length > 80
    )
      throw badRequest("Неверные параметры участника");
    const old = this.db
      .query<
        SessionRow,
        [number, string, string, string]
      >("SELECT * FROM sessions WHERE uid=? AND repo=? AND chat=? AND external=?")
      .get(uid, repo, chat, external);
    if (old) {
      this.touch(old.id);
      return this.session(old.id, uid);
    }
    const collision = this.db
      .query("SELECT id FROM sessions WHERE uid=? AND repo=? AND chat=? AND alias=?")
      .get(uid, repo, chat, alias);
    if (collision) throw new HttpError(409, "conflict", "Это имя уже занято другой сессией");
    const id = randomUUID();
    this.db
      .query("INSERT INTO sessions (id,uid,repo,chat,external,alias,name,author,model,seen) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, uid, repo, chat, external, alias, name, author, model, Date.now());
    return this.session(id, uid);
  }
  session(id: string, uid: number): SessionRow {
    const s = this.db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id=?").get(id);
    if (!s || s.uid !== uid) throw notFound("Сессия не найдена");
    return s;
  }
  touch(id: string) {
    this.db.query("UPDATE sessions SET seen=? WHERE id=?").run(Date.now(), id);
  }
  waiting(id: string, uid: number, author?: string): () => void {
    try {
      const session = this.session(id, uid);
      if (author && session.author !== author) return () => {};
    } catch { return () => {}; }
    this.touch(id);
    this.waiters.set(id, (this.waiters.get(id) ?? 0) + 1);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const count = (this.waiters.get(id) ?? 1) - 1;
      if (count) this.waiters.set(id, count); else this.waiters.delete(id);
    };
  }
  setAutoEnabled(uid: number, sessionId: string, enabled: boolean) {
    this.session(sessionId, uid);
    this.db.transaction(() => {
      this.db.query("UPDATE sessions SET auto_generation=auto_generation+CASE WHEN auto_enabled!=? THEN 1 ELSE 0 END,auto_enabled=? WHERE id=?").run(enabled ? 1 : 0, enabled ? 1 : 0, sessionId);
      if (!enabled) {
        const active=this.db.query<ChainRow,[number]>("SELECT * FROM chains WHERE uid=? AND status IN ('preparing','waiting','running','interrupted')").all(uid);
        for (const chain of active) if (JSON.parse(chain.route).includes(sessionId)) this.cancel(uid,chain.id);
      }
    })();
  }
  resolve(uid: number, repo: string, chat: string, aliases: string[]): string[] {
    const sessions = this.db
      .query<SessionRow, [number, string, string]>("SELECT * FROM sessions WHERE uid=? AND repo=? AND chat=?")
      .all(uid, repo.toLowerCase(), chat);
    let route: string[];
    try {
      route = aliases.map((alias) => resolveMention(alias, sessions));
    } catch (error) {
      throw badRequest(
        error instanceof Error && error.message === "ambiguous"
          ? "Обращение подходит нескольким сессиям. Выбери точное имя из списка."
          : "Участник не подключён к этому чату",
      );
    }
    if (route.length > 1 && route[0] === route[1]) throw badRequest("Для обсуждения нужны две разные сессии");
    return route;
  }

  chain(id: string, uid: number): ChainRow | null {
    this.expire();
    const row = this.db.query<ChainRow, [string]>("SELECT c.*,l.expires_at FROM chains c LEFT JOIN chain_limits l ON l.chain_id=c.id WHERE c.id=?").get(id);
    if (row && row.uid !== uid) throw forbidden("Чужая цепочка");
    return row;
  }
  enqueue(
    id: string,
    uid: number,
    repo: string,
    chat: string,
    message: string,
    prompt: string,
    route: string[],
    preparing = false,
  ) {
    this.db.transaction(() => {
      const old = this.chain(id, uid);
      if (old) {
        if (
          old.repo !== repo.toLowerCase() ||
          old.chat !== chat ||
          old.prompt !== prompt ||
          old.route !== JSON.stringify(route)
        )
          throw new HttpError(409, "conflict", "Повтор запроса с другим содержимым");
        return;
      }
      this.db
        .query("INSERT INTO chains (id,uid,repo,chat,message_id,prompt,route,step,status) VALUES (?,?,?,?,?,?,?,0,?)")
        .run(
          id,
          uid,
          repo.toLowerCase(),
          chat,
          message,
          prompt,
          JSON.stringify(route),
          preparing ? "preparing" : "waiting",
        );
      this.db.query("INSERT INTO chain_limits VALUES (?,?)").run(id,Date.now() + 15 * 60_000);
      if (!preparing) this.addTask(id, route[0]!, 0, message);
    })();
  }
  activate(id: string, uid: number) {
    this.db.transaction(() => {
      const c = this.chain(id, uid);
      if (!c || c.status !== "preparing") return;
      this.db.query("UPDATE chains SET status='waiting' WHERE id=?").run(id);
      this.addTask(id, JSON.parse(c.route)[0], 0, c.message_id);
    })();
  }
  private addTask(chain: string, session: string, step: number, replyTo: string) {
    const s = this.db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id=?").get(session)!;
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 4);
    this.db
      .query(
        "INSERT OR IGNORE INTO tasks (id,chain_id,session_id,step,status,reply_to,answer_id) VALUES (?,?,?,?,'waiting',?,?)",
      )
      .run(randomUUID(), chain, session, step, replyTo, `${stamp}-${s.author}-${suffix}`);
  }
  private expire() {
    this.db.query("UPDATE chains SET status='expired' WHERE id IN (SELECT chain_id FROM chain_limits WHERE expires_at<=?) AND status IN ('preparing','waiting','running','interrupted')").run(Date.now());
    // Старый сервер тоже отвергнет поздний claim после отката, хотя не знает новый статус цепочки.
    this.db.exec("UPDATE tasks SET status='cancelled' WHERE status IN ('waiting','running','interrupted') AND chain_id IN (SELECT id FROM chains WHERE status='expired')");
    // Потерянный ход остаётся у того же исполнителя, чтобы не повторить внешнее действие.
    const stale = Date.now() - 120_000;
    this.db
      .query(
        "UPDATE chains SET status='interrupted' WHERE id IN (SELECT chain_id FROM tasks WHERE status='running' AND started < ?)",
      )
      .run(stale);
    this.db.query("UPDATE tasks SET status='interrupted' WHERE status='running' AND started < ?").run(stale);
  }
  claim(sessionId: string, expectedId?: string): Task | null {
    return this.db.transaction(() => {
      this.expire();
      const session = this.db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id=?").get(sessionId);
      if (!session?.auto_enabled) return null;
      const busy = this.db
        .query("SELECT id FROM tasks WHERE session_id=? AND status IN ('running','interrupted')")
        .get(sessionId);
      if (busy) return null;
      const t = this.db
        .query<Task, [string]>("SELECT * FROM tasks WHERE session_id=? AND status='waiting' ORDER BY rowid LIMIT 1")
        .get(sessionId);
      if (!t || (expectedId && t.id !== expectedId)) return null;
      const claim = randomUUID();
      this.db.query("UPDATE tasks SET status='running',claim=?,started=? WHERE id=?").run(claim, Date.now(), t.id);
      this.db.query("UPDATE chains SET status='running' WHERE id=?").run(t.chain_id);
      return { ...t, status: "running", claim };
    })();
  }
  task(id: string, session: string, claim: string, allowStopped = false): Task {
    this.expire();
    const t = this.db.query<Task, [string]>("SELECT * FROM tasks WHERE id=?").get(id);
    if (!t || t.session_id !== session || t.claim !== claim) throw forbidden("Неверный исполнитель хода");
    if (!allowStopped && ["cancelled", "expired"].includes(t.status)) throw new HttpError(409, "dispatch_cancelled", "Цепочка остановлена или её срок истёк");
    return t;
  }
  heartbeat(id: string, session: string, claim: string) {
    const t = this.task(id, session, claim);
    if (!["running", "interrupted"].includes(t.status)) return;
    this.db.query("UPDATE tasks SET started=?,status='running' WHERE id=?").run(Date.now(), id);
    this.db.query("UPDATE chains SET status='running' WHERE id=?").run(t.chain_id);
  }
  prepareAnswer(id: string, session: string, claim: string, text: string, outcome = "continue"): Task {
    if (!["continue", "complete", "needs_owner"].includes(outcome)) throw badRequest("Неверный результат хода");
    const t = this.task(id, session, claim, true);
    if (t.text !== null && (t.text !== text || (t.outcome ?? "continue") !== outcome))
      throw new HttpError(409, "conflict", "Ответ уже зафиксирован с другим текстом");
    this.db.query("UPDATE tasks SET text=?,outcome=? WHERE id=?").run(text, outcome, id);
    return t;
  }
  finish(id: string, claim: string, answerId: string) {
    this.db.transaction(() => {
      this.expire();
      const t = this.db.query<Task, [string]>("SELECT * FROM tasks WHERE id=?").get(id);
      if (!t || t.claim !== claim) throw forbidden("Неверный исполнитель хода");
      if (t.status === "done") return;
      const c = this.db.query<ChainRow, [string]>("SELECT * FROM chains WHERE id=?").get(t.chain_id)!;
      // Поздний опубликованный ответ сохраняется, но не оживляет остановленную цепочку.
      if (["cancelled", "expired", "needs_owner"].includes(c.status)) {
        if (t.text === null) throw new HttpError(409, "dispatch_cancelled", "Цепочка остановлена");
        this.db.query("UPDATE tasks SET status='done' WHERE id=?").run(id);
        return;
      }
      const route: string[] = JSON.parse(c.route);
      const next = t.step + 1;
      this.db.query("UPDATE tasks SET status='done' WHERE id=?").run(id);
      this.db
        .query("UPDATE chains SET step=?,status=? WHERE id=?")
        .run(next, t.outcome === "needs_owner" ? "needs_owner" : t.outcome === "complete" || next >= route.length ? "done" : "waiting", c.id);
      if ((!t.outcome || t.outcome === "continue") && next < route.length) this.addTask(c.id, route[next]!, next, answerId);
    })();
  }
  cancel(uid: number, id: string) {
    const c = this.chain(id, uid);
    if (!c) throw notFound("Цепочка не найдена");
    if (["done", "expired", "needs_owner"].includes(c.status)) return;
    this.db.transaction(() => {
      this.db.query("UPDATE chains SET status='cancelled' WHERE id=?").run(id);
      this.db.query("UPDATE tasks SET status='cancelled' WHERE chain_id=? AND status!='done'").run(id);
    })();
  }
  list(uid: number, repo: string, chat: string): DispatchView {
    this.expire();
    const sessions: AgentSession[] = this.db
      .query<SessionRow, [number, string, string]>(
        "SELECT * FROM sessions WHERE uid=? AND repo=? AND chat=? ORDER BY rowid",
      )
      .all(uid, repo.toLowerCase(), chat)
      .map((s) => ({
        id: s.id,
        alias: s.alias,
        name: s.name,
        author: s.author,
        model: s.model,
        online: Date.now() - s.seen < 90_000,
        auto_enabled: !!s.auto_enabled,
        delivery_ready: !!s.auto_enabled && (this.waiters.get(s.id) ?? 0) > 0,
      }));
    const chains: DispatchChain[] = this.db
      .query<ChainRow, [number, string, string]>(
        "SELECT c.*,l.expires_at FROM chains c LEFT JOIN chain_limits l ON l.chain_id=c.id WHERE c.uid=? AND c.repo=? AND c.chat=? ORDER BY c.rowid DESC LIMIT 50",
      )
      .all(uid, repo.toLowerCase(), chat)
      .map((c) => ({ id: c.id, message_id: c.message_id, route: JSON.parse(c.route), step: c.step, status: c.status, expires_at: c.expires_at }));
    return { sessions, chains };
  }
}
