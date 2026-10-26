// Сервисы чата: GitHub-адаптер достаёт сырые данные, chat-protocol собирает
// из них ленту. Здесь — порядок вызовов и правила безопасности записи.
import {
  CHAT_TITLE_PREFIX,
  branchForChat,
  buildPrBody,
  buildTimeline,
  CHAT_AGENTS_MD,
  CHAT_AGENTS_PATH,
  CHAT_CLAUDE_MD,
  CHAT_CLAUDE_PATH,
  chatJsonPath,
  chatTitleFromPr,
  conversationViolation,
  type ChatStore,
  decisionPath,
  displayName,
  findForkCommit,
  forkContextPath,
  foldDecisions,
  isAgent,
  isAuthor,
  isMessagePath,
  messagePath,
  newChatId,
  newMessageId,
  parseChatJson,
  parseDecisionFile,
  parseMessageId,
  randomSuffix,
  serializeChatJson,
  serializeDecisionFile,
  serializeForkContext,
  serializeMessageFile,
  type AcceptAgentPrResponse,
  type ChatMeta,
  type ChatParent,
  type ChatSummary,
  type Decision,
  type DecisionEvent,
  type FileInput,
  type ForkPoint,
  type ForkRef,
  type GraphDecision,
  type GraphMessage,
  type GraphResponse,
  type MessageFile,
  type MessageItem,
  type Participant,
  type TimelineInput,
  type TimelineItem,
  type TimelineResponse,
} from "@chat0110/chat-protocol";
import { CHATS_AGENTS_MD, CHATS_CLAUDE_MD } from "./agents-md.ts";
import { draftForkContext, readInherited, type ForkContextDraft } from "./fork-context.ts";
import { HttpError, badRequest, forbidden, notFound } from "./errors.ts";
import { GitHubError, mapLimit, type ChatPull, type GhRepo, type GitHubClient, type RepoRef } from "./github.ts";

export interface ChatCtx {
  gh: GitHubClient;
  user: { login: string; id: number };
  now?: () => Date;
  rand?: () => string;
}

export const MAX_MESSAGE = 60_000;
const MAX_TITLE = 200;
const MAX_FORK_TITLE = 120;
const MAX_REASON = 500;
// Как в протоколе (meta.ts): id сообщения-файла или комментария «c<число>».
const FORK_MESSAGE_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Граф читает листинг каждого чата: шесть разом — без всплеска для вторичного
// лимита GitHub; 200 чатов — потолок одного запроса графа (≈200 запросов,
// почти все 304 по ETag). Старые чаты сверх этого в граф не попадают.
const GRAPH_CONCURRENCY = 6;
const GRAPH_MAX_CHATS = 200;
const LABEL = { name: "chat0110", color: "2f9a55", description: "Чат chat.0110: не сливать" };
const AGENTS_PATH = "chats/AGENTS.md";
const CLAUDE_PATH = "chats/CLAUDE.md";

// Время без миллисекунд — как в протоколе и в имени файла.
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function summaryOf(fullName: string, p: ChatPull): ChatSummary {
  return {
    repo: fullName,
    chat_id: p.chatId,
    title: chatTitleFromPr(p.title),
    number: p.number,
    state: p.state,
    draft: p.draft,
    branch: p.headRef,
    url: p.url,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    created_by: p.author.toLowerCase(),
    parent: p.parent,
  };
}

export async function listChats(gh: GitHubClient, repo: RepoRef): Promise<ChatSummary[]> {
  const [info, pulls] = await Promise.all([gh.getRepo(repo), gh.listChatPulls(repo)]);
  return pulls.map((p) => summaryOf(info.full_name, p));
}

export function participantsOf(items: TimelineItem[]): Participant[] {
  const by = new Map<string, Participant>();
  for (const item of items) {
    if (item.kind !== "message") continue;
    const p = by.get(item.author);
    if (p) {
      p.count++;
      if (item.created_at > p.last_at) p.last_at = item.created_at;
    } else {
      by.set(item.author, { author: item.author, display: item.display, is_agent: isAgent(item.author), last_at: item.created_at, count: 1 });
    }
  }
  // Сначала те, кто писал последним: правая панель показывает живой состав.
  return [...by.values()].sort((a, b) => (a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : a.author.localeCompare(b.author)));
}

async function findPull(gh: GitHubClient, repo: RepoRef, chatId: string): Promise<[GhRepo, ChatPull]> {
  const [info, pull] = await Promise.all([gh.getRepo(repo), gh.findChatPull(repo, chatId)]);
  if (!pull) throw notFound("Чат не найден: нет PR из ветки chat/" + chatId);
  return [info, pull];
}

