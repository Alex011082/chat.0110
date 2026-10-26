import {
  displayName,
  foldDecisions,
  isAgent,
  stampOf,
  type ChatDetail,
  type ChatSummary,
  type Decision,
  type DecisionAction,
  type DecisionEvent,
  type DecisionEventItem,
  type ForkPoint,
  type ForkRef,
  type GraphChat,
  type GraphDecision,
  type MessageItem,
  type Participant,
  type RepoInfo,
  type TimelineItem,
  type TimelineResponse,
} from "@chat0110/chat-protocol";
import { ApiFailure, type Api } from "./api.ts";
import { decisionActions } from "./lib/decision.ts";

// Пробный режим для разработки и проверки вида (?mock=1). Только выдуманные
// данные по контракту api.ts; сети нет. В сборку для сервера не попадает:
// api.ts подключает модуль лишь при import.meta.env.DEV.
//
// Режимы: 1 — всё; login — не вошёл; forbidden — вход закрыт; norepos — App
// нигде не установлено; nochats — пустое репо; readonly — без права записи;
// live — через 12 с «приходит» сообщение Codex.
//
// Дерево: RoboChain (корень) → «Выдвижной мост» (Fork из середины) →
// «Датчики давления» (Fork из Fork); «Захват сбоку» — закрытый Fork;
// YTNG и QA Board — независимые корни; «Первый тестовый чат» закрыт.
//
// Решения (Этап 5) хранятся событиями, как в ветке, и сворачиваются тем же
// foldDecisions, что у сервера: в RoboChain принято «Вакуумные руки», из Fork
// «Выдвижной мост» пришло предложение заменить его (ждёт человека; Claude
// «предложил принять» — статус не меняется); в Fork своё принятое решение.

const OWNER = "Alex011082";
const REPO = `${OWNER}/chat.0110`;
const GH = `https://github.com/${REPO}`;
const MIN = 60_000;
const HOUR = 60 * MIN;
const ME = "alex011082";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (t: number) => new Date(t).toISOString();
const rand4 = () => Math.random().toString(36).slice(2, 6).padEnd(4, "0");
const sha = () => Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const msgId = (t: number, author: string, r = rand4()) => `${stampOf(new Date(t))}-${author}-${r}`;

/** Сообщение-файл в ветке чата. Агенты пушат от аккаунта владельца. */
function file(t: number, author: string, text: string, r?: string, extra: Partial<MessageItem> = {}): MessageItem {
  const commit = sha();
  return {
    kind: "message",
    id: msgId(t, author, r),
    author,
    display: displayName(author),
    source: "file",
    text,
    created_at: iso(t),
    actor: ME,
    commit_sha: commit,
    url: `${GH}/commit/${commit.slice(0, 7)}`,
    pending: false,
    ...extra,
  };
}

const created = (t: number): TimelineItem => ({ kind: "created", id: sha(), actor: ME, created_at: iso(t), url: `${GH}/commit/0` });

/** Событие-файл «propose» — само решение. */
function propose(
  t: number,
  author: string,
  title: string,
  text: string,
  sources: string[],
  extra: Pick<DecisionEvent, "from_chat" | "supersedes"> = {},
): DecisionEvent {
  const id = msgId(t, author);
  return { id, decision: id, action: "propose", author, created_at: iso(t), title, source_messages: sources, text, ...extra };
}

/** Событие над решением: accept, reject, reopen, discuss. */
function act(t: number, author: string, action: Exclude<DecisionAction, "propose">, decision: string, text = ""): DecisionEvent {
  return { id: msgId(t, author), decision, action, author, created_at: iso(t), source_messages: [], text };
}

interface Db {
  repos: RepoInfo[];
  chats: ChatSummary[];
  items: Map<string, TimelineItem[]>;
  reasons: Map<string, string>;
  /** События решений по чатам — как файлы chats/<id>/decisions/. */
  decisions: Map<string, DecisionEvent[]>;
  readonly: boolean;
}

