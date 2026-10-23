// Контракт HTTP API между apps/api и apps/web. Только типы: обе стороны
// импортируют их отсюда, чтобы расхождение ловил typecheck, а не пользователь.
import type { ChatMeta } from "./meta.ts";
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

export interface TimelineResponse {
  chat: ChatDetail;
  items: TimelineItem[];
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
