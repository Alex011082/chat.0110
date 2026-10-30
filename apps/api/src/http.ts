import { Privacy } from "./privacy.ts";
import { SqlitePrivacyCache } from "./privacy-cache.ts";
import { Database } from "bun:sqlite";
import { McpOAuth } from "./mcp-oauth.ts";
import { McpEvents } from "./mcp-events.ts";
import { createRemoteMcp } from "./remote-mcp.ts";
import { mentionRoute, canonicalMention } from "@chat0110/chat-protocol";
import { DispatchStore } from "./dispatch.ts";
// Роутер на голом Bun.serve: маршрутов мало, и рукописная таблица проще
// фреймворка. Каждый параметр из адреса проверяется регуляркой ДО того,
// как попадёт в URL GitHub.
import {
  isChatId,
  type AppConfig,
  type ChatActivation,
  type ChatMigration,
  type CreateChatResponse,
  type DecisionResponse,
  type Me,
  type PostMessageResponse,
} from "@chat0110/chat-protocol";
import { activateChat, activationStatus } from "./activate.ts";
import { migrateChats, migrationStatus } from "./migrate.ts";
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
  requireOpenChat,
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
  privacy?: Privacy;
  dispatch?: DispatchStore;
  stateDb?: Database;
  background?: boolean;
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
  console.error("необработанная ошибка запроса");
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
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw badRequest("Тело запроса должно быть JSON-объектом");
  return body as Record<string, unknown>;
}