function fixtures(mode: string): Db {
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
    created_at: iso(now - 26 * HOUR),
    updated_at: iso(now - HOUR),
    created_by: ME,
    parent: null,
    ...o,
  });
  const point = (chatId: string, messageId: string): ForkPoint => ({ chat_id: chatId, message_id: messageId, commit_sha: sha() });
  const items = new Map<string, TimelineItem[]>();
  const reasons = new Map<string, string>();

  // --- RoboChain — все виды элементов ленты.
  const ROBO = "20261023-k7q2";
  const t0 = now - 20 * HOUR;
  const sasha0 = file(t0 + MIN, ME, "Начинаем RoboChain: две гусеничные платформы возят коробки по складу. Сначала база, потом передача между ними.", "q9w0");
  const claudeA = file(
    t0 + 25 * MIN,
    "claude",
    "**Гусеничная база**: общая рама на две платформы не нужна — каждая едет сама, синхронизация по UWB-меткам. Так проще чинить: платформа меняется целиком.",
    "g5b1",
    { reply_to: sasha0.id },
  );
  const codexA = file(
    t0 + 48 * MIN,
    "codex",
    "Нагрузка на гусеницу при 40 кг коробок — 0,6 от допустимой. Запас есть, мотор берём из текущей спеки.",
    "n2l4",
    { reply_to: claudeA.id, actor: "chatgpt-codex-connector[bot]" },
  );
  const sasha1 = file(
    t0 + 3 * HOUR,
    ME,
    "Обсуждаем передачу коробок между гусеничными платформами. Нужны варианты захвата. Claude и Codex — по одному варианту от каждого, с оценкой пропускной способности.",
    "q9w1",
  );
  const claude1 = file(
    now - 52 * MIN,
    "claude",
    "Предлагаю **вакуумные руки**: четыре присоски на коробку, захват сверху, без выравнивания по краю. По прикидке — 9 коробок в минуту.\n\nРиск: пыльный гофрокартон держится хуже, нужен датчик давления на каждой присоске.",
    "x7k2",
    { reply_to: sasha1.id },
  );
  const bridge = file(
    now - 44 * MIN,
    "codex",
    "Альтернатива — **выдвижной мост** между платформами: коробка едет по роликам, руки не нужны. Расчёт лежит в `calc.md`: около 14 коробок в минуту против 9 у вакуума.\n\n| вариант | коробок/мин |\n|---|---|\n| вакуум | 9 |\n| мост | 14 |\n\nСлабое место — стыковка платформ на неровном полу.",
    "b7r1",
    { reply_to: sasha1.id },
  );
  const sashaComment: MessageItem = {
    kind: "message", id: "c2000001", author: ME, display: ME, source: "comment",
    text: "Сильный расчёт. Мост разберу отдельно в Fork, здесь сравниваем дальше.",
    created_at: iso(now - 42 * MIN), actor: ME, url: `${GH}/pull/3#issuecomment-2000001`, pending: false,
  };
  const codexOld = file(now - 31 * MIN, "codex", "Согласен с поправкой: с 0,45 м/с мост даёт 11 коробок в минуту. Обновил `calc.md`.", "m3p8", {
    reply_to: claude1.id,
  });
  const pendingId = msgId(now - 5 * MIN, "claude", "hy01");
  items.set(ROBO, [
    created(t0),
    sasha0,
    claudeA,
    codexA,
    sasha1,
    claude1,
    {
      kind: "push", id: sha(), actor: "chatgpt-codex-connector[bot]", author: "codex", display: "Codex",
      title: "calc: оценка пропускной способности", files: 1, created_at: iso(now - 45 * MIN), url: `${GH}/commit/2`,
    },
    bridge,
    sashaComment,
    {
      kind: "review", id: "rc501", author: "claude", display: "Claude", actor: "claude[bot]",
      text: "Скорость ленты взята из старой спеки. Для текущих роликов — 0,45 м/с, тогда выходит около 11 коробок в минуту.",
      path: `chats/${ROBO}/calc.md`, line: 12,
      diff_hunk: "@@ -8,5 +8,6 @@\n шаг_роликов = 0.12 м\n+длина_коробки = 0.4 м\n+скорость_ленты = 0.6 м/с",
      created_at: iso(now - 38 * MIN), url: `${GH}/pull/3#discussion_r501`,
    },
    {
      kind: "agent_pr", id: "pr5", number: 5, title: "codex: поправка скорости", actor: "chatgpt-codex-connector[bot]",
      author: "codex", display: "Codex", state: "merged", created_at: iso(now - 32 * MIN), url: `${GH}/pull/5`, message_ids: [codexOld.id],
    },
    codexOld,
    {
      kind: "agent_pr", id: "pr9", number: 9, title: "claude: сравнение вариантов", actor: "claude[bot]",
      author: "claude", display: "Claude", state: "open", created_at: iso(now - 6 * MIN), url: `${GH}/pull/9`, message_ids: [pendingId],
    },
    {
      kind: "message", id: pendingId, author: "claude", display: "Claude", source: "agent_pr", reply_to: codexOld.id,
      text: "Сравнил оба варианта с поправкой на 0,45 м/с: мост выигрывает 11 к 9, но дороже в сборке. Предлагаю гибрид — мост плюс одна вакуумная рука для перекоса.",
      created_at: iso(now - 5 * MIN), actor: "claude[bot]", url: `${GH}/pull/9`, pending: true, agent_pr: 9,
    },
  ]);

  // --- «Захват сбоку» — закрытый Fork из ранней части RoboChain.
  const SIDE = "20261022-s1de";
  const ts = t0 + 3 * HOUR + 10 * MIN;
  const sideGap = file(ts + 30 * MIN, "claude", "Между платформами при стыковке остаётся 30 см — боковой захват туда не влезает без раздвижной рамы.", "s1b2");
  items.set(SIDE, [
    created(ts),
    file(ts + MIN, ME, "Отдельно проверим захват сбоку: платформы встают бок о бок, рука толкает коробку поперёк.", "s1a1"),
    sideGap,
    file(ts + 95 * MIN, ME, "Закрываю: сбоку не проходит по габаритам. Возвращаемся к вакууму и мосту.", "s1c3"),
  ]);
  const sideFrame = propose(ts + 40 * MIN, "claude", "Раздвижная рама для бокового захвата", "Рама раздвигается на 30 см перед стыковкой — тогда рука сбоку проходит.", [sideGap.id]);
  reasons.set(SIDE, "Проверить захват сбоку, не засоряя основной разговор");

  // --- «Выдвижной мост» — Fork от предложения Codex.
  const BRIDGE = "20261023-m2p9";
  const tb = now - 41 * MIN;
  const sensorsPoint = file(
    now - 22 * MIN,
    "claude",
    "На неровном полу мост перекашивает. Нужны **датчики давления** в опорах — тогда платформа сама подстроит высоту перед стыковкой.",
    "d9s2",
  );
  const docking = file(now - 30 * MIN, "codex", "Стыковка: два конусных штыря и электромагнит. Допуск по высоте — ±8 мм, дальше ролики бьют коробку.", "m2b2", {
    actor: "chatgpt-codex-connector[bot]",
  });
  const rollers = file(now - 9 * MIN, "codex", "Ролики с шагом 0,12 м и лентой 0,45 м/с: мост держит 11 коробок в минуту, узкое место — разгон на стыке.", "m5e5");
  items.set(BRIDGE, [
    created(tb),
    file(tb + MIN, ME, "Разбираем мост отдельно: стыковка, ролики, цена.", "m1a1"),
    docking,
    sensorsPoint,
    file(now - 18 * MIN, ME, "Хорошо, датчики — в отдельный Fork. Здесь считаем ролики.", "m4d4"),
    rollers,
  ]);
  reasons.set(BRIDGE, "Разобрать выдвижной мост, пока основной чат сравнивает варианты");

  // --- «Датчики давления» — Fork из Fork.
  const SENSORS = "20261023-d4tc";
  const td = now - 20 * MIN;
  items.set(SENSORS, [
    created(td),
    file(td + MIN, ME, "Какие датчики ставим в опоры моста и куда ведём сигнал?", "d1a1"),
    file(now - 3 * MIN, "claude", "Тензодатчики по одному на опору, сигнал — в контроллер платформы. Порог перекоса 5 мм — платформа подстраивает высоту до стыковки.", "d2b2"),
  ]);

  // --- Независимые корни.
  const YTNG = "20261022-y2tn";
  const ty = now - 30 * HOUR;
  items.set(YTNG, [
    created(ty),
    file(ty + MIN, ME, "YTNG: нужен второй переводчик-рецензент. Как сравнивать два перевода без эталона?", "y1a1"),
    file(ty + 40 * MIN, "claude", "Сравнивать смысл, а не слова: каждый перевод пересказать на исходный язык и сверить пересказы.", "y2b2"),
    file(now - 70 * MIN, "codex", "Сделал прототип обратного перевода, расхождения подсвечиваются по абзацам.", "y3c3"),
    file(now - 64 * MIN, ME, "Отлично, пробуем на трёх страницах сайта.", "y4d4"),
  ]);

  const QA = "20261021-qa01";
  const tq = now - 28 * HOUR;
  items.set(QA, [
    created(tq),
    file(tq + MIN, ME, "Нестабильные тесты на CI: какие падают чаще всего?", "q1a1"),
    file(now - 27 * HOUR, "codex", "Три теста с таймерами: подменяю часы фейковыми, падения уходят.", "q2b2"),
  ]);

  const TEST = "20261020-tst1";
  const tt = now - 3 * 24 * HOUR;
  items.set(TEST, [created(tt), file(tt + MIN, ME, "Начинаем: Первый тестовый чат.", "t1a1")]);

  // --- Решения.
  const vacuum = propose(
    now - 50 * MIN,
    ME,
    "Вакуумные руки",
    "Четыре присоски сверху, без выравнивания по краю. **9 коробок в минуту** — хватает на старт; датчик давления на каждой присоске закрывает риск с пыльным картоном.",
    [claude1.id, sasha1.id],
  );
  const dock = propose(
    now - 29 * MIN,
    "codex",
    "Стыковка: конусные штыри и электромагнит",
    "Два штыря задают положение, магнит держит. Допуск по высоте ±8 мм — с ним ролики не бьют коробку.",
    [docking.id],
  );
  const toBridge = propose(
    now - 7 * MIN,
    ME,
    "Перейти на выдвижной мост",
    "В Fork «Выдвижной мост» разобрали стыковку и ролики отдельно от основного разговора.\n\n- Мост держит **11 коробок в минуту** против 9 у вакуумных рук.\n- Стыковка — конусные штыри и электромагнит, допуск ±8 мм.\n- Ремонт — замена ролика за 5 минут.\n\nПредлагается пересмотреть решение «Вакуумные руки».",
    [docking.id, rollers.id],
    { from_chat: BRIDGE },
  );
  toBridge.supersedes = vacuum.id;
  const decisions = new Map<string, DecisionEvent[]>([
    [ROBO, [vacuum, act(now - 50 * MIN + 1000, ME, "accept", vacuum.id), toBridge, act(now - 4 * MIN, "claude", "accept", toBridge.id, "Расчёт сходится — я бы принял.")]],
    [BRIDGE, [dock, act(now - 27 * MIN, ME, "accept", dock.id)]],
    [SIDE, [sideFrame, act(ts + 95 * MIN, ME, "reject", sideFrame.id, "Рама съедает выигрыш по времени.")]],
  ]);

  const chats: ChatSummary[] = [
    summary({ chat_id: ROBO, title: "RoboChain — захват коробок", number: 3, created_at: iso(t0), updated_at: iso(now - 5 * MIN) }),
    summary({ chat_id: YTNG, title: "YTNG — второе мнение", number: 2, created_at: iso(ty), updated_at: iso(now - 64 * MIN) }),
    summary({ chat_id: QA, title: "QA Board — нестабильные тесты", number: 1, created_at: iso(tq), updated_at: iso(now - 27 * HOUR) }),
    summary({ chat_id: TEST, title: "Первый тестовый чат", number: 4, state: "closed", created_at: iso(tt), updated_at: iso(now - 3 * 24 * HOUR) }),
    summary({
      chat_id: SIDE, title: "Захват сбоку", number: 6, state: "closed", created_at: iso(ts), updated_at: iso(ts + 95 * MIN),
      parent: point(ROBO, sasha1.id),
    }),
    summary({
      chat_id: BRIDGE, title: "Выдвижной мост", number: 7, created_at: iso(tb), updated_at: iso(now - 9 * MIN),
      parent: point(ROBO, bridge.id),
    }),
    summary({
      chat_id: SENSORS, title: "Датчики давления", number: 8, created_at: iso(td), updated_at: iso(now - 3 * MIN),
      parent: point(BRIDGE, sensorsPoint.id),
    }),
  ];
  return { repos, chats, items, reasons, decisions, readonly };
}

