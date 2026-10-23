import { displayName, isAgent, resolveAuthor } from "./agents.ts";
import { foldDecisions, parseDecisionFile, type Decision, type DecisionAction, type DecisionEvent } from "./decision.ts";
import { chatJsonPath, isDecisionPath, isMessagePath } from "./ids.ts";
import { parseMessageFile, validIso, type MessageFile } from "./message-file.ts";
import { parseCommentMeta } from "./meta.ts";

// Сырые данные одного чата, уже вынутые из GitHub адаптером (apps/api).
// Здесь нет сети: только правила сборки ленты из docs/protocol.md.
export interface FileInput {
  name: string;
  content: string;
}
export interface CommitInput {
  sha: string;
  message: string;
  login: string | null;
  name: string;
  date: string;
  added: string[];
  url: string;
}
export interface CommentInput {
  id: number;
  login: string;
  body: string;
  created_at: string;
  url: string;
}
export interface ReviewInput {
  id: number;
  login: string;
  body: string;
  state: string;
  submitted_at: string;
  url: string;
}
export interface ReviewCommentInput {
  id: number;
  login: string;
  body: string;
  path: string;
  line?: number | null;
  diff_hunk?: string;
  created_at: string;
  url: string;
}
export interface AgentPrInput {
  number: number;
  title: string;
  login: string;
  state: "open" | "closed";
  merged: boolean;
  created_at: string;
  url: string;
  files: FileInput[];
}
export interface TimelineInput {
  chatId: string;
  files: FileInput[];
  commits: CommitInput[];
  comments: CommentInput[];
  reviews: ReviewInput[];
  reviewComments: ReviewCommentInput[];
  agentPrs: AgentPrInput[];
  // Файлы chats/<chat_id>/decisions/ на голове ветки (Этап 5).
  decisions?: FileInput[];
}

export interface MessageItem {
  kind: "message";
  id: string;
  author: string;
  display: string;
  source: "file" | "comment" | "agent_pr";
  text: string;
  reply_to?: string;
  created_at: string;
  actor?: string;
  commit_sha?: string;
  url?: string;
  pending: boolean;
  agent_pr?: number;
}
export interface CreatedItem {
  kind: "created";
  id: string;
  actor: string;
  created_at: string;
  url: string;
}
export interface PushItem {
  kind: "push";
  id: string;
  actor: string;
  author: string;
  display: string;
  title: string;
  files: number;
  created_at: string;
  url: string;
}
export interface ReviewItem {
  kind: "review";
  id: string;
  author: string;
  display: string;
  actor: string;
  text: string;
  state?: string;
  path?: string;
  line?: number;
  diff_hunk?: string;
  created_at: string;
  url: string;
}
export interface AgentPrItem {
  kind: "agent_pr";
  id: string;
  number: number;
  title: string;
  actor: string;
  author: string;
  display: string;
  state: "open" | "closed" | "merged";
  created_at: string;
  url: string;
  message_ids: string[];
}
// Решение показывается одной карточкой в момент предложения с текущим
// статусом; последующие события — короткими строками в своё время.
export interface DecisionItem {
  kind: "decision";
  id: string;
  author: string;
  display: string;
  decision: Decision;
  created_at: string;
  actor?: string;
  commit_sha?: string;
  url?: string;
}
export interface DecisionEventItem {
  kind: "decision_event";
  id: string;
  decision_id: string;
  action: DecisionAction;
  title: string;
  author: string;
  display: string;
  text: string;
  ignored?: boolean;
  created_at: string;
}
export type TimelineItem = MessageItem | CreatedItem | PushItem | ReviewItem | AgentPrItem | DecisionItem | DecisionEventItem;

const iso = (value: string) => validIso(value) ?? value;

