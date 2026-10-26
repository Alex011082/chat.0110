// Роутер на голом Bun.serve: маршрутов мало, и рукописная таблица проще
// фреймворка. Каждый параметр из адреса проверяется регуляркой ДО того,
// как попадёт в URL GitHub.
import { isChatId, type AppConfig, type ChatActivation, type CreateChatResponse, type DecisionResponse, type Me, type PostMessageResponse } from "@chat0110/chat-protocol";
import { activateChat, activationStatus } from "./activate.ts";
import { createAuth } from "./auth.ts";
import {
  acceptAgentPr,
  createChat,
  createDecision,
  decisionAction,
  forkChat,
  getGraph,
  getTimeline,
  listChats,
  postMessage,
  proposeToParent,
  type ChatCtx,
} from "./chats.ts";
import { isLoginAllowed, type Config } from "./config.ts";
import { HttpError, badRequest, forbidden, notFound, unauthorized } from "./errors.ts";
import { GitHubClient, createCaches, type Fetch, type GitHubCaches, type RepoRef } from "./github.ts";
import { SessionStore, importCookieKey, type SessionData } from "./session.ts";
import { SseHub, sseResponse, type ServerLike } from "./sse.ts";
import { createStatic } from "./static.ts";
import { createWebhook } from "./webhook.ts";

export interface AppDeps {
  config: Config;
  fetch?: Fetch;
  now?: () => Date;
  rand?: () => string;
  hub?: SseHub;
  caches?: GitHubCaches;
  sessions?: SessionStore;
}

export type App = (req: Request, server?: ServerLike) => Promise<Response>;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const NUMBER_RE = /^[1-9]\d{0,8}$/;
const MAX_BODY = 1024 * 1024;

const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // Ответы API — данные конкретного пользователя: ни браузер, ни прокси не кешируют.
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    const extra: Record<string, string> = e.retryAfter !== undefined ? { "Retry-After": String(e.retryAfter) } : {};
    return json(e.status, e.toJSON(), extra);
  }
  console.error("необработанная ошибка запроса", e);
  return json(500, { error: "Внутренняя ошибка сервера", code: "github_error" });
}

function repoRef(owner: string, name: string): RepoRef {
  if (!OWNER_RE.test(owner) || !REPO_RE.test(name) || name === "." || name === "..") {
    throw badRequest("Неверное имя репозитория: ожидается owner/name");
  }
  return { owner, name };
}

function repoFromParam(value: unknown): RepoRef {
  if (typeof value !== "string") throw badRequest("Нужен параметр repo=owner/name");
  const parts = value.split("/");
  if (parts.length !== 2) throw badRequest("Нужен параметр repo=owner/name");
  return repoRef(parts[0]!, parts[1]!);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) throw new HttpError(413, "bad_request", "Слишком большой запрос");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "bad_request", "Слишком большой запрос");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest("Тело запроса — не JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Тело запроса должно быть JSON-объектом");
  return body as Record<string, unknown>;
}

