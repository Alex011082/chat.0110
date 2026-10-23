import { parseMessageId, type GraphChat } from "@chat0110/chat-protocol";
import { forkParents } from "./forest.ts";

// Раскладка дерева разговоров (экран «Дерево»). Чистая функция: на входе
// GET /api/graph, на выходе координаты узлов и рёбер — рисовальщик ничего не
// считает. Ветка (lane) — вертикаль одного чата; строка (row) — место события
// в общем порядке времени всех чатов, поэтому ребёнок всегда ниже точки Fork.

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

export type TreeNodeKind = "start" | "fork" | "head" | "dot";

export interface TreeNode {
  /** `<chat_id>/<message_id>` или `<chat_id>/start` для чата без сообщений. */
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
  startKey: string;
  headKey: string;
  startY: number;
  headY: number;
  /** Узел родителя, от которого идёт ребро Fork. */
  forkKey: string | null;
}

export interface TreeEdge {
  key: string;
  kind: "lane" | "fork";
  /** Чат ветки; для ребра Fork — ребёнок. */
  chatId: string;
  from: string;
  to: string;
  /** Путь SVG. */
  d: string;
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

/** Сообщения чата по времени; чат без сообщений — один узел начала. */
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
    });
  }
  return list.sort(before);
}

/**
 * Индекс события родителя, от которого ответвился ребёнок. Если сообщения
 * точки нет среди файлов (это комментарий PR или файл не дошёл) — ближайшее
 * более раннее событие: по времени из id сообщения, иначе по времени создания
 * ребёнка. Раньше всех — начало родителя.
 */
function anchorIndex(parentEvents: readonly Event[], child: GraphChat): number {
  const id = child.parent?.message_id;
  if (!id) return 0;
  const exact = parentEvents.findIndex((e) => e.messageId === id);
  if (exact >= 0) return exact;
  const fromId = parseMessageId(id);
  const at = fromId ? Date.parse(fromId.date) : ms(child.created_at);
  if (!Number.isFinite(at)) return 0;
  let idx = 0;
  parentEvents.forEach((e, i) => {
    if (e.t <= at) idx = i;
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

  const nodeByKey = new Map<string, TreeNode>();
  const nodes: TreeNode[] = order.map((e) => {
    const list = events.get(e.chatId)!;
    const start = list[0]!.key === e.key;
    const head = list[list.length - 1]!.key === e.key;
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
      kind: start ? "start" : forks.length ? "fork" : head ? "head" : "dot",
      start,
      head,
      forks,
    };
    nodeByKey.set(e.key, n);
    return n;
  });

  // --- Ветки и рёбра.
  const lanes: TreeLane[] = unique
    .map((c) => {
      const info = laneInfo.get(c.chat_id)!;
      const list = events.get(c.chat_id)!;
      const first = nodeByKey.get(list[0]!.key)!;
      const last = nodeByKey.get(list[list.length - 1]!.key)!;
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
        startKey: first.key,
        headKey: last.key,
        startY: first.y,
        headY: last.y,
        forkKey: forkKeyOf.get(c.chat_id) ?? null,
      };
    })
    .sort((a, b) => a.lane - b.lane);

  const edges: TreeEdge[] = [];
  for (const l of lanes) {
    if (l.startKey !== l.headKey) {
      edges.push({ key: `lane:${l.chatId}`, kind: "lane", chatId: l.chatId, from: l.startKey, to: l.headKey, d: `M${l.x} ${l.startY}V${l.headY}` });
    }
  }
  for (const l of lanes) {
    if (!l.forkKey) continue;
    const from = nodeByKey.get(l.forkKey)!;
    const to = nodeByKey.get(l.startKey)!;
    edges.push({ key: `fork:${l.chatId}`, kind: "fork", chatId: l.chatId, from: from.key, to: to.key, d: forkPath(from.x, from.y, to.x, to.y, geo) });
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