/** Карточки и строки решений — как buildTimeline на сервере. */
function decisionItems(folded: readonly Decision[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const d of folded) {
    const commit = sha();
    out.push({
      kind: "decision", id: d.id, author: d.created_by, display: displayName(d.created_by), decision: d, created_at: d.created_at,
      actor: ME, commit_sha: commit, url: `${GH}/commit/${commit.slice(0, 7)}`,
    });
    for (const h of d.history.slice(1)) {
      const ev: DecisionEventItem = {
        kind: "decision_event", id: h.id, decision_id: d.id, action: h.action, title: d.title,
        author: h.author, display: displayName(h.author), text: h.text, created_at: h.created_at,
      };
      if (h.ignored) ev.ignored = true;
      out.push(ev);
    }
  }
  return out;
}

/** Порядок ленты, как у сервера: «создал чат» первым, дальше по времени и id. */
function sortTimeline(items: TimelineItem[]): TimelineItem[] {
  const rank = (i: TimelineItem) => (i.kind === "created" ? 0 : 1);
  return items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function graphDecision(d: Decision): GraphDecision {
  const g: GraphDecision = { id: d.id, title: d.title, status: d.status, created_at: d.created_at };
  if (d.decided_at) g.decided_at = d.decided_at;
  if (d.from_chat) g.from_chat = d.from_chat;
  if (d.supersedes) g.supersedes = d.supersedes;
  return g;
}

function participants(items: readonly TimelineItem[]): Participant[] {
  const by = new Map<string, Participant>();
  for (const i of items) {
    if (i.kind !== "message" || i.pending) continue;
    const p = by.get(i.author) ?? { author: i.author, display: i.display, is_agent: isAgent(i.author), last_at: i.created_at, count: 0 };
    p.count++;
    if (i.created_at > p.last_at) p.last_at = i.created_at;
    by.set(i.author, p);
  }
  return [...by.values()];
}

const ownFiles = (items: readonly TimelineItem[]) =>
  items.filter((i): i is MessageItem => i.kind === "message" && i.source === "file" && !i.pending);

export function createMockApi(mode: string): Api {
  const db = fixtures(mode);
  const notFound = () => new ApiFailure(404, "not_found", "Чат не найден");
  const chatOf = (chatId: string) => {
    const c = db.chats.find((x) => x.chat_id === chatId);
    if (!c) throw notFound();
    return c;
  };
  const itemsOf = (chatId: string) => {
    const t = db.items.get(chatId);
    if (!t) throw notFound();
    return t;
  };
  const touch = (chatId: string) => {
    const c = db.chats.find((x) => x.chat_id === chatId);
    if (c) c.updated_at = new Date().toISOString();
  };
  const eventsOf = (chatId: string) => {
    let list = db.decisions.get(chatId);
    if (!list) db.decisions.set(chatId, (list = []));
    return list;
  };
  const folded = (chatId: string) => foldDecisions(db.decisions.get(chatId) ?? []);
  const decisionOf = (chatId: string, id: string) => {
    const d = folded(chatId).find((x) => x.id === id);
    if (!d) throw new ApiFailure(404, "not_found", "Решение не найдено");
    return d;
  };
  const writable = () => {
    if (db.readonly) throw new ApiFailure(403, "forbidden", "Нет права записи в репозиторий");
  };
  // Заменить можно только принятое решение того же чата — как проверяет сервер.
  const checkSupersedes = (chatId: string, id: string | undefined) => {
    if (id && !folded(chatId).some((d) => d.id === id && d.status === "accepted")) {
      throw new ApiFailure(409, "conflict", "Заменяемое решение не найдено или не принято");
    }
  };

  const timeline = (chatId: string): TimelineResponse => {
    const c = chatOf(chatId);
    const decisions = folded(chatId);
    const items = sortTimeline([...itemsOf(chatId), ...decisionItems(decisions)]);
    const reason = db.reasons.get(chatId);
    const chat: ChatDetail = {
      ...c,
      head_sha: sha(),
      meta: {
        schema_version: 1, chat_id: c.chat_id, title: c.title, created_at: c.created_at, created_by: c.created_by,
        parent: c.parent ? { ...c.parent, ...(reason ? { reason } : {}) } : null,
      },
      participants: participants(items),
      can_push: !db.readonly,
    };
    const forks: ForkRef[] = db.chats
      .filter((x) => x.parent?.chat_id === chatId)
      .map((x) => ({
        chat_id: x.chat_id, title: x.title, number: x.number, url: x.url, state: x.state,
        message_id: x.parent!.message_id, commit_sha: x.parent!.commit_sha, created_at: x.created_at, created_by: x.created_by,
      }));
    let inherited: TimelineResponse["inherited"] = null;
    if (c.parent) {
      const p = db.chats.find((x) => x.chat_id === c.parent!.chat_id);
      const pItems = db.items.get(c.parent.chat_id) ?? [];
      const msgs = pItems.filter((i): i is MessageItem => i.kind === "message" && !i.pending);
      const upTo = msgs.findIndex((m) => m.id === c.parent!.message_id);
      inherited = {
        chat_id: c.parent.chat_id,
        title: p?.title ?? c.parent.chat_id,
        number: p?.number ?? null,
        message_id: c.parent.message_id,
        commit_sha: c.parent.commit_sha,
        items: upTo >= 0 ? msgs.slice(0, upTo + 1) : [],
      };
    }
    // Предложения этого Fork в родителе — со статусами, которые там им дали.
    const outgoing = c.parent ? folded(c.parent.chat_id).filter((d) => d.from_chat === chatId) : [];
    return structuredClone({ chat, items, forks, inherited, decisions, outgoing });
  };

  return {
    async me() {
      await wait(150);
      if (mode === "login") throw new ApiFailure(401, "unauthorized", "Нужно войти через GitHub");
      if (mode === "forbidden") throw new ApiFailure(403, "forbidden", "Вход закрыт");
      return { login: ME, id: 1, name: "Саша", avatar_url: "" };
    },
    async config() {
      return { app_slug: "chat0110", install_url: "https://github.com/apps/chat0110/installations/new" };
    },
    async repos() {
      await wait(200);
      return mode === "norepos" ? [] : structuredClone(db.repos);
    },
    async activation(repo) {
      const legacy = repo.toLowerCase() === REPO.toLowerCase();
      return {
        repo,
        activated: legacy,
        agents_doc: legacy,
        legacy_chats: legacy,
        protocol_invalid: false,
        can_push: !db.readonly,
        default_branch: "main",
        gaps: legacy ? [] : ["Chat/protocol.json", "Chat/AGENTS.md", "Chat/CLAUDE.md", "Chat/index/.gitkeep", "Chat/conversations/.gitkeep", "Chat/forks/.gitkeep", "Chat/references/.gitkeep"],
      };
    },
    async activate(repo) {
      await wait(400);
      return { ...(await this.activation(repo)), activated: true, agents_doc: true, gaps: [], created: [] };
    },
    async chats(repo) {
      await wait(250);
      if (mode === "nochats" || repo.toLowerCase() !== REPO.toLowerCase()) return [];
      return structuredClone(db.chats);
    },
    async timeline(_repo, chatId) {
      await wait(300);
      return timeline(chatId);
    },
    async graph(repo) {
      await wait(350);
      if (mode === "nochats" || repo.toLowerCase() !== REPO.toLowerCase()) return { repo, chats: [] };
      const chats: GraphChat[] = db.chats.map((c) => ({
        ...c,
        messages: ownFiles(db.items.get(c.chat_id) ?? []).map((m) => ({ id: m.id, author: m.author, created_at: m.created_at })),
        decisions: folded(c.chat_id).map(graphDecision),
      }));
      return structuredClone({ repo: REPO, chats });
    },
    async createChat(req) {
      await wait(900);
      if (/ошибка/i.test(req.title)) throw new ApiFailure(502, "github_error", "GitHub не дал создать ветку — попробуй ещё раз");
      const now = Date.now();
      const chatId = `${stampOf(new Date(now)).slice(0, 8)}-${rand4()}`;
      const number = 10 + db.chats.length;
      const chat: ChatSummary = {
        repo: req.repo, chat_id: chatId, title: req.title, number, state: "open", draft: true, branch: `chat/${chatId}`,
        url: `${GH}/pull/${number}`, created_at: iso(now), updated_at: iso(now), created_by: ME, parent: null,
      };
      db.chats.push(chat);
      const items: TimelineItem[] = [created(now)];
      if (req.first_message) items.push(file(now + 1000, ME, req.first_message));
      db.items.set(chatId, items);
      return { chat: structuredClone(chat) };
    },
    async fork(_repo, chatId, req) {
      await wait(1100);
      if (db.readonly) throw new ApiFailure(403, "forbidden", "Нет права записи в репозиторий");
      if (/ошибка/i.test(req.title)) throw new ApiFailure(502, "github_error", "GitHub не дал создать ветку от точки Fork — попробуй ещё раз");
      const parent = chatOf(chatId);
      // Как у сервера: Fork только от своего влитого сообщения чата.
      const point = itemsOf(chatId).find((i) => i.kind === "message" && i.id === req.message_id && !i.pending);
      if (!point) throw new ApiFailure(404, "not_found", "Сообщение для Fork не найдено");
      const now = Date.now();
      const childId = `${stampOf(new Date(now)).slice(0, 8)}-${rand4()}`;
      const number = 10 + db.chats.length;
      const chat: ChatSummary = {
        repo: parent.repo, chat_id: childId, title: req.title, number, state: "open", draft: true, branch: `chat/${childId}`,
        url: `${GH}/pull/${number}`, created_at: iso(now), updated_at: iso(now), created_by: ME,
        parent: { chat_id: chatId, message_id: req.message_id, commit_sha: sha() },
      };
      db.chats.push(chat);
      const items: TimelineItem[] = [created(now)];
      if (req.first_message) items.push(file(now + 1000, ME, req.first_message));
      db.items.set(childId, items);
      if (req.reason) db.reasons.set(childId, req.reason);
      touch(chatId);
      return { chat: structuredClone(chat) };
    },
    async postMessage(_repo, chatId, req) {
      await wait(1400);
      // Слово «ошибка» в тексте — проверить показ «GitHub просит подождать».
      if (/ошибка/i.test(req.text)) throw new ApiFailure(429, "rate_limited", "Лимит GitHub", 30);
      const items = itemsOf(chatId);
      const item = file(Date.now(), ME, req.text, undefined, req.reply_to ? { reply_to: req.reply_to } : {});
      items.push(item);
      touch(chatId);
      return { item: structuredClone(item) };
    },
    async acceptAgentPr(_repo, chatId, n) {
      await wait(900);
      const items = itemsOf(chatId);
      const pr = items.find((i) => i.kind === "agent_pr" && i.number === n);
      if (!pr || pr.kind !== "agent_pr" || pr.state !== "open") throw new ApiFailure(409, "conflict", "PR изменился, обнови");
      pr.state = "merged";
      const mergeSha = sha();
      for (const i of items) {
        if (i.kind === "message" && i.agent_pr === n) {
          i.pending = false;
          i.source = "file";
          i.commit_sha = mergeSha;
          i.actor = ME;
          delete i.agent_pr;
        }
      }
      touch(chatId);
      return { ok: true, merge_sha: mergeSha };
    },
    async createDecision(_repo, chatId, req) {
      await wait(800);
      writable();
      chatOf(chatId);
      // Слово «ошибка» в названии — проверить показ ошибки в форме.
      if (/ошибка/i.test(req.title)) throw new ApiFailure(502, "github_error", "GitHub не принял коммит решения — попробуй ещё раз");
      checkSupersedes(chatId, req.supersedes);
      const t = Date.now();
      const p = propose(t, ME, req.title, req.text ?? "", req.source_messages, req.supersedes ? { supersedes: req.supersedes } : {});
      const list = eventsOf(chatId);
      list.push(p);
      // Два события одним коммитом: принятие — на секунду позже, чтобы порядок был однозначным.
      if (req.accept) list.push(act(t + 1000, ME, "accept", p.id));
      touch(chatId);
      return { decision: structuredClone(decisionOf(chatId, p.id)) };
    },
    async decisionAction(_repo, chatId, decisionId, action, req) {
      await wait(700);
      writable();
      const d = decisionOf(chatId, decisionId);
      // Те же правила, что у сервера: переходы по статусу и непустое обсуждение.
      if (!decisionActions(d.status, true).includes(action)) {
        throw new ApiFailure(409, "conflict", "Решение уже в другом статусе — сначала «Открыть заново»");
      }
      const text = req?.text?.trim() ?? "";
      if (action === "discuss" && !text) throw new ApiFailure(400, "bad_request", "Напиши, что обсудить");
      eventsOf(chatId).push(act(Date.now(), ME, action, decisionId, text));
      touch(chatId);
      return { decision: structuredClone(decisionOf(chatId, decisionId)) };
    },
    async proposeToParent(_repo, forkChatId, req) {
      await wait(1000);
      writable();
      const fork = chatOf(forkChatId);
      if (!fork.parent) throw new ApiFailure(400, "bad_request", "Это не Fork — предлагать некому");
      const parentId = fork.parent.chat_id;
      chatOf(parentId);
      if (/ошибка/i.test(req.title)) throw new ApiFailure(502, "github_error", "GitHub не дал записать в ветку родителя — попробуй ещё раз");
      checkSupersedes(parentId, req.supersedes);
      const p = propose(Date.now(), ME, req.title, req.text, req.source_messages, {
        from_chat: forkChatId,
        ...(req.supersedes ? { supersedes: req.supersedes } : {}),
      });
      eventsOf(parentId).push(p);
      touch(parentId);
      touch(forkChatId);
      return { decision: structuredClone(decisionOf(parentId, p.id)) };
    },
    async logout() {
      await wait(100);
    },
    subscribe(_repo, h) {
      h.onState?.(true);
      if (mode !== "live") return () => {};
      const timer = setTimeout(() => {
        const items = db.items.get("20261023-k7q2");
        if (!items) return;
        items.push(
          file(Date.now(), "codex", "Добавил оценку цены узла: мост ≈ 1,8× вакуумной руки, зато ремонт — замена ролика за 5 минут.", undefined, {
            actor: "chatgpt-codex-connector[bot]",
          }),
        );
        touch("20261023-k7q2");
        h.onChat({ repo: REPO, chat_id: "20261023-k7q2", number: 3 });
      }, 12_000);
      return () => clearTimeout(timer);
    },
  };
}
