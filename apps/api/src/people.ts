// Кто входил в chat.0110. Позвать в чат можно только человека из этого
// списка. Храним то, что GitHub и так показывает всем: логин, имя, аватар.
// Запись обновляется при каждом входе и открытии приложения (/api/me).
import type { Database } from "bun:sqlite";
import type { Person } from "@chat0110/chat-protocol";

const LIMIT = 8;

export class People {
  constructor(private readonly db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS people (
      uid INTEGER PRIMARY KEY, login TEXT NOT NULL, login_lc TEXT NOT NULL,
      name TEXT, name_lc TEXT NOT NULL, avatar_url TEXT NOT NULL, seen_at INTEGER NOT NULL)`);
    db.exec("CREATE INDEX IF NOT EXISTS people_login ON people(login_lc)");
  }

  /** Ключ — id GitHub: после смены логина строка та же, логин новый. */
  remember(u: { id: number; login: string; name: string | null; avatar_url: string }, at: number): void {
    this.db
      .query(
        `INSERT INTO people (uid, login, login_lc, name, name_lc, avatar_url, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid) DO UPDATE SET login = excluded.login, login_lc = excluded.login_lc, name = excluded.name,
           name_lc = excluded.name_lc, avatar_url = excluded.avatar_url, seen_at = excluded.seen_at`,
      )
      .run(u.id, u.login, u.login.toLowerCase(), u.name, (u.name ?? "").toLowerCase(), u.avatar_url, at);
  }

  /**
   * Поиск по куску логина или имени, от двух знаков. Себя в выдаче нет.
   * Регистр сравниваем в JS: SQLite сам не опускает кириллицу.
   */
  search(query: string, opts: { except: number; allowed: (login: string) => boolean }): Person[] {
    const q = query.trim().replace(/^@/, "").toLowerCase();
    if (q.length < 2) return [];
    const rows = this.db
      .query<Person & { login_lc: string }, [number, string, string, string, string]>(
        `SELECT login, login_lc, name, avatar_url FROM people
         WHERE uid != ? AND (instr(login_lc, ?) > 0 OR instr(name_lc, ?) > 0)
         ORDER BY (instr(login_lc, ?) = 1 OR instr(name_lc, ?) = 1) DESC, seen_at DESC LIMIT 40`,
      )
      .all(opts.except, q, q, q, q);
    return rows
      .filter((r) => opts.allowed(r.login))
      .slice(0, LIMIT)
      .map((r) => ({ login: r.login, name: r.name, avatar_url: r.avatar_url }));
  }

  /** Последний вошедший с этим логином: логин мог перейти к другому аккаунту. */
  byLogin(login: string): Person | null {
    return (
      this.db
        .query<Person, [string]>("SELECT login, name, avatar_url FROM people WHERE login_lc = ? ORDER BY seen_at DESC LIMIT 1")
        .get(login.toLowerCase()) ?? null
    );
  }
}