// Сырые данные одного чата для buildTimeline. Общая часть ленты и Fork:
// точку ветвления ищем ровно в тех коммитах и комментариях, что видит человек.
async function loadTimelineInput(gh: GitHubClient, repo: RepoRef, info: GhRepo, pull: ChatPull): Promise<{ input: TimelineInput; meta: ChatMeta | null; store: ChatStore }> {
  const { chatId } = pull;
  const ref = branchForChat(chatId);
  const store = await gh.chatStore(repo, ref);
  const [entries, decisions, commits, comments, reviews, reviewComments, agentPrs, chatJson] = await Promise.all([
    gh.listMessageFiles(repo, chatId, ref, store),
    gh.getDecisionFiles(repo, chatId, ref),
    // У дочернего чата ветка растёт из ветки родителя: коммиты до точки Fork —
    // история родителя, она приходит отдельно, как inherited.
    gh.listBranchCommits(repo, info.default_branch, chatId, pull.parent?.commit_sha),
    gh.listComments(repo, pull.number),
    gh.listReviews(repo, pull.number),
    gh.listReviewComments(repo, pull.number),
    gh.listAgentPulls(repo, chatId),
    gh.getFileText(repo, chatJsonPath(chatId, store), ref),
  ]);
  const files = await mapLimit(entries, 8, async (e) => ({ name: e.name, content: await gh.getBlob(repo, e.sha) }));
  return {
    input: { chatId, files, commits, comments, reviews, reviewComments, agentPrs, decisions },
    meta: chatJson === null ? null : parseChatJson(chatJson),
    store,
  };
}

const byTimeThenId = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Дочерние чаты — из списка PR (ETag), родитель записан в теле их PR.
function forksOf(chatId: string, chats: ChatPull[]): ForkRef[] {
  return chats
    .filter((c) => c.parent?.chat_id === chatId)
    .map((c): ForkRef => ({
      chat_id: c.chatId,
      title: chatTitleFromPr(c.title),
      number: c.number,
      url: c.url,
      state: c.state,
      message_id: c.parent!.message_id,
      commit_sha: c.parent!.commit_sha,
      created_at: c.createdAt,
      created_by: c.author.toLowerCase(),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.chat_id.localeCompare(b.chat_id)));
}



// События решений → решения. Битый файл пропускается молча, как в ленте:
// его пишут и агенты руками.
function foldFiles(files: FileInput[]): Decision[] {
  return foldDecisions(files.map((f) => parseDecisionFile(f.name, f.content)).filter((e): e is DecisionEvent => e !== null));
}

// Что этот Fork предложил родителю: статус решает родитель, поэтому
// читаем его папку решений на голове его ветки, а не на коммите Fork.
async function outgoingOf(gh: GitHubClient, repo: RepoRef, chatId: string, parentId: string): Promise<Decision[]> {
  return foldFiles(await gh.getDecisionFiles(repo, parentId)).filter((d) => d.from_chat === chatId);
}

export async function getTimeline(gh: GitHubClient, repo: RepoRef, chatId: string): Promise<TimelineResponse> {
  const [info, pull] = await findPull(gh, repo, chatId);
  const [{ input, meta, store }, chats] = await Promise.all([loadTimelineInput(gh, repo, info, pull), gh.listChatPulls(repo)]);
  const items = buildTimeline(input);
  // Источник истины — chat.json; тело PR — запасной путь (chat.json битый или его нет).
  const parent = meta?.parent ?? pull.parent;
  const [inherited, outgoing] = await Promise.all([
    parent ? readInherited(gh, repo, chatId, parent, chats, store) : null,
    parent ? outgoingOf(gh, repo, chatId, parent.chat_id) : [],
  ]);
  return {
    chat: {
      ...summaryOf(info.full_name, pull),
      head_sha: pull.headSha,
      meta,
      participants: participantsOf(items),
      can_push: info.can_push,
    },
    items,
    forks: forksOf(chatId, chats),
    inherited,
    decisions: foldFiles(input.decisions ?? []),
    outgoing,
    chat_store: store,
  };
}

function graphDecision(d: Decision): GraphDecision {
  const g: GraphDecision = { id: d.id, title: d.title, status: d.status, created_at: d.created_at };
  if (d.decided_at) g.decided_at = d.decided_at;
  if (d.from_chat) g.from_chat = d.from_chat;
  if (d.supersedes) g.supersedes = d.supersedes;
  return g;
}

// Граф репо: все чаты (и закрытые) и их собственные сообщения — только из
// имён файлов, без чтения блобов, чтобы дерево строилось дёшево. Решениям
// имени файла мало (статус — свёртка событий), но их единицы, а блобы
// кешируются навсегда по sha.
export async function getGraph(gh: GitHubClient, repo: RepoRef): Promise<GraphResponse> {
  const [info, pulls] = await Promise.all([gh.getRepo(repo), gh.listChatPulls(repo)]);
  const recent = [...pulls].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, GRAPH_MAX_CHATS);
  const chats = await mapLimit(recent, GRAPH_CONCURRENCY, async (p) => {
    const entries = await gh.listMessageFiles(repo, p.chatId);
    const messages: GraphMessage[] = [];
    for (const e of entries) {
      const parts = parseMessageId(e.name.replace(/\.md$/, ""));
      if (parts) messages.push({ id: e.name.replace(/\.md$/, ""), author: parts.author, created_at: parts.date });
    }
    // Внутри чата всё последовательно (и блобы по одному): тогда запросов в
    // полёте не больше GRAPH_CONCURRENCY, как и до решений.
    const decisions = foldFiles(await gh.getDecisionFiles(repo, p.chatId, branchForChat(p.chatId), 1)).map(graphDecision);
    return { ...summaryOf(info.full_name, p), messages: messages.sort(byTimeThenId), decisions };
  });
  return { repo: info.full_name, chats };
}