// Агенты пушат от git-личности владельца (docs/protocol.md, «Поведение
// агентов на деле»), поэтому логин коммита не говорит, кто пушил. Сначала
// смотрим сообщение коммита по протоколу, затем трейлер Co-Authored-By.
function commitAuthor(c: CommitInput, chatId: string): string {
  const head = c.message.split("\n")[0]!;
  const byProtocol = head.match(new RegExp(`^chat\\(${chatId}\\):\\s*([a-z0-9][a-z0-9_-]{0,31})\\s*$`));
  if (byProtocol) return byProtocol[1]!;
  for (const m of c.message.matchAll(/^Co-Authored-By:\s*([A-Za-z][\w-]*)/gim)) {
    const who = resolveAuthor(m[1]!);
    if (isAgent(who)) return who;
  }
  return resolveAuthor(c.login ?? c.name);
}
const actorOf = (c: { login: string | null; name: string }) => (c.login ? c.login.toLowerCase() : c.name);
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function fromFile(msg: MessageFile, extra: Partial<MessageItem>): MessageItem {
  const item: MessageItem = {
    kind: "message",
    id: msg.id,
    author: msg.author,
    display: displayName(msg.author),
    source: "file",
    text: msg.text,
    created_at: msg.created_at,
    pending: false,
    ...extra,
  };
  if (msg.reply_to) item.reply_to = msg.reply_to;
  return item;
}

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const { chatId } = input;
  const items: TimelineItem[] = [];
  const messageIds = new Set<string>();

  // Кто запушил каждый файл: первый коммит ветки, который его добавил.
  const addedBy = new Map<string, CommitInput>();
  for (const c of input.commits) {
    for (const path of c.added) {
      if (isMessagePath(chatId, path) && !addedBy.has(baseName(path))) addedBy.set(baseName(path), c);
    }
  }

  for (const c of input.commits) {
    const actor = actorOf(c);
    if (c.added.includes(chatJsonPath(chatId))) {
      items.push({ kind: "created", id: c.sha, actor, created_at: iso(c.date), url: c.url });
    } else if (!c.added.some((p) => isMessagePath(chatId, p) || isDecisionPath(chatId, p))) {
      const author = commitAuthor(c, chatId);
      items.push({
        kind: "push",
        id: c.sha,
        actor,
        author,
        display: displayName(author),
        title: c.message.split("\n")[0]!,
        files: c.added.length,
        created_at: iso(c.date),
        url: c.url,
      });
    }
  }

  for (const f of input.files) {
    const msg = parseMessageFile(f.name, f.content);
    if (!msg || messageIds.has(msg.id)) continue;
    const commit = addedBy.get(f.name);
    const extra: Partial<MessageItem> = {};
    if (commit) Object.assign(extra, { actor: actorOf(commit), commit_sha: commit.sha, url: commit.url });
    items.push(fromFile(msg, extra));
    messageIds.add(msg.id);
  }

  for (const pr of input.agentPrs) {
    const author = resolveAuthor(pr.login);
    const ids: string[] = [];
    for (const f of pr.files) {
      const msg = parseMessageFile(f.name, f.content);
      if (!msg) continue;
      ids.push(msg.id);
      // Влитое уже лежит в ветке; закрытое без слияния — отвергнуто.
      if (pr.merged || pr.state === "closed" || messageIds.has(msg.id)) continue;
      items.push(fromFile(msg, { source: "agent_pr", pending: true, agent_pr: pr.number, actor: pr.login.toLowerCase(), url: pr.url }));
      messageIds.add(msg.id);
    }
    items.push({
      kind: "agent_pr",
      id: `pr${pr.number}`,
      number: pr.number,
      title: pr.title,
      actor: pr.login.toLowerCase(),
      author,
      display: displayName(author),
      state: pr.merged ? "merged" : pr.state,
      created_at: iso(pr.created_at),
      url: pr.url,
      message_ids: ids,
    });
  }

  for (const c of input.comments) {
    const { text, meta } = parseCommentMeta(c.body);
    const id = meta.id ?? `c${c.id}`;
    if (messageIds.has(id)) continue;
    const author = meta.author ?? resolveAuthor(c.login);
    const item: MessageItem = {
      kind: "message",
      id,
      author,
      display: displayName(author),
      source: "comment",
      text,
      created_at: iso(c.created_at),
      actor: c.login.toLowerCase(),
      url: c.url,
      pending: false,
    };
    if (meta.reply_to) item.reply_to = meta.reply_to;
    items.push(item);
    messageIds.add(id);
  }

  if (input.decisions?.length) {
    const decisionAddedBy = new Map<string, CommitInput>();
    for (const c of input.commits) {
      for (const path of c.added) {
        if (isDecisionPath(chatId, path) && !decisionAddedBy.has(baseName(path))) decisionAddedBy.set(baseName(path), c);
      }
    }
    const events = input.decisions
      .map((f) => parseDecisionFile(f.name, f.content))
      .filter((e): e is DecisionEvent => e !== null);
    for (const d of foldDecisions(events)) {
      const item: DecisionItem = {
        kind: "decision", id: d.id, author: d.created_by, display: displayName(d.created_by), decision: d, created_at: d.created_at,
      };
      const commit = decisionAddedBy.get(`${d.id}.md`);
      if (commit) Object.assign(item, { actor: actorOf(commit), commit_sha: commit.sha, url: commit.url });
      items.push(item);
      for (const h of d.history.slice(1)) {
        const ev: DecisionEventItem = {
          kind: "decision_event", id: h.id, decision_id: d.id, action: h.action, title: d.title,
          author: h.author, display: displayName(h.author), text: h.text, created_at: h.created_at,
        };
        if (h.ignored) ev.ignored = true;
        items.push(ev);
      }
    }
  }

  for (const r of input.reviews) {
    if (!r.body.trim()) continue;
    const author = resolveAuthor(r.login);
    items.push({
      kind: "review", id: `r${r.id}`, author, display: displayName(author), actor: r.login.toLowerCase(),
      text: r.body.trim(), state: r.state, created_at: iso(r.submitted_at), url: r.url,
    });
  }
  for (const rc of input.reviewComments) {
    const author = resolveAuthor(rc.login);
    const item: ReviewItem = {
      kind: "review", id: `rc${rc.id}`, author, display: displayName(author), actor: rc.login.toLowerCase(),
      text: rc.body.trim(), path: rc.path, created_at: iso(rc.created_at), url: rc.url,
    };
    if (rc.line != null) item.line = rc.line;
    if (rc.diff_hunk) item.diff_hunk = rc.diff_hunk;
    items.push(item);
  }

  // Создание чата — всегда первое событие: время первого сообщения ставится до
  // коммита, и по одному времени оно оказывалось бы выше «создал чат».
  const rank = (i: TimelineItem) => (i.kind === "created" ? 0 : 1);
  return items.sort((a, b) =>
    rank(a) - rank(b) ||
    (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

// Точка ветвления для Fork: коммит ветки, на котором чат выглядел ровно так,
// как в момент выбранного сообщения. Для файла — коммит, который его добавил;
// для комментария (его нет в Git) — последний коммит не позже комментария.
// Дочерняя ветка создаётся от этого коммита, поэтому её контекст — снимок
// истории родителя, а не текущее состояние PR (п. 4.4 спеки).
export function findForkCommit(input: TimelineInput, messageId: string): string | null {
  const fileName = `${messageId}.md`;
  for (const c of input.commits) {
    if (c.added.some((p) => isMessagePath(input.chatId, p) && baseName(p) === fileName)) return c.sha;
  }
  const comment = input.comments.find((c) => (parseCommentMeta(c.body).meta.id ?? `c${c.id}`) === messageId);
  if (!comment) return null;
  const at = iso(comment.created_at);
  let point: string | null = null;
  for (const c of input.commits) {
    if (iso(c.date) <= at) point = c.sha;
  }
  return point ?? input.commits[0]?.sha ?? null;
}
