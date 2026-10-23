import {
  isAgent,
  type CreateDecisionRequest,
  type Decision,
  type DecisionEventItem,
  type DecisionStatus,
  type MessageItem,
  type ProposeToParentRequest,
  type TimelineItem,
} from "@chat0110/chat-protocol";
import { s } from "../strings.ts";
import { excerpt, plainText } from "./text.ts";

// Решения (docs/protocol.md, «Решения (Этап 5)»): что показать на карточке,
// какие клавиши дать человеку и чем заполнить формы. Статус считает сервер
// сворачиванием событий; здесь — только его прочтение для интерфейса.

export const DECISION_TITLE_MAX = 160;

/** Человеческие действия над решением (propose — это создание). */
export type DecisionVerb = "accept" | "reject" | "discuss" | "reopen";

const AWAITING: ReadonlySet<DecisionStatus> = new Set(["proposed", "under_discussion", "reopened"]);

/** Ждёт человека: предложено, обсуждается или открыто заново. */
export function awaitsHuman(status: DecisionStatus): boolean {
  return AWAITING.has(status);
}

/** Лампа прибора: зелёная — принято, оранжевое кольцо — ждёт, серая — отклонено или заменено. */
export function decisionLamp(status: DecisionStatus): "live" | "act" | "off" {
  if (status === "accepted") return "live";
  return awaitsHuman(status) ? "act" : "off";
}

/**
 * Клавиши карточки — ровно те, что разрешает сервер (иначе 409): принять
 * отклонённое или отклонить принятое можно только через «Открыть заново»,
 * а заменённое уже не обсуждают. Последнее слово — за человеком с правом записи.
 */
export function decisionActions(status: DecisionStatus, canPush: boolean): DecisionVerb[] {
  if (!canPush) return [];
  if (awaitsHuman(status)) return ["accept", "reject", "discuss"];
  return status === "superseded" ? ["reopen"] : ["reopen", "discuss"];
}

export interface StatusLabelOpts {
  /** Название решения по id — для «заменено → …». */
  titleOf: (id: string) => string | null;
  /** Время для «принято · кто когда». */
  when: (iso: string) => string;
}

export function statusLabel(
  d: Pick<Decision, "status" | "decided_by" | "decided_at" | "superseded_by">,
  opts: StatusLabelOpts,
): string {
  if (d.status === "accepted" && d.decided_by && d.decided_at) {
    return s.decision.acceptedBy(d.decided_by, opts.when(d.decided_at));
  }
  if (d.status === "superseded" && d.superseded_by) {
    const title = opts.titleOf(d.superseded_by);
    if (title) return s.decision.supersededBy(title);
  }
  return s.decision.status[d.status];
}

/** Название по умолчанию — первая непустая строка сообщения, без Markdown. */
export function decisionTitle(text: string, max: number = DECISION_TITLE_MAX): string {
  const line = text
    .split("\n")
    .map((l) => plainText(l))
    .find((l) => l.length > 0);
  return line ? excerpt(line, max) : "";
}

export interface DecisionForm {
  title: string;
  text: string;
  sources: string[];
  /** Пустая строка — ничего не заменяет. */
  supersedes: string;
  accept: boolean;
}

export function decisionRequest(f: DecisionForm): CreateDecisionRequest {
  const req: CreateDecisionRequest = { title: f.title.trim(), source_messages: f.sources };
  const text = f.text.trim();
  if (text) req.text = text;
  if (f.supersedes) req.supersedes = f.supersedes;
  req.accept = f.accept;
  return req;
}

export interface ProposeForm {
  title: string;
  text: string;
  sources: string[];
  supersedes: string;
}

export function proposeRequest(f: ProposeForm): ProposeToParentRequest {
  const req: ProposeToParentRequest = { title: f.title.trim(), text: f.text.trim(), source_messages: f.sources };
  if (f.supersedes) req.supersedes = f.supersedes;
  return req;
}

/** Свои влитые сообщения чата по времени: на них можно сослаться как на основание. */
export function forkMessages(items: readonly TimelineItem[]): MessageItem[] {
  return items
    .filter((i): i is MessageItem => i.kind === "message" && !i.pending)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/** Список для «Основания»: свежие первыми; выбранное сообщение — всегда в нём. */
export function sourceCandidates(items: readonly TimelineItem[], selectedId: string, limit = 8): MessageItem[] {
  const all = forkMessages(items).reverse();
  const head = all.slice(0, limit);
  if (head.some((m) => m.id === selectedId)) return head;
  const selected = all.find((m) => m.id === selectedId);
  return selected ? [...head, selected] : head;
}

/** Доказательства по умолчанию — последние `n` сообщений агентов: там обычно расчёты. */
export function defaultEvidence(messages: readonly MessageItem[], n = 3): string[] {
  return messages
    .filter((m) => isAgent(m.author))
    .slice(-n)
    .map((m) => m.id);
}

/**
 * Заготовка «Суть и аргументы» для «Предложить родителю»: зачем был Fork,
 * что в нём приняли и главное из последних сообщений. Только черновик —
 * человек правит его перед отправкой.
 */
export function proposalOutline(input: {
  reason: string;
  decisions: readonly Decision[];
  messages: readonly MessageItem[];
}): string {
  const parts: string[] = [];
  const reason = input.reason.trim();
  if (reason) parts.push(reason);
  const accepted = input.decisions.filter((d) => d.status === "accepted");
  if (accepted.length) parts.push([s.decision.outline.decisions, ...accepted.map((d) => `- ${d.title}`)].join("\n"));
  if (input.messages.length) {
    parts.push(
      [s.decision.outline.messages, ...input.messages.map((m) => s.decision.outline.line(m.display, excerpt(m.text, 140)))].join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** Для «Заменяет»: заменить можно только принятое решение. Свежие — первыми. */
export function acceptedDecisions(decisions: readonly Decision[]): Decision[] {
  return decisions
    .filter((d) => d.status === "accepted")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Тихая строка события решения в ленте. */
export function decisionEventText(e: DecisionEventItem): string {
  if (e.ignored && e.action !== "discuss" && e.action !== "propose") return s.decision.ignored[e.action](e.display, e.title);
  return s.decision.event[e.action](e.display, e.title);
}

const SAME_MOMENT_MS = 60_000;

/**
 * События, которые лента не показывает строкой: «Сразу принять» пишет
 * предложение и принятие одним коммитом, и строка «принял» повторяла бы
 * карточку, на которой уже горит «принято · кто когда».
 */
export function quietDecisionEvents(items: readonly TimelineItem[]): Set<string> {
  const cards = new Map<string, Decision>();
  for (const i of items) if (i.kind === "decision") cards.set(i.id, i.decision);
  const quiet = new Set<string>();
  for (const i of items) {
    if (i.kind !== "decision_event" || i.action !== "accept" || i.ignored) continue;
    const d = cards.get(i.decision_id);
    if (!d || d.created_by !== i.author) continue;
    const gap = Date.parse(i.created_at) - Date.parse(d.created_at);
    if (Number.isFinite(gap) && gap >= 0 && gap < SAME_MOMENT_MS) quiet.add(i.id);
  }
  return quiet;
}