function normalizeTitle(raw: unknown, max = MAX_TITLE): string {
  if (typeof raw !== "string") throw badRequest("Название чата должно быть строкой");
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw badRequest("Название чата пустое");
  if (title.length > max) throw badRequest(`Название длиннее ${max} символов`);
  return title;
}

const absent = (v: unknown) => v === undefined || v === null || v === "";

function normalizeText(raw: unknown, what: string): string {
  if (typeof raw !== "string") throw badRequest(`${what}: нужен текст`);
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) throw badRequest(`${what}: пустой текст`);
  if (text.length > MAX_MESSAGE) throw badRequest(`${what}: длиннее ${MAX_MESSAGE} символов`);
  return text;
}

// Логин становится автором и частью имени файла. Логины GitHub бывают до 39
// символов, а автор в протоколе — до 32: такой длинный логин писать не сможет.
function authorOf(login: string): string {
  const author = login.toLowerCase();
  if (!isAuthor(author)) throw badRequest(`Логин ${login} не подходит как автор сообщения (длиннее 32 символов?)`);
  return author;
}

const isGh = (e: unknown, status: number, re: RegExp) => e instanceof GitHubError && e.ghStatus === status && re.test(e.ghMessage);

// Fork: чат ответвляется не от головы основной ветки, а от коммита ветки
// родителя, и его PR смотрит в ветку родителя (дифф — только новый чат).
export interface ForkOptions {
  baseSha: string;
  prBase: string;
  parent: ChatParent;
  context: ForkContextDraft;
}

