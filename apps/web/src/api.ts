import {
  SSE_CHAT_UPDATED,
  SSE_REPO_UPDATED,
  type AcceptAgentPrResponse,
  type ApiError,
  type ApiErrorCode,
  type AppConfig,
  type ChatActivation,
  type ChatMigration,
  type ChatSummary,
  type ChatUpdatedEvent,
  type CreateChatRequest,
  type CreateChatResponse,
  type CreateDecisionRequest,
  type DecisionActionRequest,
  type DecisionResponse,
  type ForkRequest,
  type GraphResponse,
  type Me,
  type PostMessageRequest,
  type PostMessageResponse,
  type ProposeToParentRequest,
  type RepoInfo,
  type TimelineResponse,
} from "@chat0110/chat-protocol";
import { backoffDelay } from "./lib/chat.ts";
import type { DecisionVerb } from "./lib/decision.ts";
import { splitRepo } from "./lib/route.ts";
import { s } from "./strings.ts";

// Типизированный клиент над контрактом packages/chat-protocol/src/api.ts.
// Сервер защищается от CSRF проверкой Origin и JSON content-type, поэтому
// каждый POST — same-origin и с телом JSON, даже пустым.

export type FailureCode = ApiErrorCode | "network";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: FailureCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** Текст ошибки для человека. rate_limited — «GitHub просит подождать N с». */
export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "rate_limited") return s.errors.rateLimited(e.retryAfter ?? 60);
    if (e.code === "network") return s.errors.network;
    return e.message || s.errors.generic;
  }
  return s.errors.generic;
}

export interface LiveHandlers {
  onChat(ev: ChatUpdatedEvent): void;
  onRepo(): void;
  /** Поток открыт или потерян: шапка показывает «на связи». */
  onState?(connected: boolean): void;
}

export interface Api {
  me(): Promise<Me>;
  config(): Promise<AppConfig>;
  repos(): Promise<RepoInfo[]>;
  activation(repo: string): Promise<ChatActivation>;
  activate(repo: string): Promise<ChatActivation>;
  migration(repo: string): Promise<ChatMigration>;
  migrate(repo: string): Promise<ChatMigration>;
  chats(repo: string): Promise<ChatSummary[]>;
  timeline(repo: string, chatId: string): Promise<TimelineResponse>;
  createChat(req: CreateChatRequest): Promise<CreateChatResponse>;
  postMessage(repo: string, chatId: string, req: PostMessageRequest): Promise<PostMessageResponse>;
  acceptAgentPr(repo: string, chatId: string, number: number): Promise<AcceptAgentPrResponse>;
  /** Fork от сообщения: новый чат, ветка от коммита точки, PR в ветку родителя. */
  fork(repo: string, chatId: string, req: ForkRequest): Promise<CreateChatResponse>;
  /** Дерево всех чатов репо (до 200 самых свежих). */
  graph(repo: string): Promise<GraphResponse>;
  /** Новое решение в этом чате; accept — человек сразу его принимает. */
  createDecision(repo: string, chatId: string, req: CreateDecisionRequest): Promise<DecisionResponse>;
  /** Принять, отклонить, открыть заново или вынести на обсуждение — событие-файл. */
  decisionAction(
    repo: string,
    chatId: string,
    decisionId: string,
    action: DecisionVerb,
    req?: DecisionActionRequest,
  ): Promise<DecisionResponse>;
  /** «Предложить родителю»: предложение ложится в ветку и решения РОДИТЕЛЯ. */
  proposeToParent(repo: string, forkChatId: string, req: ProposeToParentRequest): Promise<DecisionResponse>;
  logout(): Promise<void>;
  subscribe(repo: string, handlers: LiveHandlers): () => void;
}

// 401 на любом запросе — сессия кончилась: приложение показывает вход.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  };
  if (method === "POST") {
    init.headers = { Accept: "application/json", "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFailure(0, "network", s.errors.network);
  }
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let err: Partial<ApiError> = {};
  try {
    err = (await res.json()) as ApiError;
  } catch {
    // тело не JSON — например, 502 от прокси
  }
  const retry = err.retry_after ?? (Number(res.headers.get("Retry-After")) || undefined);
  const code: FailureCode = err.code ?? (res.status === 401 ? "unauthorized" : res.status === 429 ? "rate_limited" : "github_error");
  if (res.status === 401 && path !== "/api/me") onUnauthorized?.();
  throw new ApiFailure(res.status, code, err.error ?? s.errors.generic, retry);
}

