// Сервисы чата: GitHub-адаптер достаёт сырые данные, chat-protocol собирает
// из них ленту. Здесь — порядок вызовов и правила безопасности записи.
import {
  CHAT_TITLE_PREFIX,
  branchForChat,
  buildPrBody,
  buildTimeline,
  chatJsonPath,
  chatTitleFromPr,
  displayName,
  isAgent,
  isAuthor,
  isMessagePath,
  messagePath,
  newChatId,
  newMessageId,
  parseChatJson,
  parseMessageId,
  randomSuffix,
  serializeChatJson,
  serializeMessageFile,
  type AcceptAgentPrResponse,
  type ChatSummary,
  type MessageFile,
  type MessageItem,
  type Participant,
  type TimelineItem,
  type TimelineResponse,
} from "@chat0110/chat-protocol";
import { CHATS_AGENTS_MD, CHATS_CLAUDE_MD } from "./agents-md.ts";
import { HttpError, badRequest, forbidden, notFound } from "./errors.ts";
import { GitHubError, mapLimit, type ChatPull, type GitHubClient, type RepoRef } from "./github.ts";

export interface ChatCtx {
  gh: GitHubClient;
  user: { login: string; id: number };
  now?: () => Date;
  rand?: () => string;
}

export const MAX_MESSAGE = 60_000;
const MAX_TITLE = 200;
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

export async function getTimeline(gh: GitHubClient, repo: RepoRef, chatId: string): Promise<TimelineResponse> {
  const [info, pull] = await Promise.all([gh.getRepo(repo), gh.findChatPull(repo, chatId)]);
  if (!pull) throw notFound("Чат не найден: нет PR из ветки chat/" + chatId);
  const branch = branchForChat(chatId);
  const [entries, commits, comments, reviews, reviewComments, agentPrs, chatJson] = await Promise.all([
    gh.listMessageFiles(repo, chatId),
    gh.listBranchCommits(repo, info.default_branch, chatId),
    gh.listComments(repo, pull.number),
    gh.listReviews(repo, pull.number),
    gh.listReviewComments(repo, pull.number),
    gh.listAgentPulls(repo, chatId),
    gh.getFileText(repo, chatJsonPath(chatId), branch),
  ]);
  const files = await mapLimit(entries, 8, async (e) => ({ name: e.name, content: await gh.getBlob(repo, e.sha) }));
  const items = buildTimeline({ chatId, files, commits, comments, reviews, reviewComments, agentPrs });
  return {
    chat: {
      ...summaryOf(info.full_name, pull),
      head_sha: pull.headSha,
      meta: chatJson === null ? null : parseChatJson(chatJson),
      participants: participantsOf(items),
      can_push: info.can_push,
    },
    items,
  };
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== "string") throw badRequest("Название чата должно быть строкой");
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw badRequest("Название чата пустое");
  if (title.length > MAX_TITLE) throw badRequest(`Название длиннее ${MAX_TITLE} символов`);
  return title;
}

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

export async function createChat(ctx: ChatCtx, repo: RepoRef, req: { title?: unknown; first_message?: unknown }): Promise<ChatSummary> {
  const { gh } = ctx;
  const now = (ctx.now ?? (() => new Date()))();
  const rand = ctx.rand ?? randomSuffix;
  const title = normalizeTitle(req.title);
  const first = req.first_message === undefined || req.first_message === null || req.first_message === ""
    ? undefined
    : normalizeText(req.first_message, "Первое сообщение");
  const login = authorOf(ctx.user.login);

  const info = await gh.getRepo(repo);
  if (!info.can_push) throw forbidden(`Нет права на запись в ${info.full_name}: создать чат нельзя`);
  const base = info.default_branch;

  let head: string;
  let needAgents: boolean;
  let needClaude: boolean;
  try {
    head = await gh.getBranchHead(repo, base);
    [needAgents, needClaude] = await Promise.all([
      gh.getFileText(repo, AGENTS_PATH, base).then((t) => t === null),
      gh.getFileText(repo, CLAUDE_PATH, base).then((t) => t === null),
    ]);
  } catch (e) {
    // Пустое репо Git Data API не принимает (409). Contents API умеет создать
    // первый коммит — кладём им протокол агентов, дальше обычный путь.
    if (!isGh(e, 409, /empty/i)) throw e;
    head = (await gh.putFile(repo, AGENTS_PATH, { message: "chat0110: протокол для агентов", content: CHATS_AGENTS_MD })).commitSha;
    needAgents = false;
    needClaude = true;
  }
  const baseTree = await gh.getCommitTree(repo, head);

  const createdAt = isoSeconds(now);
  const firstMsg: MessageFile | null = first ? { id: newMessageId(now, login, rand), author: login, created_at: createdAt, text: first } : null;

  // Весь чат — один коммит: паспорт, протокол (если его нет) и первое
  // сообщение появляются в ветке атомарно.
  let chatId = "";
  for (let attempt = 1; ; attempt++) {
    chatId = newChatId(now, rand);
    const files = [{ path: chatJsonPath(chatId), content: serializeChatJson({ schema_version: 1, chat_id: chatId, title, created_at: createdAt, created_by: login, parent: null }) }];
    if (needAgents) files.push({ path: AGENTS_PATH, content: CHATS_AGENTS_MD });
    if (needClaude) files.push({ path: CLAUDE_PATH, content: CHATS_CLAUDE_MD });
    if (firstMsg) files.push({ path: messagePath(chatId, firstMsg.id), content: serializeMessageFile(firstMsg) });
    const tree = await gh.createTree(repo, baseTree, files);
    const commit = await gh.createCommit(repo, `chat(${chatId}): создан`, tree, [head]);
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
  const body = buildPrBody({ chatId, ...(first ? { intro: first } : {}) });
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
  };
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

  for (let attempt = 1; ; attempt++) {
    const at = clock();
    const msg: MessageFile = { id: newMessageId(at, login, rand), author: login, created_at: isoSeconds(at), text };
    if (replyTo) msg.reply_to = replyTo;
    try {
      // Каждое сообщение — новый файл: параллельные авторы не конфликтуют по
      // содержимому, а 409 значит лишь «голова ветки сдвинулась» — повторяем.
      const r = await gh.putFile(repo, messagePath(chatId, msg.id), {
        message: `chat(${chatId}): ${login}`,
        content: serializeMessageFile(msg),
        branch: branchForChat(chatId),
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
  const pr = await gh.getPull(repo, number);
  if (pr?.base?.ref !== branch) throw badRequest(`PR #${number} направлен не в ветку ${branch}`);
  if (pr.state !== "open" || pr.merged) throw badRequest(`PR #${number} уже закрыт или влит`);
  const headSha: string = pr.head?.sha;

  const files = await gh.listPullFiles(repo, number);
  if (!files.length) throw badRequest(`В PR #${number} нет файлов`);
  const foreign = files.filter((f) => f.status !== "added" || !isMessagePath(chatId, f.filename));
  if (foreign.length) {
    const list = foreign.slice(0, 3).map((f) => `${f.filename} (${f.status})`).join(", ");
    throw badRequest(`PR #${number} меняет не только новые сообщения чата: ${list}. Такой PR принимают вручную на GitHub.`);
  }

  // Агент мог дописать в PR что-то ещё, пока мы смотрели файлы.
  const again = await gh.getPull(repo, number);
  if (again?.head?.sha !== headSha) throw new HttpError(409, "conflict", `PR #${number} изменился во время проверки — откройте чат заново`);
  return { ok: true, merge_sha: await gh.mergePull(repo, number, headSha) };
}