export async function createChat(
  ctx: ChatCtx,
  repo: RepoRef,
  req: { title?: unknown; first_message?: unknown },
  fork?: ForkOptions,
): Promise<ChatSummary> {
  const { gh } = ctx;
  const now = (ctx.now ?? (() => new Date()))();
  const rand = ctx.rand ?? randomSuffix;
  const title = normalizeTitle(req.title);
  const first = absent(req.first_message) ? undefined : normalizeText(req.first_message, "Первое сообщение");
  const login = authorOf(ctx.user.login);

  const info = await gh.getRepo(repo);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}: создать чат нельзя`);
  const base = fork?.prBase ?? info.default_branch;
  // Родитель в теле PR — без причины: причина живёт в chat.json и во вступлении.
  const point: ForkPoint | null = fork
    ? { chat_id: fork.parent.chat_id, message_id: fork.parent.message_id, commit_sha: fork.parent.commit_sha }
    : null;

  let head: string;
  let store: ChatStore = 1;
  let seeded = false;
  if (fork) {
    // Протокол агентов проверяем на самом коммите ветвления: ветка ребёнка
    // — его потомок, и всё, чего там нет, ребёнку нужно положить самому.
    head = fork.baseSha;
    store = await gh.chatStore(repo, head);
  } else {
    try {
      head = await gh.getBranchHead(repo, base);
      store = await gh.chatStore(repo, base);
    } catch (e) {
      // Пустое репо Git Data API не принимает (409). Contents API умеет создать
      // первый коммит — кладём им протокол агентов, дальше обычный путь.
      // Пустое репо ещё не подключено: пишем прежний chats/AGENTS.md.
      if (!isGh(e, 409, /empty/i)) throw e;
      head = (await gh.putFile(repo, AGENTS_PATH, { message: "chat0110: протокол для агентов", content: CHATS_AGENTS_MD })).commitSha;
      seeded = true;
    }
  }
  const agentsPath = store === 2 ? CHAT_AGENTS_PATH : AGENTS_PATH;
  const claudePath = store === 2 ? CHAT_CLAUDE_PATH : CLAUDE_PATH;
  const agentsDoc = store === 2 ? CHAT_AGENTS_MD : CHATS_AGENTS_MD;
  const claudeDoc = store === 2 ? CHAT_CLAUDE_MD : CHATS_CLAUDE_MD;
  let needAgents = false;
  let needClaude = seeded;
  if (!seeded) {
    [needAgents, needClaude] = await Promise.all([
      gh.getFileText(repo, agentsPath, head).then((t) => t === null),
      gh.getFileText(repo, claudePath, head).then((t) => t === null),
    ]);
  }
  const baseTree = await gh.getCommitTree(repo, head);

  const createdAt = isoSeconds(now);
  const firstMsg: MessageFile | null = first ? { id: newMessageId(now, login, rand), author: login, created_at: createdAt, text: first } : null;

  // Весь чат — один коммит: паспорт, протокол (если его нет) и первое
  // сообщение появляются в ветке атомарно.
  let chatId = "";
  for (let attempt = 1; ; attempt++) {
    chatId = newChatId(now, rand);
    const files = [{ path: chatJsonPath(chatId, store), content: serializeChatJson({ schema_version: 1, chat_id: chatId, title, created_at: createdAt, created_by: login, parent: fork?.parent ?? null }) }];
    if (needAgents) files.push({ path: agentsPath, content: agentsDoc });
    if (needClaude) files.push({ path: claudePath, content: claudeDoc });
    if (firstMsg) files.push({ path: messagePath(chatId, firstMsg.id, store), content: serializeMessageFile(firstMsg) });
    if (fork) {
      const pointOnly: ForkPoint = { chat_id: fork.parent.chat_id, message_id: fork.parent.message_id, commit_sha: fork.parent.commit_sha };
      files.push({
        path: forkContextPath(chatId, store),
        content: serializeForkContext({
          schema_version: 1,
          chat_id: chatId,
          created_at: createdAt,
          created_by: login,
          parent: pointOnly,
          complete: fork.context.complete,
          gaps: fork.context.gaps,
          ancestors: fork.context.ancestors,
        }),
      });
    }
    const outside = conversationViolation(files.map((f) => f.path), store);
    if (outside) throw forbidden(`Запись вне каталога чата: ${outside}`);
    const tree = await gh.createTree(repo, baseTree, files);
    const message = fork ? `chat(${chatId}): fork от ${fork.parent.chat_id}` : `chat(${chatId}): создан`;
    const commit = await gh.createCommit(repo, message, tree, [head]);
    try {
      await gh.createBranch(repo, branchForChat(chatId), commit);
      break;
    } catch (e) {
      // 4 символа base36 — коллизия редка, но возможна; ветку не перезаписываем.
      if (attempt < 3 && isGh(e, 422, /already exists/i)) continue;
      throw e;
    }
  }

  const branch = branchForChat(chatId);
  const intro = fork?.parent.reason ?? first;
  const body = buildPrBody({ chatId, ...(intro ? { intro } : {}), ...(point ? { parent: point } : {}), store });
  let pr: any;
  try {
    try {
      pr = await gh.createPull(repo, { title, head: branch, base, body, draft: true });
    } catch (e) {
      // Draft недоступен в приватных репо на бесплатном плане. Тогда обычный
      // PR, а префикс [chat] в названии предупреждает: не сливать.
      if (!isGh(e, 422, /draft/i)) throw e;
      pr = await gh.createPull(repo, { title: CHAT_TITLE_PREFIX + title, head: branch, base, body, draft: false });
    }
  } catch (e) {
    // Без PR ветка — сирота: чата в списке нет, а ветка мусорит. Удаляем.
    await gh.deleteBranch(repo, branch).catch((err) => console.error(`создание чата: не удалось удалить ветку ${branch}`, err));
    throw e;
  }

  try {
    await gh.ensureLabel(repo, LABEL);
    await gh.addLabels(repo, pr.number, [LABEL.name]);
  } catch (e) {
    // Метка — подсказка людям на GitHub; чат определяется веткой и блоком в
    // теле PR, поэтому без метки он всё равно работает.
    console.warn(`создание чата: метку ${LABEL.name} поставить не удалось`, e);
  }

  return {
    repo: info.full_name,
    chat_id: chatId,
    title,
    number: pr.number,
    state: "open",
    draft: pr.draft === true,
    branch,
    url: pr.html_url,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    created_by: login,
    parent: point,
  };
}

// Fork: новый чат от сообщения родителя. Сначала всё, что можно проверить
// без GitHub, затем точка ветвления — в тех же данных, из которых собрана
// лента родителя, и только потом запись.
export async function forkChat(
  ctx: ChatCtx,
  repo: RepoRef,
  parentId: string,
  req: { message_id?: unknown; title?: unknown; reason?: unknown; first_message?: unknown },
): Promise<ChatSummary> {
  const { gh } = ctx;
  if (typeof req.message_id !== "string" || !FORK_MESSAGE_RE.test(req.message_id)) {
    throw badRequest("message_id — не id сообщения (до 64 символов: латиница, цифры, _ и -)");
  }
  const messageId = req.message_id;
  const title = normalizeTitle(req.title, MAX_FORK_TITLE);
  let reason: string | undefined;
  if (!absent(req.reason)) {
    if (typeof req.reason !== "string") throw badRequest("Причина Fork должна быть строкой");
    reason = req.reason.replace(/\r\n?/g, "\n").trim() || undefined;
    if (reason && reason.length > MAX_REASON) throw badRequest(`Причина Fork длиннее ${MAX_REASON} символов`);
  }
  const first = absent(req.first_message) ? undefined : normalizeText(req.first_message, "Первое сообщение");
  // Логин, негодный в авторы, отвергаем сразу, а не после чтения ленты родителя.
  authorOf(ctx.user.login);

  const [info, pull] = await findPull(gh, repo, parentId);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}: создать чат нельзя`);
  const { input } = await loadTimelineInput(gh, repo, info, pull);
  const sha = findForkCommit(input, messageId);
  if (!sha) throw notFound("Сообщение не найдено в ветке чата");

  const parent: ChatParent = { chat_id: parentId, message_id: messageId, commit_sha: sha };
  if (reason) parent.reason = reason;
  const context = await draftForkContext(gh, repo, parent, input, pull);
  return createChat(ctx, repo, { title, ...(first ? { first_message: first } : {}) }, { baseSha: sha, prBase: branchForChat(parentId), parent, context });
}