export async function createApp(deps: AppDeps): Promise<App> {
  const { config } = deps;
  const fetcher = deps.fetch ?? fetch;
  const caches = deps.caches ?? createCaches();
  const hub = deps.hub ?? new SseHub();
  const sessions = deps.sessions ?? new SessionStore({
    key: await importCookieKey(config.cookieKey),
    dev: config.devCookies,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fetch: fetcher,
  });
  const auth = createAuth({ config, sessions, fetch: fetcher });
  const webhook = createWebhook({ secret: config.webhookSecret, hub });
  const statics = createStatic(config.webDist);
  const appConfig: AppConfig = {
    app_slug: config.appSlug,
    install_url: `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`,
  };

  // Изменяющие запросы принимаются только со своей страницы: Origin должен
  // совпасть, а JSON content-type не отправить обычной HTML-формой.
  function checkCsrf(req: Request): Response | null {
    if (req.headers.get("origin") !== config.publicOrigin) {
      return json(403, { error: "Запрос отклонён: он пришёл не со страницы chat.0110", code: "forbidden" });
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return json(415, { error: "Нужен Content-Type: application/json", code: "bad_request" });
    }
    return null;
  }

  async function requireSession(req: Request): Promise<{ session: SessionData; setCookie?: string }> {
    const got = await sessions.read(req);
    if (!got) throw unauthorized();
    // Список логинов могли сократить после входа: cookie живёт месяцами.
    if (!isLoginAllowed(config, got.session.login)) throw forbidden(`Вход для ${got.session.login} закрыт`);
    return got;
  }

  async function api(req: Request, url: URL, server: ServerLike | undefined): Promise<Response> {
    const method = req.method;
    const path = url.pathname;

    if (path === "/api/config" && method === "GET") return json(200, appConfig);

    const { session, setCookie } = await requireSession(req);
    const gh = new GitHubClient({ token: session.at, userId: session.uid, fetch: fetcher, caches });
    const ctx: ChatCtx = { gh, user: { login: session.login, id: session.uid } };
    if (deps.now) ctx.now = deps.now;
    if (deps.rand) ctx.rand = deps.rand;

    const res = await (async (): Promise<Response> => {
      if (path === "/api/me" && method === "GET") {
        const u = await gh.getUser();
        const me: Me = { login: u.login, id: u.id, name: u.name, avatar_url: u.avatar_url };
        return json(200, me);
      }
      if (path === "/api/repos" && method === "GET") return json(200, await gh.listRepos());
      if (path === "/api/activation" && method === "GET") {
        return json(200, await activationStatus(gh, repoFromParam(url.searchParams.get("repo"))));
      }
      if (path === "/api/activation" && method === "POST") {
        const body = await readJson(req);
        const out: ChatActivation = await activateChat(gh, repoFromParam(body.repo ?? url.searchParams.get("repo")));
        return json(200, out);
      }
      if (path === "/api/chats" && method === "GET") return json(200, await listChats(gh, repoFromParam(url.searchParams.get("repo"))));
      if (path === "/api/chats" && method === "POST") {
        const body = await readJson(req);
        const repo = repoFromParam(body.repo ?? url.searchParams.get("repo"));
        const out: CreateChatResponse = { chat: await createChat(ctx, repo, { title: body.title, first_message: body.first_message }) };
        return json(201, out);
      }
      if (path === "/api/graph" && method === "GET") return json(200, await getGraph(gh, repoFromParam(url.searchParams.get("repo"))));
      if (path === "/api/events" && method === "GET") {
        const repo = repoFromParam(url.searchParams.get("repo"));
        // Доступ проверяем ДО подписки: иначе любой вошедший мог бы слушать,
        // когда пушат в чужие приватные репо.
        const info = await gh.getRepo(repo);
        return sseResponse(req, server, hub, info.full_name);
      }

      const seg = path.split("/").slice(1);
      if (seg[0] === "api" && seg[1] === "chats" && seg.length >= 5) {
        let owner: string, name: string, chatId: string;
        try {
          [owner, name, chatId] = [decodeURIComponent(seg[2]!), decodeURIComponent(seg[3]!), decodeURIComponent(seg[4]!)];
        } catch {
          throw badRequest("Неверный адрес");
        }
        const repo = repoRef(owner, name);
        if (!isChatId(chatId)) throw badRequest("Неверный id чата: ожидается ГГГГММДД-xxxx");
        const rest = seg.slice(5);

        if (method === "GET" && (rest.length === 0 || (rest.length === 1 && rest[0] === "timeline"))) {
          return json(200, await getTimeline(gh, repo, chatId));
        }
        if (method === "POST" && rest.length === 1 && rest[0] === "messages") {
          const body = await readJson(req);
          const out: PostMessageResponse = { item: await postMessage(ctx, repo, chatId, { text: body.text, reply_to: body.reply_to }) };
          return json(201, out);
        }
        if (method === "POST" && rest.length === 1 && rest[0] === "fork") {
          const body = await readJson(req);
          const out: CreateChatResponse = {
            chat: await forkChat(ctx, repo, chatId, { message_id: body.message_id, title: body.title, reason: body.reason, first_message: body.first_message }),
          };
          return json(201, out);
        }
        if (method === "POST" && rest.length === 1 && rest[0] === "decisions") {
          const body = await readJson(req);
          const out: DecisionResponse = {
            decision: await createDecision(ctx, repo, chatId, {
              title: body.title, text: body.text, source_messages: body.source_messages, supersedes: body.supersedes, accept: body.accept,
            }),
          };
          return json(201, out);
        }
        // id решения и действие проверяет decisionAction до первого запроса в GitHub.
        if (method === "POST" && rest.length === 3 && rest[0] === "decisions") {
          const body = await readJson(req);
          const out: DecisionResponse = { decision: await decisionAction(ctx, repo, chatId, rest[1]!, rest[2]!, { text: body.text }) };
          return json(200, out);
        }
        // chatId здесь — Fork: предложение уходит в ветку его родителя.
        if (method === "POST" && rest.length === 1 && rest[0] === "propose") {
          const body = await readJson(req);
          const out: DecisionResponse = {
            decision: await proposeToParent(ctx, repo, chatId, {
              title: body.title, text: body.text, source_messages: body.source_messages, supersedes: body.supersedes,
            }),
          };
          return json(201, out);
        }
        if (method === "POST" && rest.length === 3 && rest[0] === "agent-prs" && rest[2] === "accept") {
          if (!NUMBER_RE.test(rest[1]!)) throw badRequest("Неверный номер PR");
          return json(200, await acceptAgentPr(gh, repo, chatId, Number(rest[1])));
        }
      }
      throw notFound("Такого адреса в API нет");
    })().catch((e) => {
      const r = errorResponse(e);
      // GitHub больше не принимает токен (отозван, App удалено) — сессия
      // бесполезна, стираем cookie, и интерфейс отправит на вход.
      if (e instanceof HttpError && e.code === "unauthorized") r.headers.append("Set-Cookie", sessions.clearCookie());
      return r;
    });
    if (setCookie && !res.headers.getSetCookie().length) res.headers.append("Set-Cookie", setCookie);
    return res;
  }

  return async (req, server) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    try {
      if (path === "/health") return json(200, { ok: true });
      // Вебхук приходит от GitHub без Origin; его защищает HMAC-подпись.
      if (path === "/api/github/webhook") {
        return method === "POST" ? await webhook(req) : json(405, { error: "Только POST", code: "bad_request" });
      }
      if (method !== "GET" && method !== "HEAD") {
        const rejected = checkCsrf(req);
        if (rejected) return rejected;
      }
      if (path === "/auth/login" && method === "GET") return auth.login();
      if (path === "/auth/callback" && method === "GET") return await auth.callback(req);
      if (path === "/auth/logout" && method === "POST") return auth.logout();
      if (path.startsWith("/auth/")) return json(404, { error: "Такого адреса нет", code: "not_found" });
      if (path === "/api" || path.startsWith("/api/")) return await api(req, url, server);
      return await statics(req);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
