import type { ForkPoint } from "@chat0110/chat-protocol";

// Связи Fork «ребёнок → родитель» для дерева и списка чатов. Данные приходят
// из тела PR, их пишут и агенты, поэтому не доверяем: родителя может не быть
// (PR удалён, нет доступа) или ссылки могут замкнуться в петлю.

export interface ForestChat {
  chat_id: string;
  created_at: string;
  parent: ForkPoint | null;
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Старший чат первым: он скорее всего и есть настоящий корень. */
export function olderFirst(a: ForestChat, b: ForestChat): number {
  return time(a.created_at) - time(b.created_at) || (a.chat_id < b.chat_id ? -1 : a.chat_id > b.chat_id ? 1 : 0);
}

/**
 * Map ребёнок → родитель только для родителей, которые есть в списке.
 * Сирота становится корнем; петля разрывается у самого старого чата в ней.
 */
export function forkParents(chats: readonly ForestChat[]): Map<string, string> {
  const ids = new Set(chats.map((c) => c.chat_id));
  const parent = new Map<string, string>();
  for (const c of chats) {
    const p = c.parent?.chat_id;
    if (p && p !== c.chat_id && ids.has(p) && !parent.has(c.chat_id)) parent.set(c.chat_id, p);
  }

  const byId = new Map(chats.map((c) => [c.chat_id, c] as const));
  const state = new Map<string, "walking" | "done">();
  for (const c of [...chats].sort(olderFirst)) {
    const path: string[] = [];
    let cur: string | undefined = c.chat_id;
    while (cur !== undefined && !state.has(cur)) {
      state.set(cur, "walking");
      path.push(cur);
      cur = parent.get(cur);
    }
    if (cur !== undefined && state.get(cur) === "walking") {
      const loop = path.slice(path.indexOf(cur)).map((id) => byId.get(id)!);
      parent.delete(loop.sort(olderFirst)[0]!.chat_id);
    }
    for (const id of path) state.set(id, "done");
  }
  return parent;
}