export async function postMessage(
  ctx: ChatCtx,
  repo: RepoRef,
  chatId: string,
  req: { text?: unknown; reply_to?: unknown },
): Promise<MessageItem> {
  const { gh } = ctx;
  const clock = ctx.now ?? (() => new Date());
  const rand = ctx.rand ?? randomSuffix;
  const text = normalizeText(req.text, "Сообщение");
  let replyTo: string | undefined;
  if (req.reply_to !== undefined && req.reply_to !== null && req.reply_to !== "") {
    if (typeof req.reply_to !== "string" || !parseMessageId(req.reply_to)) throw badRequest("reply_to — не id сообщения");
    replyTo = req.reply_to;
  }
  const login = authorOf(ctx.user.login);
  const info = await gh.getRepo(repo);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}`);
  const branch = branchForChat(chatId);
  const store = await gh.chatStore(repo, branch);

  for (let attempt = 1; ; attempt++) {
    const at = clock();
    const msg: MessageFile = { id: newMessageId(at, login, rand), author: login, created_at: isoSeconds(at), text };
    if (replyTo) msg.reply_to = replyTo;
    const path = messagePath(chatId, msg.id, store);
    const outside = conversationViolation([path], store);
    if (outside) throw forbidden(`Запись вне каталога чата: ${outside}`);
    try {
      // Каждое сообщение — новый файл: параллельные авторы не конфликтуют по
      // содержимому, а 409 значит лишь «голова ветки сдвинулась» — повторяем.
      const r = await gh.putFile(repo, path, {
        message: `chat(${chatId}): ${login}`,
        content: serializeMessageFile(msg),
        branch,
      });
      const item: MessageItem = {
        kind: "message",
        id: msg.id,
        author: login,
        display: displayName(login),
        source: "file",
        text,
        created_at: new Date(msg.created_at).toISOString(),
        actor: login,
        commit_sha: r.commitSha,
        url: r.commitUrl,
        pending: false,
      };
      if (replyTo) item.reply_to = replyTo;
      return orderItem(item);
    } catch (e) {
      if (attempt < 3 && e instanceof GitHubError && e.ghStatus === 409) continue;
      throw e;
    }
  }
}

// Тот же порядок полей, что у buildTimeline: клиенту проще сравнивать.
function orderItem(m: MessageItem): MessageItem {
  const out = { kind: m.kind, id: m.id, author: m.author, display: m.display, source: m.source, text: m.text } as MessageItem;
  if (m.reply_to) out.reply_to = m.reply_to;
  return Object.assign(out, { created_at: m.created_at, actor: m.actor, commit_sha: m.commit_sha, url: m.url, pending: m.pending });
}

// «Принять в чат» сливает PR агента в ветку чата. Кнопка нажимается
// человеком с правом записи, поэтому проверяем строго: только новые
// файлы-сообщения этого чата, и сливаем ровно тот head, который проверили.
export async function acceptAgentPr(gh: GitHubClient, repo: RepoRef, chatId: string, number: number): Promise<AcceptAgentPrResponse> {
  if (!Number.isInteger(number) || number <= 0) throw badRequest("Номер PR — положительное целое");
  const branch = branchForChat(chatId);
  const store = await gh.chatStore(repo, branch);
  const pr = await gh.getPull(repo, number);
  if (pr?.base?.ref !== branch) throw badRequest(`PR #${number} направлен не в ветку ${branch}`);
  if (pr.state !== "open" || pr.merged) throw badRequest(`PR #${number} уже закрыт или влит`);
  const headSha: string = pr.head?.sha;

  const files = await gh.listPullFiles(repo, number);
  if (!files.length) throw badRequest(`В PR #${number} нет файлов`);
  const foreign = files.filter((f) => f.status !== "added" || !isMessagePath(chatId, f.filename, store));
  if (foreign.length) {
    const list = foreign.slice(0, 3).map((f) => `${f.filename} (${f.status})`).join(", ");
    throw badRequest(`PR #${number} меняет не только новые сообщения чата: ${list}. Такой PR принимают вручную на GitHub.`);
  }

  // Агент мог дописать в PR что-то ещё, пока мы смотрели файлы.
  const again = await gh.getPull(repo, number);
  if (again?.head?.sha !== headSha) throw new HttpError(409, "conflict", `PR #${number} изменился во время проверки — откройте чат заново`);
  return { ok: true, merge_sha: await gh.mergePull(repo, number, headSha) };
}

