import {
  stampOf,
  type ChatDetail,
  type ChatSummary,
  type MessageItem,
  type RepoInfo,
  type TimelineItem,
  type TimelineResponse,
} from "@chat0110/chat-protocol";
import { ApiFailure, type Api } from "./api.ts";

// Пробный режим для разработки и проверки вида (?mock=1). Только выдуманные
// данные по контракту api.ts; сети нет. В сборку для сервера не попадает:
// api.ts подключает модуль лишь при import.meta.env.DEV.
//
// Режимы: 1 — всё; login — не вошёл; forbidden — вход закрыт; norepos — App
// нигде не установлено; nochats — пустое репо; readonly — без права записи;
// live — через 12 с «приходит» сообщение Codex.

const OWNER = "Alex011082";
const REPO = `${OWNER}/chat.0110`;
const GH = `https://github.com/${REPO}`;
const MIN = 60_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (t: number) => new Date(t).toISOString();
const rand4 = () => Math.random().toString(36).slice(2, 6).padEnd(4, "0");
const sha = () => Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const msgId = (t: number, author: string, r = rand4()) => `${stampOf(new Date(t))}-${author}-${r}`;

function fixtures(mode: string) {
  const now = Date.now();
  const readonly = mode === "readonly";
  const repos: RepoInfo[] = [
    { full_name: REPO, owner: OWNER, name: "chat.0110", private: false, default_branch: "main", can_push: !readonly, installation_id: 1 },
    { full_name: `${OWNER}/Y-TNG`, owner: OWNER, name: "Y-TNG", private: true, default_branch: "main", can_push: true, installation_id: 1 },
  ];

  const summary = (o: Partial<ChatSummary> & Pick<ChatSummary, "chat_id" | "title" | "number">): ChatSummary => ({
    repo: REPO,
    state: "open",
    draft: true,
    branch: `chat/${o.chat_id}`,
    url: `${GH}/pull/${o.number}`,
    created_at: iso(now - 26 * 60 * MIN),
    updated_at: iso(now - 60 * MIN),
    created_by: "alex011082",
    ...o,
  });

  const chats: ChatSummary[] = [
    summary({ chat_id: "20261023-k7q2", title: "RoboChain — захват коробок", number: 3, updated_at: iso(now - 5 * MIN), created_at: iso(now - 20 * 60 * MIN) }),
    summary({ chat_id: "20261022-y2tn", title: "YTNG — второе мнение", number: 2, updated_at: iso(now - 64 * MIN) }),
    summary({ chat_id: "20261021-qa01", title: "QA Board — нестабильные тесты", number: 1, updated_at: iso(now - 27 * 60 * MIN) }),
    summary({ chat_id: "20261020-tst1", title: "Первый тестовый чат", number: 4, state: "closed", updated_at: iso(now - 3 * 24 * 60 * MIN) }),
  ];

  // Лента RoboChain — все виды элементов: created, message (файл, комментарий,
  // ответ), push, review, agent_pr открытый с «не влито» и влитый.
  const t0 = now - 20 * 60 * MIN;
  const sasha1 = msgId(t0 + MIN, "alex011082", "q9w1");
  const claude1 = msgId(now - 52 * MIN, "claude", "x7k2");
  const codex1 = `c${2_000_001}`;
  const codexOld = msgId(now - 31 * MIN, "codex", "m3p8");
  const pendingId = msgId(now - 5 * MIN, "claude", "hy01");
  const robo: TimelineItem[] = [
    { kind: "created", id: sha(), actor: "alex011082", created_at: iso(t0), url: `${GH}/commit/1` },
    {
      kind: "message", id: sasha1, author: "alex011082", display: "alex011082", source: "file",
      text: "Обсуждаем передачу коробок между гусеничными платформами. Нужны варианты захвата. Claude и Codex — по одному варианту от каждого, с оценкой пропускной способности.",
      created_at: iso(t0 + MIN), actor: "alex011082", commit_sha: "4e1c07b" + sha().slice(7), url: `${GH}/commit/4e1c07b`, pending: false,
    },
    {
      kind: "message", id: claude1, author: "claude", display: "Claude", source: "file", reply_to: sasha1,
      text: "Предлагаю **вакуумные руки**: четыре присоски на коробку, захват сверху, без выравнивания по краю. По прикидке — 9 коробок в минуту.\n\nРиск: пыльный гофрокартон держится хуже, нужен датчик давления на каждой присоске.",
      created_at: iso(now - 52 * MIN), actor: "alex011082", commit_sha: "a3f8c91" + sha().slice(7), url: `${GH}/commit/a3f8c91`, pending: false,
    },
    {
      kind: "push", id: sha(), actor: "chatgpt-codex-connector[bot]", author: "codex", display: "Codex",
      title: "calc: оценка пропускной способности", files: 1, created_at: iso(now - 45 * MIN), url: `${GH}/commit/2`,
    },
    {
      kind: "message", id: codex1, author: "codex", display: "Codex", source: "comment",
      text: "Альтернатива — выдвижной мост между платформами: коробка едет по роликам, руки не нужны. Расчёт лежит в `calc.md`: около 14 коробок в минуту против 9 у вакуума.\n\n| вариант | коробок/мин |\n|---|---|\n| вакуум | 9 |\n| мост | 14 |\n\nСлабое место — стыковка платформ на неровном полу.",
      created_at: iso(now - 44 * MIN), actor: "chatgpt-codex-connector[bot]", url: `${GH}/pull/3#issuecomment-2000001`, pending: false,
    },
    {
      kind: "review", id: "rc501", author: "claude", display: "Claude", actor: "claude[bot]",
      text: "Скорость ленты взята из старой спеки. Для текущих роликов — 0,45 м/с, тогда выходит около 11 коробок в минуту.",
      path: "chats/20261023-k7q2/calc.md", line: 12,
      diff_hunk: "@@ -8,5 +8,6 @@\n шаг_роликов = 0.12 м\n+длина_коробки = 0.4 м\n+скорость_ленты = 0.6 м/с",
      created_at: iso(now - 38 * MIN), url: `${GH}/pull/3#discussion_r501`,
    },
    {
      kind: "agent_pr", id: "pr4", number: 4, title: "codex: поправка скорости", actor: "chatgpt-codex-connector[bot]",
      author: "codex", display: "Codex", state: "merged", created_at: iso(now - 32 * MIN), url: `${GH}/pull/4`, message_ids: [codexOld],
    },
    {
      kind: "message", id: codexOld, author: "codex", display: "Codex", source: "file", reply_to: claude1,
      text: "Согласен с поправкой: с 0,45 м/с мост даёт 11 коробок в минуту. Обновил `calc.md`.",
      created_at: iso(now - 31 * MIN), actor: "alex011082", commit_sha: sha(), url: `${GH}/commit/3`, pending: false,
    },
    {
      kind: "agent_pr", id: "pr5", number: 5, title: "claude: сравнение вариантов", actor: "claude[bot]",
      author: "claude", display: "Claude", state: "open", created_at: iso(now - 6 * MIN), url: `${GH}/pull/5`, message_ids: [pendingId],
    },
    {
      kind: "message", id: pendingId, author: "claude", display: "Claude", source: "agent_pr", reply_to: codexOld,
      text: "Сравнил оба варианта с поправкой на 0,45 м/с: мост выигрывает 11 к 9, но дороже в сборке. Предлагаю гибрид — мост плюс одна вакуумная рука для перекоса.",
      created_at: iso(now - 5 * MIN), actor: "claude[bot]", url: `${GH}/pull/5`, pending: true, agent_pr: 5,
    },
  ];

  const detail = (c: ChatSummary, participants: ChatDetail["participants"]): ChatDetail => ({
    ...c,
    head_sha: sha(),
    meta: { schema_version: 1, chat_id: c.chat_id, title: c.title, created_at: c.created_at, created_by: c.created_by, parent: null },
    participants,
    can_push: !readonly,
  });

  const timelines = new Map<string, TimelineResponse>();
  timelines.set(chats[0]!.chat_id, {
    chat: detail(chats[0]!, [
      { author: "alex011082", display: "alex011082", is_agent: false, last_at: iso(t0 + MIN), count: 1 },
      { author: "claude", display: "Claude", is_agent: true, last_at: iso(now - 5 * MIN), count: 2 },
      { author: "codex", display: "Codex", is_agent: true, last_at: iso(now - 31 * MIN), count: 2 },
    ]),
    items: robo,
  });
  for (const c of chats.slice(1)) {
    const first: MessageItem = {
      kind: "message", id: msgId(Date.parse(c.created_at) + MIN, "alex011082"), author: "alex011082", display: "alex011082",
      source: "file", text: `Начинаем: ${c.title}.`, created_at: iso(Date.parse(c.created_at) + MIN), actor: "alex011082",
      commit_sha: sha(), url: `${GH}/commit/x`, pending: false,
    };
    timelines.set(c.chat_id, {
      chat: detail(c, [{ author: "alex011082", display: "alex011082", is_agent: false, last_at: first.created_at, count: 1 }]),
      items: [{ kind: "created", id: sha(), actor: "alex011082", created_at: c.created_at, url: `${GH}/commit/0` }, first],
    });
  }
  return { repos, chats, timelines };
}

