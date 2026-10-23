import { parseMessageId, type DecisionStatus, type GraphChat, type GraphDecision } from "@chat0110/chat-protocol";
import { forkParents } from "./forest.ts";

// Раскладка дерева разговоров (экран «Дерево»). Чистая функция: на входе
// GET /api/graph, на выходе координаты узлов и рёбер — рисовальщик ничего не
// считает. Ветка (lane) — вертикаль одного чата; строка (row) — место события
// в общем порядке времени всех чатов, поэтому ребёнок всегда ниже точки Fork.
// Решения (Этап 5) — ромбы на ветке своего чата: занимают строку, как сообщения,
// но не бывают ни началом, ни итогом, ни точкой Fork.

export interface TreeGeometry {
  /** Шаг между осями соседних веток. */
  laneW: number;
  /** Шаг строки: одно событие — одна строка. */
  rowH: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Сколько строк, самое большее, занимает изгиб ребра Fork. */
  bend: number;
}

export const TREE_GEOMETRY: TreeGeometry = { laneW: 152, rowH: 24, padX: 8, padTop: 20, padBottom: 28, bend: 2 };

export type TreeNodeKind = "start" | "fork" | "head" | "dot" | "decision";

export interface TreeNode {
  /**
   * `<chat_id>/<message_id>`, `<chat_id>/start` для чата без сообщений,
   * `<chat_id>/d:<decision_id>` для решения.
   */
  key: string;
  chatId: string;
  /** null — узел начала чата, в котором ещё нет сообщений. */
  messageId: string | null;
  author: string | null;
  at: string;
  row: number;
  lane: number;
  x: number;
  y: number;
  /** Главная роль для рисования: начало > Fork > итог > точка. */
  kind: TreeNodeKind;
  start: boolean;
  head: boolean;
  /** Дети, ответвлённые от этого узла, — в порядке их веток. */
  forks: string[];
  /** Решение — у узла-ромба; у остальных null. */
  decision: GraphDecision | null;
}

export interface TreeLane {
  chatId: string;
  chat: GraphChat;
  lane: number;
  x: number;
  /** Поколение: 0 — корень. */
  depth: number;
  parentId: string | null;
  rootId: string;
  children: string[];
  nodes: string[];
  /** Ромбы решений этой ветки по времени. */
  decisions: string[];
  /** Начало и итог — сообщения (или узел начала), не решения. */
  startKey: string;
  headKey: string;
  startY: number;
  headY: number;
  /** Верх и низ ствола — с учётом решений вне сообщений. */
  topY: number;
  endY: number;
  topKey: string;
  endKey: string;
  /** Узел родителя, от которого идёт ребро Fork. */
  forkKey: string | null;
}

export interface TreeEdge {
  key: string;
  /**
   * lane — ствол ветки; fork — провод от точки Fork к началу ребёнка;
   * proposal — «Предложить родителю»: от ветки Fork к ромбу в родителе;
   * supersede — новое решение заменило старое на той же ветке.
   */
  kind: "lane" | "fork" | "proposal" | "supersede";
  /** Чат ветки; для ребра Fork и провода предложения — ребёнок (Fork). */
  chatId: string;
  from: string;
  to: string;
  /** Путь SVG. */
  d: string;
  /** У proposal и supersede — решение, к которому относится ребро. */
  decisionId?: string;
  /** У proposal — статус решения: пунктир, пока ждёт; сплошной, когда принято. */
  status?: DecisionStatus;
}

export interface TreeLayout {
  lanes: TreeLane[];
  /** По строкам сверху вниз. */
  nodes: TreeNode[];
  edges: TreeEdge[];
  rows: number;
  width: number;
  height: number;
  geometry: TreeGeometry;
}

interface Event {
  key: string;
  chatId: string;
  messageId: string | null;
  author: string | null;
  at: string;
  t: number;
  /** Для равного времени: id сообщения (или чата у узла начала). */
  sortId: string;
  decision: GraphDecision | null;
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};

function messageTime(id: string, iso: string, fallback: number): number {
  const t = ms(iso);
  if (Number.isFinite(t)) return t;
  const fromId = parseMessageId(id);
  return fromId ? Date.parse(fromId.date) : fallback;
}

const before = (a: Event, b: Event) => a.t - b.t || (a.sortId < b.sortId ? -1 : a.sortId > b.sortId ? 1 : 0);

