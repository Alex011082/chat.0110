// Контракт HTTP API между apps/api и apps/web. Только типы: обе стороны
// импортируют их отсюда, чтобы расхождение ловил typecheck, а не пользователь.
import type { Decision, DecisionStatus } from "./decision.ts";
import type { ChatMeta, ForkPoint } from "./meta.ts";
import type { MessageItem, TimelineItem } from "./timeline.ts";

export interface Me {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
}

export interface AppConfig {
  app_slug: string;
  install_url: string;
}

/** Состояние каталога Chat/ в репозитории продукта. Список репозиториев его не создаёт. */
export interface ChatActivation {
  repo: string;
  /** В default-ветке лежит годный Chat/protocol.json. */
  activated: boolean;
  /** На месте главный документ Chat/AGENTS.md. */
  agents_doc: boolean;
  /** В репозитории есть прежний каталог chats/. Init его не переносит. */
  legacy_chats: boolean;
  /** Chat/protocol.json есть, но не читается как схема 2. Init его не перезаписывает. */
  protocol_invalid: boolean;
  can_push: boolean;
  default_branch: string;
  /** Файлы каркаса, которых ещё нет. */
  gaps: string[];
  /** Что дописал этот вызов подключения. Пусто у GET и у повторного POST. */
  created?: string[];
}

export type ChatMigrationStatus = "pending" | "migrated" | "conflict" | "protocol_invalid" | "missing_branch";

/** Один старый чат. created — пути, которые дописал этот вызов, не GET. */
export interface ChatMigrationItem {
  chat_id: string;
  number: number;
  url: string;
  status: ChatMigrationStatus;
  created: string[];
  conflicts: string[];
}

/** Перенос chats/<id>/ → Chat/conversations/<id>/ на тех же ветках. */
export interface ChatMigration {
  repo: string;
  can_push: boolean;
  items: ChatMigrationItem[];
}

export interface RepoInfo {
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch: string;
  can_push: boolean;
  installation_id: number;
}

export interface ChatSummary {
  repo: string;
  chat_id: string;
  title: string;
  number: number;
  state: "open" | "closed";
  draft: boolean;
  branch: string;
  url: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  // Из блока chat0110 в теле PR: дерево строится без чтения chat.json.
  parent: ForkPoint | null;
}

export interface Participant {
  author: string;
  display: string;
  is_agent: boolean;
  last_at: string;
  count: number;
}

export interface ChatDetail extends ChatSummary {
  head_sha: string;
  meta: ChatMeta | null;
  participants: Participant[];
  can_push: boolean;
}

// Дочерний чат, ответвлённый от сообщения этого чата.
export interface ForkRef {
  chat_id: string;
  title: string;
  number: number;
  url: string;
  state: "open" | "closed";
  message_id: string;
  commit_sha: string;
  created_at: string;
  created_by: string;
}

// История родителя до точки Fork — снимок на коммите ветвления, неизменный.
export interface InheritedContext {
  chat_id: string;
  title: string;
  number: number | null;
  message_id: string;
  commit_sha: string;
  items: MessageItem[];
}

export interface TimelineResponse {
  chat: ChatDetail;
  items: TimelineItem[];
  forks: ForkRef[];
  inherited: InheritedContext | null;
  // Все решения этого чата с текущими статусами (из chats/<id>/decisions/).
  // В подключённом репозитории новых решений нет: chat_store === 2.
  decisions: Decision[];
  chat_store?: 1 | 2;
  // Предложения, которые этот Fork отправил родителю, с их статусами в родителе.
  outgoing: Decision[];
}

// POST /api/chats/:owner/:repo/:chatId/fork → CreateChatResponse
export interface ForkRequest {
  message_id: string;
  title: string;
  reason?: string;
  first_message?: string;
}

// GET /api/graph?repo=owner/name — дерево всех чатов репо.
// Сообщения — только файлы своего чата, из имён файлов: без чтения содержимого.
export interface GraphMessage {
  id: string;
  author: string;
  created_at: string;
}

export interface GraphDecision {
  id: string;
  title: string;
  status: DecisionStatus;
  created_at: string;
  decided_at?: string;
  from_chat?: string;
  supersedes?: string;
}

export interface GraphChat extends ChatSummary {
  messages: GraphMessage[];
  decisions: GraphDecision[];
}

export interface GraphResponse {
  repo: string;
  chats: GraphChat[];
}

export interface CreateChatRequest {
  repo: string;
  title: string;
  first_message?: string;
}

export interface CreateChatResponse {
  chat: ChatSummary;
}

export interface PostMessageRequest {
  text: string;
  reply_to?: string;
}

export interface PostMessageResponse {
  item: MessageItem;
}

export interface AcceptAgentPrResponse {
  ok: true;
  merge_sha: string;
}

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "conflict"
  | "github_error";

export interface ApiError {
  error: string;
  code: ApiErrorCode;
  retry_after?: number;
}

// Server-Sent Events на GET /api/events?repo=owner/name.
// Событие только будит клиента: данные он перечитывает сам своим токеном.
export interface ChatUpdatedEvent {
  repo: string;
  chat_id: string | null;
  number: number | null;
}
export const SSE_CHAT_UPDATED = "chat.updated";
export const SSE_REPO_UPDATED = "repo.updated";

// POST /api/chats/:owner/:repo/:chatId/decisions → DecisionResponse.
// accept: true — человек сразу фиксирует принятое решение (два события одним коммитом).
export interface CreateDecisionRequest {
  title: string;
  text?: string;
  source_messages: string[];
  supersedes?: string;
  accept?: boolean;
}

// POST /api/chats/:owner/:repo/:chatId/decisions/:decisionId/(accept|reject|reopen|discuss)
export interface DecisionActionRequest {
  text?: string;
}

// POST /api/chats/:owner/:repo/:forkChatId/propose — предложение пишется в ветку
// РОДИТЕЛЯ с from_chat = этот Fork (п. 4.7 спеки «Propose to Parent»).
export interface ProposeToParentRequest {
  title: string;
  text: string;
  source_messages: string[];
  supersedes?: string;
}

export interface DecisionResponse {
  decision: Decision;
}
