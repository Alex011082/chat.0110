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
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, external TEXT NOT NULL, alias TEXT NOT NULL, name TEXT NOT NULL, author TEXT NOT NULL, model TEXT NOT NULL, seen INTEGER NOT NULL, UNIQUE(uid,repo,chat,external), UNIQUE(uid,repo,chat,alias));
      CREATE TABLE IF NOT EXISTS chains (id TEXT PRIMARY KEY, uid INTEGER NOT NULL, repo TEXT NOT NULL, chat TEXT NOT NULL, message_id TEXT NOT NULL, prompt TEXT NOT NULL, route TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, chain_id TEXT NOT NULL, session_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, claim TEXT, reply_to TEXT NOT NULL, answer_id TEXT NOT NULL, text TEXT, started INTEGER, UNIQUE(chain_id,step));`);
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
  claim(sessionId: string): Task | null {
    return this.db.transaction(() => {
      this.expire();
      const busy = this.db
        .query("SELECT id FROM tasks WHERE session_id=? AND status IN ('running','interrupted')")
        .get(sessionId);
      if (busy) return null;
      const t = this.db
        .query<Task, [string]>("SELECT * FROM tasks WHERE session_id=? AND status='waiting' ORDER BY rowid LIMIT 1")
        .get(sessionId);
      if (!t) return null;
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