// ——— Решения (Этап 5) ———

const MAX_DECISION_TITLE = 160;
const MAX_DECISION_TEXT = 20_000;
const MAX_SOURCES = 50;
// Как source_messages в протоколе: id файла-сообщения или комментария «c<число>».
const SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const DECISION_VERBS = ["accept", "reject", "reopen", "discuss"] as const;
export type DecisionVerb = (typeof DECISION_VERBS)[number];
const isDecisionVerb = (v: string): v is DecisionVerb => (DECISION_VERBS as readonly string[]).includes(v);

interface ProposalFields {
  title: string;
  text: string;
  source_messages: string[];
  supersedes?: string;
}

type ProposalRequest = { title?: unknown; text?: unknown; source_messages?: unknown; supersedes?: unknown };

function decisionText(raw: unknown, what: string): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw badRequest(`${what}: нужен текст`);
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length > MAX_DECISION_TEXT) throw badRequest(`${what}: длиннее ${MAX_DECISION_TEXT} символов`);
  return text;
}

// Всё, что можно проверить без GitHub, проверяется до первого запроса:
// title, id и supersedes попадают во frontmatter и в имена файлов.
function normalizeProposal(req: ProposalRequest): ProposalFields {
  if (typeof req.title !== "string") throw badRequest("Нужно название решения");
  const title = req.title.replace(/\s+/g, " ").trim();
  if (!title) throw badRequest("Название решения пустое");
  if (title.length > MAX_DECISION_TITLE) throw badRequest(`Название решения длиннее ${MAX_DECISION_TITLE} символов`);
  const text = decisionText(req.text, "Обоснование решения");
  let sources: string[] = [];
  if (req.source_messages !== undefined && req.source_messages !== null) {
    if (!Array.isArray(req.source_messages)) throw badRequest("source_messages — список id сообщений");
    if (req.source_messages.length > MAX_SOURCES) throw badRequest(`source_messages: не больше ${MAX_SOURCES} сообщений`);
    for (const id of req.source_messages) {
      if (typeof id !== "string" || !SOURCE_RE.test(id)) throw badRequest("source_messages: не id сообщения (до 64 символов: латиница, цифры, _ и -)");
    }
    sources = req.source_messages as string[];
  }
  const out: ProposalFields = { title, text, source_messages: sources };
  if (!absent(req.supersedes)) {
    if (typeof req.supersedes !== "string" || !parseMessageId(req.supersedes)) throw badRequest("supersedes — не id решения");
    out.supersedes = req.supersedes;
  }
  return out;
}

// Ответ API — то, что потом прочтёт из файла лента: пишем, разбираем
// записанное обратно и сворачиваем, а не собираем решение вручную.
function reread(ev: DecisionEvent): DecisionEvent {
  return parseDecisionFile(`${ev.id}.md`, serializeDecisionFile(ev))!;
}

function decisionOf(events: DecisionEvent[], id: string): Decision {
  const d = foldDecisions(events).find((x) => x.id === id);
  if (!d) throw new Error(`решение ${id} пропало при свёртке`);
  return d;
}

async function requireDecision(gh: GitHubClient, repo: RepoRef, chatId: string, id: string): Promise<void> {
  const ds = foldFiles(await gh.getDecisionFiles(repo, chatId));
  if (!ds.some((d) => d.id === id)) throw badRequest(`supersedes: решение ${id} не найдено в чате ${chatId}`);
}

// Логин человека, совпавший с id агента (GitHub-пользователь «claude»),
// свёртка примет за агента: его accept/reject/reopen останутся в истории, но
// статус не сдвинут. Записать такое событие молча — значит обмануть кнопку.
function requireHumanVerdict(login: string, action: DecisionVerb): void {
  if (action !== "discuss" && isAgent(login)) {
    throw forbidden(`Логин ${login} совпадает с id агента: по протоколу его ${action} не меняет статус решения`);
  }
}

