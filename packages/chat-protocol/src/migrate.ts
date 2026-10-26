// Перенос одного чата из chats/<id>/ в Chat/conversations/<id>/.
// Старые файлы не удаляются и не перезаписываются: расхождение — остановка.
import { isChatId, isDecisionPath, isMessagePath } from "./ids.ts";
import { planInit, parseProtocol, PROTOCOL_PATH } from "./layout.ts";

export interface MigrateFile {
  path: string;
  content: string;
}

export interface MigratePlan {
  /** В chats/<id>/ нет паспорта — переносить нечего. */
  absent: boolean;
  create: MigrateFile[];
  kept: string[];
  conflicts: string[];
  /** Файл внутри чата, который не паспорт, не сообщение и не решение. */
  ignored: string[];
  /** Chat/protocol.json есть, но это не схема 2. Ничего не пишем. */
  protocolInvalid: boolean;
}

/** Куда копировать файл схемы 1. Чужой чат и непонятный файл — null. */
export function migrateDest(chatId: string, legacyPath: string): string | null {
  const prefix = `chats/${chatId}/`;
  if (!isChatId(chatId) || !legacyPath.startsWith(prefix)) return null;
  const rest = legacyPath.slice(prefix.length);
  if (rest.split("/").some((p) => p === "" || p === "." || p === "..")) return null;
  if (rest === "chat.json") return `Chat/conversations/${chatId}/chat.json`;
  if (isMessagePath(chatId, legacyPath, 1) || isDecisionPath(chatId, legacyPath, 1)) {
    return `Chat/conversations/${chatId}/${rest}`;
  }
  return null;
}

/**
 * Что дописать, чтобы чат читался из Chat/. Байты паспорта и сообщений
 * копируются как есть. При любом расхождении create пуст: частичный
 * коммит переключил бы чтение на неполную копию.
 */
export function planMigrate(
  chatId: string,
  legacy: readonly MigrateFile[],
  existing: Readonly<Record<string, string | null>>,
): MigratePlan {
  const empty: MigratePlan = { absent: true, create: [], kept: [], conflicts: [], ignored: [], protocolInvalid: false };
  if (!isChatId(chatId)) return empty;
  const prefix = `chats/${chatId}/`;
  if (!legacy.some((f) => f.path === `${prefix}chat.json`)) return empty;

  const raw = existing[PROTOCOL_PATH];
  if (raw != null && parseProtocol(raw) === null) {
    return { absent: false, create: [], kept: [], conflicts: [], ignored: [], protocolInvalid: true };
  }

  const kept: string[] = [];
  const conflicts: string[] = [];
  const ignored: string[] = [];
  const copies = new Map<string, string>();
  for (const file of legacy) {
    const dest = migrateDest(chatId, file.path);
    if (!dest) {
      if (file.path.startsWith(prefix)) ignored.push(file.path);
      continue;
    }
    const prev = copies.get(dest);
    if (prev !== undefined && prev !== file.content) conflicts.push(dest);
    copies.set(dest, file.content);
  }

  const create: MigrateFile[] = [];
  for (const path of [...copies.keys()].sort()) {
    const content = copies.get(path)!;
    const have = existing[path];
    if (have == null) create.push({ path, content });
    else if (have === content) kept.push(path);
    else conflicts.push(path);
  }
  if (conflicts.length) {
    return { absent: false, create: [], kept, conflicts: [...new Set(conflicts)], ignored, protocolInvalid: false };
  }

  const scaffold = planInit(existing);
  for (const file of scaffold.create) {
    if (!create.some((c) => c.path === file.path)) create.push(file);
  }
  for (const path of scaffold.kept) {
    if (!kept.includes(path)) kept.push(path);
  }
  return { absent: false, create, kept, conflicts: [], ignored, protocolInvalid: false };
}
