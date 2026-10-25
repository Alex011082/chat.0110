// Каталог Chat/ в репозитории продукта. Схема 1 (chats/) остаётся, пока
// репозиторий не подключён файлом Chat/protocol.json.
import type { ChatStore } from "./ids.ts";
import { CHAT_AGENTS_MD, CHAT_CLAUDE_MD } from "./agents-v2.ts";

export const PROTOCOL_PATH = "Chat/protocol.json";
export const CHAT_AGENTS_PATH = "Chat/AGENTS.md";
export const CHAT_CLAUDE_PATH = "Chat/CLAUDE.md";
export const LEGACY_ROOT = "chats";

const GITKEEP = "\n";

export const PROTOCOL_JSON = `${JSON.stringify(
  {
    schema_version: 2,
    product: "chat.0110",
    root: "Chat",
    conversations: "Chat/conversations",
    legacy_root: LEGACY_ROOT,
  },
  null,
  2,
)}\n`;

export interface ScaffoldFile {
  path: string;
  content: string;
}

export const SCAFFOLD: readonly ScaffoldFile[] = [
  { path: PROTOCOL_PATH, content: PROTOCOL_JSON },
  { path: CHAT_AGENTS_PATH, content: CHAT_AGENTS_MD },
  { path: CHAT_CLAUDE_PATH, content: CHAT_CLAUDE_MD },
  { path: "Chat/index/.gitkeep", content: GITKEEP },
  { path: "Chat/conversations/.gitkeep", content: GITKEEP },
  { path: "Chat/forks/.gitkeep", content: GITKEEP },
  { path: "Chat/references/.gitkeep", content: GITKEEP },
];

const SCAFFOLD_BY_PATH = new Map(SCAFFOLD.map((f) => [f.path, f.content]));

export function scaffoldContent(path: string): string | null {
  return SCAFFOLD_BY_PATH.get(path) ?? null;
}

export function parseProtocol(text: string | null | undefined): { schema_version: 2 } | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { schema_version?: unknown; root?: unknown };
    if (v.schema_version === 2 && v.root === "Chat") return { schema_version: 2 };
  } catch {
    // повреждённый protocol.json — не повод молча считать репозиторий подключённым
  }
  return null;
}

export interface InitPlan {
  create: ScaffoldFile[];
  /** Уже лежащие файлы каркаса, которые init не перезаписывает. */
  kept: string[];
  gaps: string[];
  activated: boolean;
  agentsDoc: boolean;
  protocolInvalid: boolean;
}

/** Что дописать в Chat/. Существующие файлы, включая чужой README и свой AGENTS.md, не меняет. */
export function planInit(existing: Readonly<Record<string, string | null>>): InitPlan {
  const raw = existing[PROTOCOL_PATH];
  const protocolInvalid = raw != null && parseProtocol(raw) === null;
  if (protocolInvalid) {
    return { create: [], kept: [], gaps: [], activated: false, agentsDoc: existing[CHAT_AGENTS_PATH] != null, protocolInvalid: true };
  }
  const create: ScaffoldFile[] = [];
  const kept: string[] = [];
  for (const file of SCAFFOLD) {
    if (existing[file.path] == null) create.push(file);
    else kept.push(file.path);
  }
  return {
    create,
    kept,
    gaps: create.map((f) => f.path),
    activated: parseProtocol(raw) !== null,
    agentsDoc: existing[CHAT_AGENTS_PATH] != null,
    protocolInvalid: false,
  };
}

export function chatPathAllowed(path: string, store: ChatStore): boolean {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  const root = store === 2 ? "Chat" : "chats";
  return parts[0] === root && parts.length > 1;
}

export function conversationViolation(paths: readonly string[], store: ChatStore): string | null {
  const bad = paths.filter((p) => !chatPathAllowed(p, store));
  return bad.length ? bad.join(", ") : null;
}

export function scaffoldViolation(paths: readonly string[]): string | null {
  const bad = paths.filter((p) => !SCAFFOLD_BY_PATH.has(p));
  return bad.length ? bad.join(", ") : null;
}