async function refuseDecisions(gh: GitHubClient, repo: RepoRef, ref: string): Promise<void> {
  if ((await gh.chatStore(repo, ref)) === 2) {
    throw forbidden("В подключённом репозитории чат не принимает решения. Текст PR — только обсуждение.");
  }
}

async function requirePush(gh: GitHubClient, repo: RepoRef): Promise<void> {
  const info = await gh.getRepo(repo);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}`);
}

// Ветку сдвинул кто-то другой: PATCH без force отвечает 422 «not a fast
// forward» (или 409). Свой коммит в этом случае просто строится заново.
const movedUnder = (e: unknown) =>
  e instanceof GitHubError && (e.ghStatus === 409 || (e.ghStatus === 422 && /fast[- ]forward/i.test(e.ghMessage)));

// Несколько файлов одним коммитом: Contents API кладёт по файлу на коммит,
// а «предложить и сразу принять» должно появиться в ветке атомарно.
async function commitFiles(gh: GitHubClient, repo: RepoRef, branch: string, files: { path: string; content: string }[], message: string): Promise<string> {
  const outside = conversationViolation(files.map((f) => f.path), 1);
  if (outside) throw forbidden(`Запись вне каталога чата: ${outside}`);
  for (let attempt = 1; ; attempt++) {
    let head: string;
    try {
      head = await gh.getBranchHead(repo, branch);
    } catch (e) {
      if (e instanceof GitHubError && e.code === "not_found") throw notFound(`Чат не найден: нет ветки ${branch}`);
      throw e;
    }
    const tree = await gh.createTree(repo, await gh.getCommitTree(repo, head), files);
    const commit = await gh.createCommit(repo, message, tree, [head]);
    try {
      await gh.updateBranch(repo, branch, commit);
      return commit;
    } catch (e) {
      if (attempt < 3 && movedUnder(e)) continue;
      throw e;
    }
  }
}

// Решение в своём чате. С accept: true человек сразу фиксирует принятое —
// предложение и принятие одним коммитом.
export async function createDecision(
  ctx: ChatCtx,
  repo: RepoRef,
  chatId: string,
  req: ProposalRequest & { accept?: unknown },
): Promise<Decision> {
  const { gh } = ctx;
  const now = (ctx.now ?? (() => new Date()))();
  const rand = ctx.rand ?? randomSuffix;
  const p = normalizeProposal(req);
  if (req.accept !== undefined && req.accept !== null && typeof req.accept !== "boolean") throw badRequest("accept — true или false");
  const accept = req.accept === true;
  const login = authorOf(ctx.user.login);
  if (accept) requireHumanVerdict(login, "accept");
  await requirePush(gh, repo);
  await refuseDecisions(gh, repo, branchForChat(chatId));
  if (p.supersedes) await requireDecision(gh, repo, chatId, p.supersedes);

  const id = newMessageId(now, login, rand);
  const events: DecisionEvent[] = [{ id, decision: id, action: "propose", author: login, created_at: isoSeconds(now), ...p }];
  if (accept) {
    // Свёртка упорядочивает по времени, затем по id. В ту же секунду принятие
    // со случайным хвостом могло бы встать раньше предложения и потеряться.
    const later = new Date(now.getTime() + 1000);
    const acceptId = newMessageId(later, login, rand);
    events.push({ id: acceptId, decision: id, action: "accept", author: login, created_at: isoSeconds(later), source_messages: [], text: "" });
  }
  const files = events.map((e) => ({ path: decisionPath(chatId, e.id), content: serializeDecisionFile(e) }));
  await commitFiles(gh, repo, branchForChat(chatId), files, `chat(${chatId}): решение ${login}`);
  return decisionOf(events.map(reread), id);
}

// Переходы, которые человек не имел в виду: протокол разрешает свёртке
// любые, но кнопка «Принять» на уже принятом — это устаревший экран.
function refusal(d: Decision, action: DecisionVerb): string | null {
  if (d.status === "superseded") return action === "reopen" ? null : "Решение заменено другим — сначала откройте его заново";
  const open = d.status === "proposed" || d.status === "under_discussion" || d.status === "reopened";
  switch (action) {
    case "accept":
      return d.status === "accepted" ? "Решение уже принято" : open ? null : "Решение отклонено — чтобы принять, сначала откройте его заново";
    case "reject":
      return d.status === "rejected" ? "Решение уже отклонено" : open ? null : "Решение принято — чтобы отклонить, сначала откройте его заново";
    case "reopen":
      return open ? "Решение и так открыто" : null;
    case "discuss":
      return null;
  }
}

export async function decisionAction(
  ctx: ChatCtx,
  repo: RepoRef,
  chatId: string,
  decisionId: string,
  action: string,
  req: { text?: unknown },
): Promise<Decision> {
  const { gh } = ctx;
  const clock = ctx.now ?? (() => new Date());
  const rand = ctx.rand ?? randomSuffix;
  if (!parseMessageId(decisionId)) throw badRequest("Неверный id решения");
  if (!isDecisionVerb(action)) throw badRequest("Неизвестное действие с решением: accept, reject, reopen или discuss");
  const text = decisionText(req.text, "Комментарий к решению");
  if (action === "discuss" && !text) throw badRequest("Обсуждение: пустой текст");
  const login = authorOf(ctx.user.login);
  requireHumanVerdict(login, action);
  await requirePush(gh, repo);
  await refuseDecisions(gh, repo, branchForChat(chatId));

  const events = (await gh.getDecisionFiles(repo, chatId))
    .map((f) => parseDecisionFile(f.name, f.content))
    .filter((e): e is DecisionEvent => e !== null);
  const all = foldDecisions(events);
  const d = all.find((x) => x.id === decisionId);
  if (!d) throw notFound("Решение не найдено в ветке чата");
  const reason = refusal(d, action);
  if (reason) throw new HttpError(409, "conflict", reason);

  // Событие должно встать в свёртке последним: часы сервера могут отставать
  // от уже записанного (принятие «на секунду позже», часы агента). Для
  // заменённого решения учитываем и принятие замены — иначе reopen уйдёт под него.
  const related = [d, ...all.filter((x) => x.id === d.superseded_by)];
  const last = Math.max(...related.flatMap((x) => x.history.map((h) => Date.parse(h.created_at))).filter(Number.isFinite));

  for (let attempt = 1; ; attempt++) {
    const at = new Date(Math.max(clock().getTime(), last + 1000));
    const ev: DecisionEvent = { id: newMessageId(at, login, rand), decision: d.id, action, author: login, created_at: isoSeconds(at), source_messages: [], text };
    try {
      await gh.putFile(repo, decisionPath(chatId, ev.id), {
        message: `chat(${chatId}): ${action} решения ${login}`,
        content: serializeDecisionFile(ev),
        branch: branchForChat(chatId),
      });
      return decisionOf([...events, reread(ev)], d.id);
    } catch (e) {
      // Новый файл не конфликтует по содержимому: 409 — лишь сдвиг головы.
      if (attempt < 3 && e instanceof GitHubError && e.ghStatus === 409) continue;
      throw e;
    }
  }
}

// «Предложить родителю» (п. 4.7 спеки): предложение рождается в Fork, но
// решать его будет родитель — событие пишется в ветку и папку решений родителя.
export async function proposeToParent(ctx: ChatCtx, repo: RepoRef, forkId: string, req: ProposalRequest): Promise<Decision> {
  const { gh } = ctx;
  const clock = ctx.now ?? (() => new Date());
  const rand = ctx.rand ?? randomSuffix;
  const p = normalizeProposal(req);
  const login = authorOf(ctx.user.login);

  const forkRef = branchForChat(forkId);
  const forkStore = await gh.chatStore(repo, forkRef);
  const [info, chatJson] = await Promise.all([gh.getRepo(repo), gh.getFileText(repo, chatJsonPath(forkId, forkStore), forkRef)]);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}`);
  // Как в ленте: источник истины — chat.json, тело PR — запасной путь.
  const meta = chatJson === null ? null : parseChatJson(chatJson);
  let parentId = meta?.parent?.chat_id;
  if (!parentId) {
    const pull = await gh.findChatPull(repo, forkId);
    if (!pull && !meta) throw notFound("Чат не найден: нет PR из ветки chat/" + forkId);
    parentId = pull?.parent?.chat_id;
  }
  if (!parentId) throw badRequest("Это не Fork — предлагать некому");
  await refuseDecisions(gh, repo, branchForChat(parentId));
  if (p.supersedes) await requireDecision(gh, repo, parentId, p.supersedes);

  for (let attempt = 1; ; attempt++) {
    const at = clock();
    const id = newMessageId(at, login, rand);
    const ev: DecisionEvent = { id, decision: id, action: "propose", author: login, created_at: isoSeconds(at), ...p, from_chat: forkId };
    try {
      await gh.putFile(repo, decisionPath(parentId, id), {
        // По этой строке вебхук будит и Fork: его outgoing живёт в чужой ветке.
        message: `chat(${parentId}): предложение из Fork ${forkId}`,
        content: serializeDecisionFile(ev),
        branch: branchForChat(parentId),
      });
      return decisionOf([reread(ev)], id);
    } catch (e) {
      if (attempt < 3 && e instanceof GitHubError && e.ghStatus === 409) continue;
      throw e;
    }
  }
}
