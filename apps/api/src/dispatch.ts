import { canonicalMention, resolveMention, isAuthor } from "@chat0110/chat-protocol";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
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
}

/** SQLite хранит доставку и блокировки; сообщения по-прежнему хранятся в Git. */
export class DispatchStore {
  private db: Database;
  constructor(path: string | Database) {
    this.db = typeof path === "string" ? new Database(path, { create: true }) : path;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, external TEXT NOT NULL, alias TEXT NOT NULL, name TEXT NOT NULL, author TEXT NOT NULL, model TEXT NOT NULL, seen INTEGER NOT NULL, UNIQUE(uid,repo,chat,external), UNIQUE(uid,repo,chat,alias));
      CREATE TABLE IF NOT EXISTS chains (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, message_id TEXT NOT NULL, prompt TEXT NOT NULL, route TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, chain_id TEXT NOT NULL, session_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, claim TEXT, reply_to TEXT NOT NULL, answer_id TEXT NOT NULL, text TEXT, started INTEGER, UNIQUE(chain_id,step));`);
  }
  ensureCloud(uid:number,repo:string,chat:string):SessionRow {
    const external=`cloud:chatgpt:${uid}`;
    const old=this.db.query<SessionRow,[number,string,string,string]>("SELECT * FROM sessions WHERE uid=? AND repo=? AND chat=? AND external=?").get(uid,repo.toLowerCase(),chat,external);
    if(old)return old;
    const created=this.register(uid,repo,chat,external,"chatgpt-cloud","ChatGPT","chatgpt");
    this.db.query("UPDATE sessions SET seen=0 WHERE id=?").run(created.id);
    return {...created,seen:0};
  }
  cloudTasks():Array<Task & {uid:number;repo:string;chat:string;prompt:string}> {
    return this.db.query<Task & {uid:number;repo:string;chat:string;prompt:string},[]>(`SELECT t.*, c.uid,c.repo,c.chat,c.prompt FROM tasks t JOIN chains c ON c.id=t.chain_id JOIN sessions s ON s.id=t.session_id
      WHERE t.status='waiting' AND s.external LIKE 'cloud:chatgpt:%' AND NOT EXISTS(SELECT 1 FROM tasks busy WHERE busy.session_id=t.session_id AND busy.status IN ('running','interrupted'))
      AND t.rowid=(SELECT MIN(first.rowid) FROM tasks first WHERE first.session_id=t.session_id AND first.status='waiting') ORDER BY t.rowid LIMIT 100`).all();
  }
  remoteReady(uid:number,author:string,sessionId:string|null=null):Array<{id:string;repo:string;chat:string}> {
    return this.db.query<{id:string;repo:string;chat:string},[number,string,string|null,string|null]>(`SELECT t.id,c.repo,c.chat FROM tasks t JOIN chains c ON c.id=t.chain_id JOIN sessions s ON s.id=t.session_id WHERE c.uid=? AND s.author=? AND (? IS NULL OR s.id=?) AND (s.external LIKE 'remote:%' OR s.external LIKE 'cloud:%') AND t.status='waiting' AND NOT EXISTS(SELECT 1 FROM tasks b WHERE b.session_id=t.session_id AND b.status IN ('running','interrupted')) ORDER BY t.rowid LIMIT 30`).all(uid,author,sessionId,sessionId);
  }
  ownedTask(id:string,uid:number):Task & {repo:string;chat:string;prompt:string;author:string;external:string;uid:number} {
    const t=this.db.query<Task & {repo:string;chat:string;prompt:string;author:string;external:string;uid:number},[string,number]>(`SELECT t.*,c.uid,c.repo,c.chat,c.prompt,s.author,s.external FROM tasks t JOIN chains c ON c.id=t.chain_id JOIN sessions s ON s.id=t.session_id WHERE t.id=? AND c.uid=?`).get(id,uid);
    if(!t)throw notFound("Ход не найден");
    if(t.status==='cancelled')throw new HttpError(409,"dispatch_cancelled","Цепочка отменена");
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
      .query("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)")
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
    const row = this.db.query<ChainRow, [string]>("SELECT * FROM chains WHERE id=?").get(id);
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
        .query("INSERT INTO chains VALUES (?,?,?,?,?,?,?,0,?)")
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
  task(id: string, session: string, claim: string): Task {
    const t = this.db.query<Task, [string]>("SELECT * FROM tasks WHERE id=?").get(id);
    if (!t || t.session_id !== session || t.claim !== claim) throw forbidden("Неверный исполнитель хода");
    if (t.status === "cancelled") throw new HttpError(409, "dispatch_cancelled", "Цепочка отменена");
    return t;
  }
  heartbeat(id: string, session: string, claim: string) {
    const t = this.task(id, session, claim);
    if (!["running", "interrupted"].includes(t.status)) return;
    this.db.query("UPDATE tasks SET started=?,status='running' WHERE id=?").run(Date.now(), id);
    this.db.query("UPDATE chains SET status='running' WHERE id=?").run(t.chain_id);
  }
  prepareAnswer(id: string, session: string, claim: string, text: string): Task {
    const t = this.task(id, session, claim);
    if (t.text !== null && t.text !== text)
      throw new HttpError(409, "conflict", "Ответ уже зафиксирован с другим текстом");
    this.db.query("UPDATE tasks SET text=? WHERE id=?").run(text, id);
    return t;
  }
  finish(id: string, claim: string, answerId: string) {
    this.db.transaction(() => {
      const t = this.db.query<Task, [string]>("SELECT * FROM tasks WHERE id=?").get(id);
      if (!t || t.claim !== claim) throw forbidden("Неверный исполнитель хода");
      if (t.status === "done") return;
      if (t.status === "cancelled") throw new HttpError(409, "dispatch_cancelled", "Цепочка отменена");
      const c = this.db.query<ChainRow, [string]>("SELECT * FROM chains WHERE id=?").get(t.chain_id)!;
      const route: string[] = JSON.parse(c.route);
      const next = t.step + 1;
      this.db.query("UPDATE tasks SET status='done' WHERE id=?").run(id);
      this.db
        .query("UPDATE chains SET step=?,status=? WHERE id=?")
        .run(next, next < route.length ? "waiting" : "done", c.id);
      if (next < route.length) this.addTask(c.id, route[next]!, next, answerId);
    })();
  }
  cancel(uid: number, id: string) {
    const c = this.chain(id, uid);
    if (!c) throw notFound("Цепочка не найдена");
    if (c.status === "done") return;
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
      }));
    const chains: DispatchChain[] = this.db
      .query<ChainRow, [number, string, string]>(
        "SELECT * FROM chains WHERE uid=? AND repo=? AND chat=? ORDER BY rowid DESC LIMIT 50",
      )
      .all(uid, repo.toLowerCase(), chat)
      .map((c) => ({ id: c.id, message_id: c.message_id, route: JSON.parse(c.route), step: c.step, status: c.status }));
    return { sessions, chains };
  }
}