export async function createApp(deps: AppDeps): Promise<App> {
  const { config } = deps;
  const stateDb = deps.stateDb ?? new Database(":memory:");
  const privacy = deps.privacy ?? new Privacy(undefined, new SqlitePrivacyCache(stateDb, config.cookieKey));
  const dispatch = deps.dispatch ?? new DispatchStore(stateDb);
  const fetcher = deps.fetch ?? fetch;
  const caches = deps.caches ?? createCaches();
  const hub = deps.hub ?? new SseHub();
  const sessions =
    deps.sessions ??
    new SessionStore({
      key: await importCookieKey(config.cookieKey),
      dev: config.devCookies,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      fetch: fetcher,
    });
  const auth = createAuth({ config, sessions, fetch: fetcher });
  const key = await importCookieKey(config.cookieKey);
  const oauth = new McpOAuth({ db: stateDb, key, publicUrl: config.publicUrl, sessions, config });
  const events = new McpEvents({ db: stateDb, key });
  const remote = createRemoteMcp({ config, dispatch, oauth, events, hub, privacy, fetch: fetcher });
  if (deps.background) {
    const timer = setInterval(() => void remote.pump(), 2000);
    timer.unref();
  }
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
    const ctx: ChatCtx = { gh, user: { login: session.login, id: session.uid }, privacy };
    if (deps.now) ctx.now = deps.now;
    if (deps.rand) ctx.rand = deps.rand;

    const res = await (async (): Promise<Response> => {
      if (path === "/api/connections" && method === "GET")
        return json(200, { chatgpt: { ...events.status(`chatgpt:${session.uid}`), authorized: oauth.hasAuthorization(`chatgpt:${session.uid}`, "chatgpt.com") } });
      if (path === "/api/connections/disconnect" && method === "POST") {
        events.disconnect(`chatgpt:${session.uid}`);
        await oauth.disconnect(`chatgpt:${session.uid}`);
        return json(200, { ok: true });
      }
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
      if (path === "/api/migration" && method === "GET") {
        return json(200, await migrationStatus(gh, repoFromParam(url.searchParams.get("repo"))));
      }
      if (path === "/api/migration" && method === "POST") {
        const body = await readJson(req);
        const out: ChatMigration = await migrateChats(gh, repoFromParam(body.repo ?? url.searchParams.get("repo")), privacy);
        return json(200, out);
      }
      if (path === "/api/chats" && method === "GET")
        return json(200, await listChats(gh, repoFromParam(url.searchParams.get("repo")), privacy));
      if (path === "/api/chats" && method === "POST") {
        const body = await readJson(req);
        const repo = repoFromParam(body.repo ?? url.searchParams.get("repo"));
        const out: CreateChatResponse = {
          chat: await createChat(ctx, repo, { title: body.title, first_message: body.first_message }),
        };
        return json(201, out);
      }
      if (path === "/api/graph" && method === "GET")
        return json(200, await getGraph(gh, repoFromParam(url.searchParams.get("repo")), privacy));
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
          [owner, name, chatId] = [
            decodeURIComponent(seg[2]!),
            decodeURIComponent(seg[3]!),
            decodeURIComponent(seg[4]!),
          ];
        } catch {
          throw badRequest("Неверный адрес");
        }
        const repo = repoRef(owner, name);
        if (!isChatId(chatId)) throw badRequest("Неверный id чата: ожидается ГГГГММДД-xxxx");
        const rest = seg.slice(5);

        if (method === "GET" && (rest.length === 0 || (rest.length === 1 && rest[0] === "timeline"))) {
          return json(200, await getTimeline(gh, repo, chatId, privacy));
        }
        if (rest.length === 1 && rest[0] === "privacy" && method === "POST") {
          await gh.getRepo(repo);
          const pull = await gh.findChatPull(repo, chatId);
          if (!pull) throw notFound("Чат не найден");
          const body = await readJson(req);
          if (typeof body.text !== "string" || body.text.length > 60_000) throw badRequest("Нужен текст до 60000 знаков");
          return json(200, await privacy.scan(body.text));
        }
        if (rest.length === 1 && rest[0] === "dispatch" && method === "GET") {
          await gh.getRepo(repo);
          return json(200, remote.view(session.uid, `${repo.owner}/${repo.name}`, chatId));
        }
        if (rest.length === 1 && rest[0] === "auto-replies" && method === "POST") {
          const body = await readJson(req);
          const bySession=typeof body.session_id==="string"&&!!body.session_id;
          const byAuthor=typeof body.author==="string"&&!!body.author;
          if (bySession===byAuthor || typeof body.enabled !== "boolean")
            throw badRequest("Нужны ровно один session_id/author и enabled");
          const info = await gh.getRepo(repo);
          if (!info.can_push) throw forbidden("Нет права записи");
          const pull = await gh.findChatPull(repo, chatId);
          if (!pull) throw notFound("Чат не найден");
          if (pull.state !== "open") throw forbidden("Чат закрыт");
          if(bySession){
            const agent=dispatch.session(body.session_id as string,session.uid);
            if(agent.repo!==info.full_name.toLowerCase()||agent.chat!==chatId)throw notFound("Сессия не найдена");
            dispatch.setAutoEnabled(session.uid,agent.id,body.enabled);
          }else dispatch.requestAuto(session.uid,info.full_name,chatId,body.author as string,body.enabled);
          if (body.enabled && deps.background) void remote.pump();
          return json(200, remote.view(session.uid, info.full_name, chatId));
        }
        if (rest.length === 1 && rest[0] === "dispatch" && method === "POST") {
          const info = await gh.getRepo(repo);
          if (!info.can_push) throw forbidden("Нет права записи");
          const body = await readJson(req);
          const c = dispatch.chain(String(body.id), session.uid);
          if (!c || c.repo !== info.full_name.toLowerCase() || c.chat !== chatId) throw notFound("Цепочка не найдена");
          dispatch.cancel(session.uid, c.id);
          return json(200, { ok: true });
        }
        if (method === "POST" && rest.length === 1 && rest[0] === "messages") {
          const body = await readJson(req);
          let route: string[];
          try {
            route = mentionRoute(typeof body.text === "string" ? body.text : "");
          } catch {
            throw badRequest("Нужен один @адресат и не больше одного @@участника");
          }
          if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 60_000) throw badRequest("Нужен текст до 60000 знаков");
          if ((route.length || body.request_id !== undefined) && (typeof body.request_id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.request_id))) throw badRequest("Нужен request_id для сообщения");
          body.text = (await privacy.scan(body.text.replace(/\r\n?/g, "\n").trim())).text;
          let delivery: { id: string; author: string } | undefined;
          let chainId: string | undefined;
          if (route.length) {
            if (typeof body.request_id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.request_id))
              throw badRequest("Нужен request_id для адресного сообщения");
            await requireOpenChat(gh, repo, chatId);
            if (route.some((alias) => canonicalMention(alias) === "chatgpt"))
              dispatch.ensureCloud(session.uid, `${repo.owner}/${repo.name}`, chatId);
            const routeIds = dispatch.resolve(session.uid, `${repo.owner}/${repo.name}`, chatId, route);
            chainId = `${session.uid}:${body.request_id}`;
            const old = dispatch.chain(chainId, session.uid);
            const author = session.login.toLowerCase();
            delivery = dispatch.preparePublication(body.request_id, session.uid, `${repo.owner}/${repo.name}`, chatId, author, body.text as string, body.reply_to, old?.message_id);
            dispatch.enqueue(
              chainId,
              session.uid,
              `${repo.owner}/${repo.name}`,
              chatId,
              delivery.id,
              String(body.text).trim(),
              routeIds,
              true,
            );
            if (old?.status === "cancelled") throw new HttpError(409, "conflict", "Цепочка отменена");
          }
          if (!route.length && body.request_id !== undefined) {
            if (typeof body.request_id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.request_id)) throw badRequest("Неверный request_id");
            if (!(await gh.getRepo(repo)).can_push) throw forbidden("Нет права записи");
            delivery = dispatch.preparePublication(body.request_id, session.uid, `${repo.owner}/${repo.name}`, chatId, session.login.toLowerCase(), body.text as string, body.reply_to);
          }
          const out: PostMessageResponse = {
            item: await postMessage(ctx, repo, chatId, { text: body.text, reply_to: body.reply_to }, delivery),
          };
          if (chainId) {
            dispatch.activate(chainId, session.uid);
            if (deps.background) void remote.pump();
          }
          hub.publish(`${repo.owner}/${repo.name}`, "chat.updated", {
            repo: `${repo.owner}/${repo.name}`,
            chat_id: chatId,
            number: null,
          });
          return json(201, out);
        }
        if (method === "POST" && rest.length === 1 && rest[0] === "fork") {
          const body = await readJson(req);
          const out: CreateChatResponse = {
            chat: await forkChat(ctx, repo, chatId, {
              message_id: body.message_id,
              title: body.title,
              reason: body.reason,
              first_message: body.first_message,
            }),
          };
          return json(201, out);
        }
        if (method === "POST" && rest.length === 1 && rest[0] === "decisions") {
          const body = await readJson(req);
          const out: DecisionResponse = {
            decision: await createDecision(ctx, repo, chatId, {
              title: body.title,
              text: body.text,
              source_messages: body.source_messages,
              supersedes: body.supersedes,
              accept: body.accept,
            }),
          };
          return json(201, out);
        }
        // id решения и действие проверяет decisionAction до первого запроса в GitHub.
        if (method === "POST" && rest.length === 3 && rest[0] === "decisions") {
          const body = await readJson(req);
          const out: DecisionResponse = {
            decision: await decisionAction(ctx, repo, chatId, rest[1]!, rest[2]!, { text: body.text }),
          };
          return json(200, out);
        }
        // chatId здесь — Fork: предложение уходит в ветку его родителя.
        if (method === "POST" && rest.length === 1 && rest[0] === "propose") {
          const body = await readJson(req);
          const out: DecisionResponse = {
            decision: await proposeToParent(ctx, repo, chatId, {
              title: body.title,
              text: body.text,
              source_messages: body.source_messages,
              supersedes: body.supersedes,
            }),
          };
          return json(201, out);
        }
        if (method === "POST" && rest.length === 3 && rest[0] === "agent-prs" && rest[2] === "accept") {
          if (!NUMBER_RE.test(rest[1]!)) throw badRequest("Неверный номер PR");
          return json(200, await acceptAgentPr(gh, repo, chatId, Number(rest[1]), privacy));
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

  // Локальный коннектор использует собственную авторизацию GitHub. Токен не сохраняется.
  async function agentApi(req: Request, path: string): Promise<Response> {
    if (req.method !== "POST") return json(405, { error: "Только POST", code: "bad_request" });
    if (req.headers.has("origin") && req.headers.get("origin") !== config.publicOrigin) throw forbidden("Чужой Origin");
    const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw unauthorized();
    const gh = new GitHubClient({ token, userId: 0, fetch: fetcher });
    const user = await gh.getUser();
    if (!isLoginAllowed(config, user.login)) throw forbidden("Вход закрыт");
    const body = await readJson(req);
    const ctx: ChatCtx = { gh, user: { login: user.login, id: user.id }, privacy };
    if (path === "/api/agent/register") {
      const repo = repoFromParam(body.repo);
      if (typeof body.chat_id !== "string" || !isChatId(body.chat_id)) throw badRequest("Неверный чат");
      const info = await requireOpenChat(gh, repo, body.chat_id);
      return json(
        200,
        dispatch.register(
          user.id,
          info.full_name,
          body.chat_id,
          String(body.session_id ?? ""),
          String(body.alias ?? ""),
          String(body.name ?? ""),
          String(body.author ?? ""),
          String(body.model ?? ""),
        ),
      );
    }
    const session = dispatch.session(String(body.session_id), user.id);
    const repo = repoFromParam(session.repo);
    const info = await gh.getRepo(repo);
    if (!info.can_push) throw forbidden("Нет права записи");
    dispatch.touch(session.id);
    if(path==="/api/agent/status"||path==="/api/agent/auto-replies"){
      await requireOpenChat(gh,repo,session.chat);
      if(path.endsWith("auto-replies")){
        if(typeof body.enabled!=="boolean")throw badRequest("Нужен enabled boolean");
        dispatch.setAutoEnabled(user.id,session.id,body.enabled);
      }
      return json(200,{version:"2.1.0",session:dispatch.list(user.id,session.repo,session.chat).sessions.find(s=>s.id===session.id),requires_live_client:true});
    }
    if (path === "/api/agent/next") {
      const pull = await gh.findChatPull(repo, session.chat);
      if (!pull || pull.state !== "open") throw new HttpError(409, "conflict", "Чат закрыт");
      const until = Date.now() + (body.wait === true ? 25_000 : 0);
      let task;
      const stopWaiting = body.wait === true ? dispatch.waiting(session.id, user.id) : () => {};
      req.signal.addEventListener("abort", stopWaiting, { once: true });
      try {
        do {
          task = dispatch.claim(session.id);
          if (task || Date.now() >= until || req.signal.aborted) break;
          await Bun.sleep(500);
        } while (true);
      } finally { stopWaiting(); req.signal.removeEventListener("abort", stopWaiting); }
      if (!task) return json(200, { task: null });
      const chain = dispatch.chain(task.chain_id, user.id)!;
      return json(200, {
        task: await privacy.object(task),
        prompt: (await privacy.scan(chain.prompt)).text,
        repo: session.repo,
        chat_id: session.chat,
        url: `${config.publicUrl}/${session.repo}/${session.chat}`,
        final: task.step === JSON.parse(chain.route).length - 1,
        expires_at: chain.expires_at,
      });
    }
    const task = dispatch.task(String(body.task_id), session.id, String(body.claim), path === "/api/agent/complete");
    if (path === "/api/agent/heartbeat") {
      dispatch.heartbeat(task.id, session.id, String(body.claim));
      return json(200, { ok: true });
    }
    if (path === "/api/agent/context") return json(200, await getTimeline(gh, repo, session.chat, privacy));
    if (path === "/api/agent/complete") {
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 60_000)
        throw badRequest("Нужен ответ до 60000 знаков");
      // Одинаковый id и сохранённый текст делают повтор после обрыва безопасным.
      body.text = (await privacy.scan(body.text.replace(/\r\n?/g, "\n").trim())).text;
      dispatch.prepareAnswer(task.id, session.id, String(body.claim), body.text as string, body.outcome === undefined ? "continue" : String(body.outcome));
      const pull = await gh.findChatPull(repo, session.chat);
      if (!pull || pull.state !== "open") throw new HttpError(409, "conflict", "Чат закрыт");
      const item = await postMessage(
        ctx,
        repo,
        session.chat,
        { text: body.text, reply_to: task.reply_to },
        { id: task.answer_id, author: session.author },
      );
      dispatch.finish(task.id, String(body.claim), item.id);
      hub.publish(session.repo, "chat.updated", { repo: session.repo, chat_id: session.chat, number: null });
      return json(200, { item });
    }
    throw notFound("Неизвестный метод коннектора");
  }

  return async (req, server) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    // Большой текст проверяется локально, до побочных эффектов. SSE ниже
    // отдельно снимает таймаут; остальных клиентов не обрываем через 60 с.
    if ((path.startsWith("/api/") && path !== "/api/events") || path === "/mcp") server?.timeout?.(req, 240);
    try {
      const oauthResponse = await oauth.handle(req);
      if (oauthResponse) return oauthResponse;
      if (path === "/mcp") return await remote.handle(req);
      if (path.startsWith("/api/agent/")) return await agentApi(req, path);
      if (path === "/health") return json(200, { ok: true });
      // Вебхук приходит от GitHub без Origin; его защищает HMAC-подпись.
      if (path === "/api/github/webhook") {
        return method === "POST" ? await webhook(req) : json(405, { error: "Только POST", code: "bad_request" });
      }
      if (method !== "GET" && method !== "HEAD") {
        const rejected = checkCsrf(req);
        if (rejected) return rejected;
      }
      if (path === "/auth/login" && method === "GET") return auth.login(req);
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
