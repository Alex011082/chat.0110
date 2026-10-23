import { isAgent } from "./agents.ts";
import { isAuthor, isChatId, parseMessageId } from "./ids.ts";
import { parseFrontmatter, validIso } from "./message-file.ts";

// Решение — цепочка событий-файлов в chats/<chat_id>/decisions/ (п. 10 спеки).
// Статус не хранится, а вычисляется сворачиванием событий: так история
// решения — это история Git, и старое решение при замене не исчезает.
export const DECISION_ACTIONS = ["propose", "accept", "reject", "reopen", "discuss"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export type DecisionStatus = "proposed" | "under_discussion" | "accepted" | "rejected" | "superseded" | "reopened";

export interface DecisionEvent {
  id: string;
  decision: string;
  action: DecisionAction;
  author: string;
  created_at: string;
  title?: string;
  source_messages: string[];
  from_chat?: string;
  supersedes?: string;
  text: string;
}

export interface DecisionHistoryEntry {
  id: string;
  action: DecisionAction;
  author: string;
  created_at: string;
  text: string;
  ignored?: boolean;
}

export interface Decision {
  id: string;
  title: string;
  status: DecisionStatus;
  created_at: string;
  created_by: string;
  source_messages: string[];
  from_chat?: string;
  supersedes?: string;
  superseded_by?: string;
  decided_by?: string;
  decided_at?: string;
  text: string;
  history: DecisionHistoryEntry[];
}

const SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isAction = (v: string | undefined): v is DecisionAction => DECISION_ACTIONS.includes(v as DecisionAction);

export function parseDecisionFile(fileName: string, content: string): DecisionEvent | null {
  const id = fileName.replace(/\.md$/, "");
  const parts = fileName.endsWith(".md") ? parseMessageId(id) : null;
  const fm = parts ? parseFrontmatter(content) : null;
  if (!parts || !fm || !isAction(fm.fields.action)) return null;
  const f = fm.fields;
  const action = f.action as DecisionAction;
  // Предложение само и есть решение; остальные события обязаны сослаться на него.
  const decision = action === "propose" ? id : f.decision && parseMessageId(f.decision) ? f.decision : null;
  if (!decision) return null;
  const ev: DecisionEvent = {
    id,
    decision,
    action,
    author: f.author && isAuthor(f.author) ? f.author : parts.author,
    created_at: validIso(f.created_at) ?? parts.date,
    source_messages: (f.source_messages ?? "").split(",").map((s) => s.trim()).filter((s) => SOURCE_RE.test(s)),
    text: fm.body.trimEnd(),
  };
  if (f.title?.trim()) ev.title = f.title.trim();
  if (f.from_chat && isChatId(f.from_chat)) ev.from_chat = f.from_chat;
  if (f.supersedes && parseMessageId(f.supersedes)) ev.supersedes = f.supersedes;
  return ev;
}

export function serializeDecisionFile(ev: DecisionEvent): string {
  const lines = ["---", `id: ${ev.id}`, `decision: ${ev.decision}`, `action: ${ev.action}`, `author: ${ev.author}`, `created_at: ${ev.created_at}`];
  if (ev.title) lines.push(`title: ${ev.title.replace(/\s*\n\s*/g, " ")}`);
  if (ev.source_messages.length) lines.push(`source_messages: ${ev.source_messages.join(", ")}`);
  if (ev.from_chat) lines.push(`from_chat: ${ev.from_chat}`);
  if (ev.supersedes) lines.push(`supersedes: ${ev.supersedes}`);
  lines.push("---", ev.text.trimEnd(), "");
  return lines.join("\n");
}

const byTime = (a: DecisionEvent, b: DecisionEvent) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function foldDecisions(events: DecisionEvent[]): Decision[] {
  const byId = new Map<string, Decision>();
  const order: Decision[] = [];
  for (const e of [...events].sort(byTime)) {
    const entry: DecisionHistoryEntry = { id: e.id, action: e.action, author: e.author, created_at: e.created_at, text: e.text };
    if (e.action === "propose") {
      if (byId.has(e.id)) continue;
      const d: Decision = {
        id: e.id,
        title: e.title ?? "Без названия",
        status: "proposed",
        created_at: e.created_at,
        created_by: e.author,
        source_messages: e.source_messages,
        text: e.text,
        history: [entry],
      };
      if (e.from_chat) d.from_chat = e.from_chat;
      if (e.supersedes) d.supersedes = e.supersedes;
      byId.set(d.id, d);
      order.push(d);
      continue;
    }
    const d = byId.get(e.decision);
    if (!d) continue;
    d.history.push(entry);
    if (e.action === "discuss") {
      if (d.status === "proposed" || d.status === "reopened") d.status = "under_discussion";
      continue;
    }
    // Последнее слово за человеком (п. 2.3 спеки): агент может предложить и
    // обсуждать, но его «принять» или «отклонить» статус не меняет.
    if (isAgent(e.author)) {
      entry.ignored = true;
      continue;
    }
    if (e.action === "reopen") {
      d.status = "reopened";
      continue;
    }
    d.status = e.action === "accept" ? "accepted" : "rejected";
    d.decided_by = e.author;
    d.decided_at = e.created_at;
    if (e.action === "accept" && d.supersedes) {
      const old = byId.get(d.supersedes);
      if (old && old.status !== "rejected") {
        old.status = "superseded";
        old.superseded_by = d.id;
      }
    }
  }
  return order;
}