/** Сообщения и решения чата по времени; чат без сообщений — узел начала. */
function eventsOf(chat: GraphChat): Event[] {
  const created = ms(chat.created_at);
  const base = Number.isFinite(created) ? created : 0;
  const seen = new Set<string>();
  const list: Event[] = [];
  for (const m of chat.messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    list.push({
      key: `${chat.chat_id}/${m.id}`,
      chatId: chat.chat_id,
      messageId: m.id,
      author: m.author,
      at: m.created_at,
      t: messageTime(m.id, m.created_at, base),
      sortId: m.id,
      decision: null,
    });
  }
  if (list.length === 0) {
    list.push({
      key: `${chat.chat_id}/start`,
      chatId: chat.chat_id,
      messageId: null,
      author: null,
      at: chat.created_at,
      t: base,
      sortId: chat.chat_id,
      decision: null,
    });
  }
  const seenDecisions = new Set<string>();
  for (const d of chat.decisions ?? []) {
    if (seenDecisions.has(d.id)) continue;
    seenDecisions.add(d.id);
    list.push({
      key: `${chat.chat_id}/d:${d.id}`,
      chatId: chat.chat_id,
      messageId: null,
      author: null,
      at: d.created_at,
      t: messageTime(d.id, d.created_at, base),
      sortId: d.id,
      decision: d,
    });
  }
  return list.sort(before);
}

const isPost = (e: Event) => e.decision === null;

/**
 * Индекс события родителя, от которого ответвился ребёнок. Если сообщения
 * точки нет среди файлов (это комментарий PR или файл не дошёл) — ближайшее
 * более раннее событие: по времени из id сообщения, иначе по времени создания
 * ребёнка. Раньше всех — начало родителя.
 */