export function createMockApi(mode: string): Api {
  const db = fixtures(mode);
  const notFound = () => new ApiFailure(404, "not_found", "Чат не найден");
  const find = (chatId: string) => {
    const t = db.timelines.get(chatId);
    if (!t) throw notFound();
    return t;
  };
  const touch = (chatId: string) => {
    const c = db.chats.find((x) => x.chat_id === chatId);
    if (c) c.updated_at = new Date().toISOString();
  };

  return {
    async me() {
      await wait(150);
      if (mode === "login") throw new ApiFailure(401, "unauthorized", "Нужно войти через GitHub");
      if (mode === "forbidden") throw new ApiFailure(403, "forbidden", "Вход закрыт");
      return { login: "alex011082", id: 1, name: "Саша", avatar_url: "" };
    },
    async config() {
      return { app_slug: "chat0110", install_url: "https://github.com/apps/chat0110/installations/new" };
    },
    async repos() {
      await wait(200);
      return mode === "norepos" ? [] : structuredClone(db.repos);
    },
    async chats(repo) {
      await wait(250);
      if (mode === "nochats" || repo.toLowerCase() !== REPO.toLowerCase()) return [];
      return structuredClone(db.chats);
    },
    async timeline(_repo, chatId) {
      await wait(300);
      return structuredClone(find(chatId));
    },
    async createChat(req) {
      await wait(900);
      if (/ошибка/i.test(req.title)) throw new ApiFailure(502, "github_error", "GitHub не дал создать ветку — попробуй ещё раз");
      const now = Date.now();
      const chatId = `${stampOf(new Date(now)).slice(0, 8)}-${rand4()}`;
      const number = 10 + db.chats.length;
      const chat: ChatSummary = {
        repo: req.repo, chat_id: chatId, title: req.title, number, state: "open", draft: true, branch: `chat/${chatId}`,
        url: `${GH}/pull/${number}`, created_at: iso(now), updated_at: iso(now), created_by: "alex011082",
      };
      db.chats.push(chat);
      const items: TimelineItem[] = [{ kind: "created", id: sha(), actor: "alex011082", created_at: iso(now), url: `${GH}/commit/n` }];
      if (req.first_message) {
        items.push({
          kind: "message", id: msgId(now, "alex011082"), author: "alex011082", display: "alex011082", source: "file",
          text: req.first_message, created_at: iso(now + 1000), actor: "alex011082", commit_sha: sha(), url: `${GH}/commit/n`, pending: false,
        });
      }
      db.timelines.set(chatId, {
        chat: { ...chat, head_sha: sha(), meta: null, can_push: true, participants: req.first_message
          ? [{ author: "alex011082", display: "alex011082", is_agent: false, last_at: iso(now), count: 1 }] : [] },
        items,
      });
      return { chat: structuredClone(chat) };
    },
    async postMessage(_repo, chatId, req) {
      await wait(1400);
      // Слово «ошибка» в тексте — проверить показ «GitHub просит подождать».
      if (/ошибка/i.test(req.text)) throw new ApiFailure(429, "rate_limited", "Лимит GitHub", 30);
      const t = find(chatId);
      const now = Date.now();
      const item: MessageItem = {
        kind: "message", id: msgId(now, "alex011082"), author: "alex011082", display: "alex011082", source: "file",
        text: req.text, created_at: iso(now), actor: "alex011082", commit_sha: sha(), url: `${GH}/commit/m`, pending: false,
        ...(req.reply_to ? { reply_to: req.reply_to } : {}),
      };
      t.items.push(item);
      const me = t.chat.participants.find((p) => p.author === "alex011082");
      if (me) {
        me.last_at = item.created_at;
        me.count++;
      }
      touch(chatId);
      return { item: structuredClone(item) };
    },
    async acceptAgentPr(_repo, chatId, n) {
      await wait(900);
      const t = find(chatId);
      const pr = t.items.find((i) => i.kind === "agent_pr" && i.number === n);
      if (!pr || pr.kind !== "agent_pr" || pr.state !== "open") throw new ApiFailure(409, "conflict", "PR изменился, обнови");
      pr.state = "merged";
      const mergeSha = sha();
      for (const i of t.items) {
        if (i.kind === "message" && i.agent_pr === n) {
          i.pending = false;
          i.source = "file";
          i.commit_sha = mergeSha;
          i.actor = "alex011082";
          delete i.agent_pr;
        }
      }
      touch(chatId);
      return { ok: true, merge_sha: mergeSha };
    },
    async logout() {
      await wait(100);
    },
    subscribe(_repo, h) {
      h.onState?.(true);
      if (mode !== "live") return () => {};
      const timer = setTimeout(() => {
        const t = db.timelines.get("20261023-k7q2");
        if (!t) return;
        const now = Date.now();
        t.items.push({
          kind: "message", id: msgId(now, "codex"), author: "codex", display: "Codex", source: "file",
          text: "Добавил оценку цены узла: мост ≈ 1,8× вакуумной руки, зато ремонт — замена ролика за 5 минут.",
          created_at: iso(now), actor: "chatgpt-codex-connector[bot]", commit_sha: sha(), url: `${GH}/commit/l`, pending: false,
        });
        touch("20261023-k7q2");
        h.onChat({ repo: REPO, chat_id: "20261023-k7q2", number: 3 });
      }, 12_000);
      return () => clearTimeout(timer);
    },
  };
}