function chatPath(repo: string, chatId: string): string {
  const r = splitRepo(repo);
  if (!r) throw new ApiFailure(400, "bad_request", s.errors.generic);
  return `/api/chats/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}/${encodeURIComponent(chatId)}`;
}

// Списки: принимаем и голый массив, и обёртку { repos } / { chats }.
function listOf<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  const inner = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** SSE с переподключением: браузер сам повторяет обрывы, но не отказ (401/403). */
function subscribeSse(repo: string, h: LiveHandlers): () => void {
  let es: EventSource | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    if (stopped) return;
    es = new EventSource(`/api/events?repo=${encodeURIComponent(repo)}`);
    es.onopen = () => {
      attempt = 0;
      h.onState?.(true);
    };
    es.addEventListener(SSE_CHAT_UPDATED, (e) => {
      try {
        h.onChat(JSON.parse((e as MessageEvent<string>).data) as ChatUpdatedEvent);
      } catch {
        h.onRepo();
      }
    });
    es.addEventListener(SSE_REPO_UPDATED, () => h.onRepo());
    es.onerror = () => {
      h.onState?.(false);
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        timer = setTimeout(open, backoffDelay(attempt++));
      }
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    es?.close();
  };
}

export const httpApi: Api = {
  me: () => request<Me>("GET", "/api/me"),
  config: () => request<AppConfig>("GET", "/api/config"),
  repos: async () => listOf<RepoInfo>(await request("GET", "/api/repos"), "repos"),
  activation: (repo) => request<ChatActivation>("GET", `/api/activation?repo=${encodeURIComponent(repo)}`),
  activate: (repo) => request<ChatActivation>("POST", "/api/activation", { repo }),
  migration: (repo) => request<ChatMigration>("GET", `/api/migration?repo=${encodeURIComponent(repo)}`),
  migrate: (repo) => request<ChatMigration>("POST", "/api/migration", { repo }),
  chats: async (repo) => listOf<ChatSummary>(await request("GET", `/api/chats?repo=${encodeURIComponent(repo)}`), "chats"),
  timeline: (repo, chatId) => request<TimelineResponse>("GET", chatPath(repo, chatId)),
  createChat: (req) => request<CreateChatResponse>("POST", "/api/chats", req),
  postMessage: (repo, chatId, req) => request<PostMessageResponse>("POST", `${chatPath(repo, chatId)}/messages`, req),
  acceptAgentPr: (repo, chatId, n) =>
    request<AcceptAgentPrResponse>("POST", `${chatPath(repo, chatId)}/agent-prs/${n}/accept`, {}),
  fork: (repo, chatId, req) => request<CreateChatResponse>("POST", `${chatPath(repo, chatId)}/fork`, req),
  graph: (repo) => request<GraphResponse>("GET", `/api/graph?repo=${encodeURIComponent(repo)}`),
  createDecision: (repo, chatId, req) => request<DecisionResponse>("POST", `${chatPath(repo, chatId)}/decisions`, req),
  decisionAction: (repo, chatId, decisionId, action, req) =>
    request<DecisionResponse>(
      "POST",
      `${chatPath(repo, chatId)}/decisions/${encodeURIComponent(decisionId)}/${action}`,
      req ?? {},
    ),
  proposeToParent: (repo, forkChatId, req) => request<DecisionResponse>("POST", `${chatPath(repo, forkChatId)}/propose`, req),
  logout: async () => {
    await request<unknown>("POST", "/auth/logout", {});
  },
  subscribe: subscribeSse,
};

/**
 * Пробный режим с выдуманными данными — только в разработке и только явно:
 * ?mock=1 в адресе или VITE_MOCK=1. В сборку для сервера он не попадает.
 */
export function mockRequested(): string | null {
  if (!import.meta.env.DEV) return null;
  if (import.meta.env.VITE_MOCK === "1") return "1";
  return new URLSearchParams(location.search).get("mock");
}

let current: Api = httpApi;
export function api(): Api {
  return current;
}

export async function initApi(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const mode = mockRequested();
  if (!mode) return;
  const { createMockApi } = await import("./mock.ts");
  current = createMockApi(mode);
}