function anchorIndex(parentEvents: readonly Event[], child: GraphChat): number {
  // Точка Fork — всегда сообщение (или начало), решения пропускаем.
  const first = parentEvents.findIndex(isPost);
  const id = child.parent?.message_id;
  if (!id) return first;
  const exact = parentEvents.findIndex((e) => e.messageId === id);
  if (exact >= 0) return exact;
  const fromId = parseMessageId(id);
  const at = fromId ? Date.parse(fromId.date) : ms(child.created_at);
  if (!Number.isFinite(at)) return first;
  let idx = first;
  parentEvents.forEach((e, i) => {
    if (isPost(e) && e.t <= at) idx = i;
  });
  return idx;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Ребро Fork: уходит от точки горизонтально и плавно входит в ось ребёнка
 * сверху (четверть эллипса кубической кривой). Если начало ребёнка далеко
 * внизу, изгиб занимает не больше `bend` строк, дальше — прямо вниз: кривая
 * не режет наискось чужие ветки по всей высоте.
 */
function forkPath(x1: number, y1: number, x2: number, y2: number, geo: TreeGeometry): string {
  const h = Math.min(y2 - y1, geo.bend * geo.rowH);
  const k = 0.5523;
  const ye = y1 + h;
  const curve = `M${r1(x1)} ${r1(y1)}C${r1(x1 + (x2 - x1) * k)} ${r1(y1)} ${r1(x2)} ${r1(ye - h * k)} ${r1(x2)} ${r1(ye)}`;
  return ye < y2 ? `${curve}V${r1(y2)}` : curve;
}

/**
 * Провод «Предложить родителю»: от ветки Fork вниз по её оси, затем плавно
 * влево и в ромб родителя сбоку. На одной строке — просто горизонталь.
 */
function proposalPath(x1: number, y1: number, x2: number, y2: number, geo: TreeGeometry): string {
  if (y1 === y2) return `M${r1(x1)} ${r1(y1)}H${r1(x2)}`;
  const dir = y2 > y1 ? 1 : -1;
  const h = Math.min(Math.abs(y2 - y1), geo.bend * geo.rowH) * dir;
  const k = 0.5523;
  const ys = y2 - h;
  const lead = ys !== y1 ? `M${r1(x1)} ${r1(y1)}V${r1(ys)}` : `M${r1(x1)} ${r1(y1)}`;
  return `${lead}C${r1(x1)} ${r1(ys + h * k)} ${r1(x2 + (x1 - x2) * k)} ${r1(y2)} ${r1(x2)} ${r1(y2)}`;
}

/** Замена решения: тонкая дуга слева от оси ветки — не сливается со стволом. */
function supersedePath(x: number, y1: number, y2: number, geo: TreeGeometry): string {
  const b = geo.laneW * 0.22;
  return `M${r1(x)} ${r1(y1)}C${r1(x - b)} ${r1(y1)} ${r1(x - b)} ${r1(y2)} ${r1(x)} ${r1(y2)}`;
}

export function layoutTree(chats: readonly GraphChat[], geo: TreeGeometry = TREE_GEOMETRY): TreeLayout {
  // Повтор chat_id — берём первый.
  const unique: GraphChat[] = [];
  const byId = new Map<string, GraphChat>();
  for (const c of chats) {
    if (byId.has(c.chat_id)) continue;
    byId.set(c.chat_id, c);
    unique.push(c);
  }

  const parentOf = forkParents(unique);
  const events = new Map(unique.map((c) => [c.chat_id, eventsOf(c)] as const));
  const anchor = new Map<string, number>();
  for (const [child, parent] of parentOf) anchor.set(child, anchorIndex(events.get(parent)!, byId.get(child)!));

  // --- Строки: слияние цепочек по времени с условием «ребёнок после точки Fork».
  const placed = new Map<string, number>(); // chat_id → сколько событий уже стоит
  const rowOf = new Map<string, number>(); // key события → строка
  const order: Event[] = [];
  const total = [...events.values()].reduce((n, l) => n + l.length, 0);
  while (order.length < total) {
    let best: Event | null = null;
    for (const c of unique) {
      const list = events.get(c.chat_id)!;
      const i = placed.get(c.chat_id) ?? 0;
      if (i >= list.length) continue;
      const parent = parentOf.get(c.chat_id);
      if (i === 0 && parent !== undefined && (placed.get(parent) ?? 0) <= anchor.get(c.chat_id)!) continue;
      const e = list[i]!;
      if (!best || before(e, best) < 0) best = e;
    }
    if (!best) break; // недостижимо: связи — лес без петель
    rowOf.set(best.key, order.length);
    order.push(best);
    placed.set(best.chatId, (placed.get(best.chatId) ?? 0) + 1);
  }

  // --- Ветки: обход в глубину. Корень — следующая свободная ветка, дети —
  // правее по времени Fork (строке своего начала), поддерево — сплошное.
  const children = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  }
  const startRow = (id: string) => rowOf.get(events.get(id)![0]!.key) ?? 0;
  const byStart = (a: string, b: string) => startRow(a) - startRow(b);
  for (const list of children.values()) list.sort(byStart);

  const xOf = (lane: number) => geo.padX + lane * geo.laneW + geo.laneW / 2;
  const yOf = (row: number) => geo.padTop + row * geo.rowH + geo.rowH / 2;

  const laneInfo = new Map<string, { lane: number; depth: number; rootId: string }>();
  let next = 0;
  const visit = (id: string, depth: number, rootId: string) => {
    laneInfo.set(id, { lane: next++, depth, rootId });
    for (const child of children.get(id) ?? []) visit(child, depth + 1, rootId);
  };
  // Корни — как список чатов: дерево, где открыт хоть один чат, левее; свежее
  // (по последнему обновлению во всём дереве) — первым. Живое видно без прокрутки.
  const subtree = (id: string): GraphChat[] => [byId.get(id)!, ...(children.get(id) ?? []).flatMap(subtree)];
  const rank = new Map<string, { alive: boolean; fresh: number }>();
  const roots = unique.map((c) => c.chat_id).filter((id) => !parentOf.has(id));
  for (const root of roots) {
    const all = subtree(root);
    rank.set(root, {
      alive: all.some((c) => c.state === "open"),
      fresh: Math.max(...all.map((c) => (Number.isFinite(ms(c.updated_at)) ? ms(c.updated_at) : 0))),
    });
  }
  roots.sort((a, b) => {
    const ra = rank.get(a)!;
    const rb = rank.get(b)!;
    return Number(rb.alive) - Number(ra.alive) || rb.fresh - ra.fresh || byStart(a, b);
  });
  for (const root of roots) visit(root, 0, root);

  // --- Узлы.
  const forksAt = new Map<string, string[]>(); // key узла родителя → дети
  const forkKeyOf = new Map<string, string>();
  for (const [child, parent] of parentOf) {
    const key = events.get(parent)![anchor.get(child)!]!.key;
    forkKeyOf.set(child, key);
    const list = forksAt.get(key) ?? [];
    list.push(child);
    forksAt.set(key, list);
  }
  for (const list of forksAt.values()) list.sort((a, b) => laneInfo.get(a)!.lane - laneInfo.get(b)!.lane);

  // Начало и итог ветки — первое и последнее сообщение (или узел начала).
  const postsOf = (id: string) => events.get(id)!.filter(isPost);
  const firstPost = new Map(unique.map((c) => [c.chat_id, postsOf(c.chat_id)[0]!.key] as const));
  const lastPost = new Map(unique.map((c) => [c.chat_id, postsOf(c.chat_id).at(-1)!.key] as const));

  const nodeByKey = new Map<string, TreeNode>();
  const nodes: TreeNode[] = order.map((e) => {
    const start = firstPost.get(e.chatId) === e.key;
    const head = lastPost.get(e.chatId) === e.key;
    const forks = forksAt.get(e.key) ?? [];
    const lane = laneInfo.get(e.chatId)!.lane;
    const row = rowOf.get(e.key)!;
    const n: TreeNode = {
      key: e.key,
      chatId: e.chatId,
      messageId: e.messageId,
      author: e.author,
      at: e.at,
      row,
      lane,
      x: xOf(lane),
      y: yOf(row),
      kind: e.decision ? "decision" : start ? "start" : forks.length ? "fork" : head ? "head" : "dot",
      start,
      head,
      forks,
      decision: e.decision,
    };
    nodeByKey.set(e.key, n);
    return n;
  });

  // --- Ветки и рёбра.
  const lanes: TreeLane[] = unique
    .map((c) => {
      const info = laneInfo.get(c.chat_id)!;
      const list = events.get(c.chat_id)!;
      const first = nodeByKey.get(firstPost.get(c.chat_id)!)!;
      const last = nodeByKey.get(lastPost.get(c.chat_id)!)!;
      const top = nodeByKey.get(list[0]!.key)!;
      const end = nodeByKey.get(list[list.length - 1]!.key)!;
      return {
        chatId: c.chat_id,
        chat: c,
        lane: info.lane,
        x: xOf(info.lane),
        depth: info.depth,
        parentId: parentOf.get(c.chat_id) ?? null,
        rootId: info.rootId,
        children: children.get(c.chat_id) ?? [],
        nodes: list.map((e) => e.key),
        decisions: list.filter((e) => e.decision).map((e) => e.key),
        startKey: first.key,
        headKey: last.key,
        startY: first.y,
        headY: last.y,
        topY: top.y,
        endY: end.y,
        forkKey: forkKeyOf.get(c.chat_id) ?? null,
        topKey: top.key,
        endKey: end.key,
      };
    })
    .sort((a, b) => a.lane - b.lane);

  const edges: TreeEdge[] = [];
  for (const l of lanes) {
    if (l.topKey !== l.endKey) {
      edges.push({ key: `lane:${l.chatId}`, kind: "lane", chatId: l.chatId, from: l.topKey, to: l.endKey, d: `M${l.x} ${l.topY}V${l.endY}` });
    }
  }
  for (const l of lanes) {
    if (!l.forkKey) continue;
    const from = nodeByKey.get(l.forkKey)!;
    const to = nodeByKey.get(l.startKey)!;
    edges.push({ key: `fork:${l.chatId}`, kind: "fork", chatId: l.chatId, from: from.key, to: to.key, d: forkPath(from.x, from.y, to.x, to.y, geo) });
  }

  // Провода предложений: из ветки Fork на строке предложения, а если ветка
  // к тому времени кончилась — от её конца.
  const laneOf = new Map(lanes.map((l) => [l.chatId, l] as const));
  for (const l of lanes) {
    for (const key of l.decisions) {
      const to = nodeByKey.get(key)!;
      const from = to.decision!.from_chat ? laneOf.get(to.decision!.from_chat) : undefined;
      if (!from || from.chatId === l.chatId) continue;
      const y = Math.min(Math.max(to.y, from.topY), from.endY);
      const near = [...from.nodes].reverse().map((k) => nodeByKey.get(k)!).find((n) => n.y <= y) ?? nodeByKey.get(from.topKey)!;
      edges.push({
        key: `proposal:${to.decision!.id}`,
        kind: "proposal",
        chatId: from.chatId,
        from: near.key,
        to: to.key,
        d: proposalPath(from.x, y, to.x, to.y, geo),
        decisionId: to.decision!.id,
        status: to.decision!.status,
      });
    }
  }
  for (const l of lanes) {
    for (const key of l.decisions) {
      const a = nodeByKey.get(key)!;
      const old = a.decision!.supersedes ? nodeByKey.get(`${l.chatId}/d:${a.decision!.supersedes}`) : undefined;
      if (!old) continue;
      edges.push({
        key: `supersede:${a.decision!.id}`,
        kind: "supersede",
        chatId: l.chatId,
        from: a.key,
        to: old.key,
        d: supersedePath(a.x, a.y, old.y, geo),
        decisionId: a.decision!.id,
      });
    }
  }

  return {
    lanes,
    nodes,
    edges,
    rows: order.length,
    width: geo.padX * 2 + lanes.length * geo.laneW,
    height: geo.padTop + order.length * geo.rowH + geo.padBottom,
    geometry: geo,
  };
}
