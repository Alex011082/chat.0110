// Контракт HTTP API между apps/api и apps/web. Только типы: обе стороны
// импортируют их отсюда, чтобы расхождение ловил typecheck, а не пользователь.
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

export interface GraphChat extends ChatSummary {
  messages: GraphMessage[];
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
