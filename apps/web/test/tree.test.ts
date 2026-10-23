/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { GraphChat, GraphDecision, GraphMessage } from "@chat0110/chat-protocol";
import { forkParents } from "../src/lib/forest.ts";
import { layoutTree, TREE_GEOMETRY, type TreeLayout } from "../src/lib/tree.ts";

// Время сообщения — в его id (как в имени файла); created_at повторяет его.
function m(hhmm: string, author = "alex011082", rand = "aaaa"): GraphMessage {
  const [h, min] = hhmm.split(":") as [string, string];
  return {
    id: `20261023T${h}${min}00Z-${author}-${rand}`,
    author,
    created_at: `2026-10-23T${h}:${min}:00.000Z`,
  };
}

function chat(id: string, over: Partial<GraphChat> = {}): GraphChat {
  return {
    repo: "Alex011082/chat.0110",
    chat_id: id,
    title: `Чат ${id}`,
    number: 1,
    state: "open",
    draft: true,
    branch: `chat/${id}`,
    url: "https://github.com/Alex011082/chat.0110/pull/1",
    created_at: "2026-10-23T09:00:00.000Z",
    updated_at: "2026-10-23T12:00:00.000Z",
    created_by: "alex011082",
    parent: null,
    messages: [],
    decisions: [],
    ...over,
  };
}

// Решение: id события-предложения — того же вида, что у сообщения.
function d(hhmm: string, over: Partial<GraphDecision> = {}, rand = "dddd"): GraphDecision {
  const [h, min] = hhmm.split(":") as [string, string];
  return {
    id: `20261023T${h}${min}00Z-alex011082-${rand}`,
    title: `Решение ${hhmm}`,
    status: "accepted",
    created_at: `2026-10-23T${h}:${min}:00.000Z`,
    ...over,
  };
}

const fork = (chatId: string, messageId: string) => ({ chat_id: chatId, message_id: messageId, commit_sha: "a3f8c91" });

const node = (l: TreeLayout, key: string) => {
  const n = l.nodes.find((x) => x.key === key);
  if (!n) throw new Error(`нет узла ${key}`);
  return n;
};
const lane = (l: TreeLayout, chatId: string) => {
  const x = l.lanes.find((v) => v.chatId === chatId);
  if (!x) throw new Error(`нет ветки ${chatId}`);
  return x;
};
const rowsOf = (l: TreeLayout) => l.nodes.map((n) => n.key);

const A = "20261023-aaaa";
const B = "20261023-bbbb";
const C = "20261023-cccc";
const D = "20261023-dddd";
const E = "20261023-eeee";

describe("layoutTree — пусто и один чат", () => {
  test("нет чатов — пустое дерево с полями", () => {
    const l = layoutTree([]);
    expect(l.lanes).toEqual([]);
    expect(l.nodes).toEqual([]);
    expect(l.edges).toEqual([]);
    expect(l.rows).toBe(0);
    expect(l.width).toBe(TREE_GEOMETRY.padX * 2);
    expect(l.height).toBe(TREE_GEOMETRY.padTop + TREE_GEOMETRY.padBottom);
  });

  test("один чат: начало, точки, итог; строки по времени", () => {
    const msgs = [m("10:00"), m("10:05", "claude", "bbbb"), m("10:09", "codex", "cccc")];
    const l = layoutTree([chat(A, { messages: msgs })]);
    expect(l.lanes).toHaveLength(1);
    expect(l.nodes.map((n) => [n.kind, n.row, n.lane])).toEqual([
      ["start", 0, 0],
      ["dot", 1, 0],
      ["head", 2, 0],
    ]);
    expect(l.nodes.map((n) => n.messageId)).toEqual(msgs.map((x) => x.id));
    expect(l.nodes[0]!.start).toBe(true);
    expect(l.nodes[2]!.head).toBe(true);
    expect(l.nodes[1]!.author).toBe("claude");
    // Узлы стоят ровно на сетке.
    const g = TREE_GEOMETRY;
    expect(l.nodes[0]!.x).toBe(g.padX + g.laneW / 2);
    expect(l.nodes.map((n) => n.y)).toEqual([0, 1, 2].map((r) => g.padTop + r * g.rowH + g.rowH / 2));
    expect(l.rows).toBe(3);
    expect(l.height).toBe(g.padTop + 3 * g.rowH + g.padBottom);
    expect(l.width).toBe(g.padX * 2 + g.laneW);
  });

  test("ствол ветки — отрезок от начала до итога", () => {
    const l = layoutTree([chat(A, { messages: [m("10:00"), m("10:05"), m("10:09")] })]);
    const edge = l.edges.find((e) => e.kind === "lane");
    const start = l.nodes[0]!;
    const head = l.nodes[2]!;
    expect(edge).toMatchObject({ chatId: A, from: start.key, to: head.key });
    expect(edge!.d).toBe(`M${start.x} ${start.y}V${head.y}`);
    expect(lane(l, A)).toMatchObject({ startKey: start.key, headKey: head.key, startY: start.y, headY: head.y });
  });

  test("сообщения вразнобой и с повтором id — по времени, без дублей", () => {
    const x = m("10:05", "claude", "bbbb");
    const l = layoutTree([chat(A, { messages: [m("10:09", "codex"), x, m("10:00"), { ...x }] })]);
    expect(l.nodes.map((n) => n.author)).toEqual(["alex011082", "claude", "codex"]);
  });

  test("чат без сообщений — узел начала на created_at, он же итог; ствола нет", () => {
    const l = layoutTree([chat(A, { created_at: "2026-10-23T10:30:00.000Z" })]);
    expect(l.nodes).toHaveLength(1);
    expect(l.nodes[0]).toMatchObject({
      key: `${A}/start`,
      messageId: null,
      author: null,
      at: "2026-10-23T10:30:00.000Z",
      kind: "start",
      start: true,
      head: true,
    });
    expect(l.edges).toEqual([]);
  });

  test("одно сообщение — начало и итог сразу", () => {
    const l = layoutTree([chat(A, { messages: [m("10:00")] })]);
    expect(l.nodes[0]).toMatchObject({ kind: "start", start: true, head: true });
    expect(l.edges).toEqual([]);
  });
});

describe("layoutTree — Fork", () => {
  const p = [m("10:00"), m("10:10", "claude"), m("10:30", "codex")];
  const parent = chat(A, { messages: p });

  test("точка Fork — сообщение родителя, ребёнок правее и ниже", () => {
    const child = chat(B, { parent: fork(A, p[1]!.id), messages: [m("10:15"), m("10:40", "claude")] });
    const l = layoutTree([child, parent]);
    expect(lane(l, A).lane).toBe(0);
    expect(lane(l, B).lane).toBe(1);
    expect(lane(l, B).parentId).toBe(A);
    expect(lane(l, B).depth).toBe(1);
    expect(lane(l, A).children).toEqual([B]);

    const point = node(l, `${A}/${p[1]!.id}`);
    expect(point.kind).toBe("fork");
    expect(point.forks).toEqual([B]);
    expect(lane(l, B).forkKey).toBe(point.key);

    const start = node(l, lane(l, B).startKey);
    expect(start.row).toBeGreaterThan(point.row);
    expect(start.x).toBeGreaterThan(point.x);
  });

  test("строки — общий порядок времени всех чатов", () => {
    const child = chat(B, { parent: fork(A, p[1]!.id), messages: [m("10:15", "alex011082", "c1c1"), m("10:40", "claude", "c2c2")] });
    const l = layoutTree([parent, child]);
    expect(l.nodes.map((n) => n.at.slice(11, 16))).toEqual(["10:00", "10:10", "10:15", "10:30", "10:40"]);
    expect(l.nodes.map((n) => n.lane)).toEqual([0, 0, 1, 0, 1]);
    expect(node(l, `${A}/${p[2]!.id}`).kind).toBe("head");
  });

  test("ребёнок всегда начинается ниже точки Fork, даже если часы врут", () => {
    // Первое сообщение ребёнка «раньше» точки ветвления — так бывает при сбитых часах.
    const child = chat(B, { parent: fork(A, p[1]!.id), messages: [m("09:00")] });
    const l = layoutTree([parent, child]);
    const point = node(l, `${A}/${p[1]!.id}`);
    expect(node(l, lane(l, B).startKey).row).toBe(point.row + 1);
  });

  test("ребёнок без сообщений — узел начала на created_at", () => {
    const child = chat(B, { parent: fork(A, p[1]!.id), created_at: "2026-10-23T10:20:00.000Z" });
    const l = layoutTree([parent, child]);
    expect(rowsOf(l)).toEqual([`${A}/${p[0]!.id}`, `${A}/${p[1]!.id}`, `${B}/start`, `${A}/${p[2]!.id}`]);
    expect(l.edges.find((e) => e.kind === "fork")).toMatchObject({ from: `${A}/${p[1]!.id}`, to: `${B}/start` });
  });

  test("точки Fork нет среди файлов (комментарий PR) — ближайшая более ранняя точка по времени создания", () => {
    const child = chat(B, {
      parent: fork(A, "c2000001"),
      created_at: "2026-10-23T10:20:00.000Z",
      messages: [m("10:21")],
    });
    const l = layoutTree([parent, child]);
    expect(lane(l, B).forkKey).toBe(`${A}/${p[1]!.id}`);
    expect(node(l, `${A}/${p[1]!.id}`).forks).toEqual([B]);
  });

  test("id файла есть, но файла нет — время берётся из id", () => {
    const missing = "20261023T100200Z-claude-zzzz"; // 10:02 — после первого сообщения
    const child = chat(B, { parent: fork(A, missing), created_at: "2026-10-23T11:00:00.000Z", messages: [m("11:00")] });
    const l = layoutTree([parent, child]);
    expect(lane(l, B).forkKey).toBe(`${A}/${p[0]!.id}`);
  });

  test("всё у родителя позже точки — Fork от его начала", () => {
    const child = chat(B, { parent: fork(A, "c1"), created_at: "2026-10-23T08:00:00.000Z", messages: [m("10:01")] });
    const l = layoutTree([parent, child]);
    expect(lane(l, B).forkKey).toBe(lane(l, A).startKey);
    expect(node(l, lane(l, A).startKey)).toMatchObject({ kind: "start", forks: [B] });
  });

  test("родитель без сообщений — Fork от его узла начала", () => {
    const empty = chat(A, { created_at: "2026-10-23T09:00:00.000Z" });
    const child = chat(B, { parent: fork(A, "c1"), messages: [m("10:00")] });
    const l = layoutTree([empty, child]);
    expect(lane(l, B).forkKey).toBe(`${A}/start`);
  });

  test("Fork от итога: узел и итог, и точка Fork", () => {
    const child = chat(B, { parent: fork(A, p[2]!.id), messages: [m("10:45")] });
    const l = layoutTree([parent, child]);
    const last = node(l, `${A}/${p[2]!.id}`);
    expect(last).toMatchObject({ kind: "fork", head: true, forks: [B] });
  });

  test("ребро Fork — гладкая кривая от точки к началу ребёнка", () => {
    const child = chat(B, { parent: fork(A, p[1]!.id), messages: [m("10:15"), m("10:40")] });
    const l = layoutTree([parent, child]);
    const e = l.edges.find((x) => x.kind === "fork")!;
    const from = node(l, e.from);
    const to = node(l, e.to);
    expect(e.chatId).toBe(B);
    expect(e.d.startsWith(`M${from.x} ${from.y}C`)).toBe(true);
    expect(e.d.endsWith(`${to.x} ${to.y}`)).toBe(true);
  });

  test("далёкое начало — изгиб у точки Fork, дальше прямо вниз", () => {
    const child = chat(B, {
      parent: fork(A, p[0]!.id),
      messages: [m("10:50")],
    });
    const l = layoutTree([parent, child]);
    const e = l.edges.find((x) => x.kind === "fork")!;
    const to = node(l, e.to);
    // Кривая не тянется наискось через всю высоту: заканчивается вертикальным отрезком.
    expect(e.d).toMatch(new RegExp(`V${to.y}$`));
  });

  test("несколько Fork от одного сообщения — в порядке веток", () => {
    const b = chat(B, { parent: fork(A, p[1]!.id), messages: [m("10:12")] });
    const c = chat(C, { parent: fork(A, p[1]!.id), messages: [m("10:14")] });
    const l = layoutTree([c, parent, b]);
    expect(node(l, `${A}/${p[1]!.id}`).forks).toEqual([B, C]);
  });
});

describe("layoutTree — ветки (lanes)", () => {
  test("DFS: корень, его дети по времени Fork, поддерево сплошное; второй корень — следующая свободная", () => {
    const pa = [m("10:00"), m("10:10"), m("10:20"), m("10:30")];
    const a = chat(A, { messages: pa });
    const b = chat(B, { parent: fork(A, pa[0]!.id), messages: [m("10:05", "alex011082", "bbbb")] });
    const c = chat(C, { parent: fork(A, pa[2]!.id), messages: [m("10:25", "alex011082", "cccc")] });
    const d = chat(D, { parent: fork(B, "c1"), created_at: "2026-10-23T10:06:00.000Z", messages: [m("10:07", "alex011082", "dddd")] });
    const e = chat(E, { created_at: "2026-10-23T09:30:00.000Z", messages: [m("10:01", "alex011082", "eeee")] });
    const l = layoutTree([e, d, c, b, a]);
    expect(l.lanes.map((x) => [x.chatId, x.lane, x.depth])).toEqual([
      [A, 0, 0],
      [B, 1, 1],
      [D, 2, 2],
      [C, 3, 1],
      [E, 4, 0],
    ]);
    expect(lane(l, D).rootId).toBe(A);
    expect(lane(l, E).rootId).toBe(E);
    expect(l.width).toBe(TREE_GEOMETRY.padX * 2 + 5 * TREE_GEOMETRY.laneW);
  });

  test("корни: живые деревья левее, внутри — свежие первыми; закрытые целиком — правее", () => {
    const old = chat(A, { updated_at: "2026-10-23T09:00:00.000Z", messages: [m("08:00")] });
    const fresh = chat(B, { updated_at: "2026-10-23T09:30:00.000Z", messages: [m("08:30")] });
    // У этого корня сам он не свежий, но его Fork — свежее всех.
    const grand = chat(C, { updated_at: "2026-10-23T08:00:00.000Z", messages: [m("08:10"), m("08:20")] });
    const kid = chat(D, { parent: fork(C, "c1"), created_at: "2026-10-23T08:15:00.000Z", updated_at: "2026-10-23T11:00:00.000Z", messages: [m("08:16")] });
    const shut = chat(E, { state: "closed", updated_at: "2026-10-23T12:00:00.000Z", messages: [m("07:00")] });
    const l = layoutTree([old, fresh, grand, kid, shut]);
    expect(l.lanes.map((x) => x.chatId)).toEqual([C, D, B, A, E]);
  });

  test("сирота (родителя нет в списке) — сам корень", () => {
    const b = chat(B, { parent: fork("20261001-gone", "c1"), messages: [m("10:00")] });
    const l = layoutTree([b]);
    expect(lane(l, B)).toMatchObject({ lane: 0, depth: 0, parentId: null, forkKey: null });
    expect(l.edges.filter((x) => x.kind === "fork")).toEqual([]);
  });

  test("цикл в данных не вешает раскладку: старший становится корнем", () => {
    const a = chat(A, { created_at: "2026-10-23T08:00:00.000Z", parent: fork(B, "c1"), messages: [m("10:00")] });
    const b = chat(B, { created_at: "2026-10-23T09:00:00.000Z", parent: fork(A, "c1"), messages: [m("10:10")] });
    const l = layoutTree([b, a]);
    expect(lane(l, A)).toMatchObject({ lane: 0, parentId: null });
    expect(lane(l, B)).toMatchObject({ lane: 1, parentId: A });
  });

  test("закрытые чаты тоже в дереве", () => {
    const l = layoutTree([chat(A, { state: "closed", messages: [m("10:00")] })]);
    expect(lane(l, A).chat.state).toBe("closed");
  });

  test("одинаковое время — порядок по id, устойчиво", () => {
    const x = m("10:00", "claude", "zzzz");
    const y = m("10:00", "codex", "aaaa");
    const one = layoutTree([chat(A, { messages: [x] }), chat(B, { messages: [y], created_at: "2026-10-23T09:00:00.000Z" })]);
    const two = layoutTree([chat(B, { messages: [y], created_at: "2026-10-23T09:00:00.000Z" }), chat(A, { messages: [x] })]);
    expect(rowsOf(one)).toEqual(rowsOf(two));
    // «…-claude-zzzz» < «…-codex-aaaa» по строке id.
    expect(rowsOf(one)).toEqual([`${A}/${x.id}`, `${B}/${y.id}`]);
  });

  test("свои размеры сетки", () => {
    const geo = { ...TREE_GEOMETRY, laneW: 100, rowH: 20, padX: 0, padTop: 0, padBottom: 0 };
    const l = layoutTree([chat(A, { messages: [m("10:00"), m("10:01")] })], geo);
    expect(l.nodes.map((n) => [n.x, n.y])).toEqual([
      [50, 10],
      [50, 30],
    ]);
    expect([l.width, l.height]).toEqual([100, 40]);
  });
});

describe("forkParents — связи ребёнок → родитель", () => {
  test("только существующие родители, без петель на себя", () => {
    const map = forkParents([
      chat(A),
      chat(B, { parent: fork(A, "c1") }),
      chat(C, { parent: fork("20261001-gone", "c1") }),
      chat(D, { parent: fork(D, "c1") }),
    ]);
    expect([...map]).toEqual([[B, A]]);
  });

  test("длинный цикл разрывается у самого старого", () => {
    const map = forkParents([
      chat(A, { created_at: "2026-10-23T10:00:00.000Z", parent: fork(C, "c1") }),
      chat(B, { created_at: "2026-10-23T09:00:00.000Z", parent: fork(A, "c1") }),
      chat(C, { created_at: "2026-10-23T11:00:00.000Z", parent: fork(B, "c1") }),
    ]);
    expect(map.has(B)).toBe(false);
    expect(map.get(A)).toBe(C);
    expect(map.get(C)).toBe(B);
  });
});

describe("layoutTree — решения", () => {
  const p = [m("10:00"), m("10:10", "claude"), m("10:30", "codex")];

  test("решение — узел-ромб на своей ветке, занимает строку по времени", () => {
    const dec = d("10:15");
    const l = layoutTree([chat(A, { messages: p, decisions: [dec] })]);
    expect(l.nodes.map((n) => n.kind)).toEqual(["start", "dot", "decision", "head"]);
    const n = node(l, `${A}/d:${dec.id}`);
    expect(n).toMatchObject({ chatId: A, lane: 0, row: 2, messageId: null, start: false, head: false, decision: dec });
    expect(l.nodes.filter((x) => x.kind !== "decision").every((x) => x.decision === null)).toBe(true);
    expect(lane(l, A).decisions).toEqual([n.key]);
    expect(l.rows).toBe(4);
    expect(l.height).toBe(TREE_GEOMETRY.padTop + 4 * TREE_GEOMETRY.rowH + TREE_GEOMETRY.padBottom);
  });

  test("решение после последнего сообщения: итог — сообщение, ствол тянется до решения", () => {
    const dec = d("10:40");
    const l = layoutTree([chat(A, { messages: p, decisions: [dec] })]);
    const head = node(l, `${A}/${p[2]!.id}`);
    const last = node(l, `${A}/d:${dec.id}`);
    expect(head).toMatchObject({ kind: "head", head: true });
    expect(lane(l, A)).toMatchObject({ headKey: head.key, headY: head.y, endY: last.y, topY: node(l, lane(l, A).startKey).y });
    const edge = l.edges.find((e) => e.kind === "lane")!;
    expect(edge).toMatchObject({ from: lane(l, A).startKey, to: last.key });
    expect(edge.d).toBe(`M${head.x} ${lane(l, A).startY}V${last.y}`);
  });

  test("чат без сообщений, но с решением — узел начала и ромб", () => {
    const dec = d("10:40");
    const l = layoutTree([chat(A, { created_at: "2026-10-23T10:30:00.000Z", decisions: [dec] })]);
    expect(l.nodes.map((n) => n.kind)).toEqual(["start", "decision"]);
    expect(l.nodes[0]).toMatchObject({ start: true, head: true });
    expect(l.edges).toHaveLength(1);
  });

  test("повтор id решения — один узел", () => {
    const dec = d("10:15");
    const l = layoutTree([chat(A, { messages: p, decisions: [dec, { ...dec }] })]);
    expect(l.nodes.filter((n) => n.kind === "decision")).toHaveLength(1);
  });

  test("точка Fork — всегда сообщение, не решение", () => {
    // Точки нет среди файлов: ближайшее более раннее событие — сообщение, а не ромб в 10:20.
    const parent = chat(A, { messages: p, decisions: [d("10:20")] });
    const child = chat(B, { parent: fork(A, "c2000001"), created_at: "2026-10-23T10:25:00.000Z", messages: [m("10:26")] });
    const l = layoutTree([parent, child]);
    expect(lane(l, B).forkKey).toBe(`${A}/${p[1]!.id}`);
  });

  test("предложение из Fork: провод от конца ветки Fork к ромбу родителя, по статусу", () => {
    const child = chat(B, { parent: fork(A, p[1]!.id), messages: [m("10:12"), m("10:20", "codex")] });
    const proposal = d("10:45", { status: "proposed", from_chat: B }, "pppp");
    const parent = chat(A, { messages: [...p, m("10:40", "claude", "x40x")], decisions: [proposal] });
    const l = layoutTree([parent, child]);
    const e = l.edges.find((x) => x.kind === "proposal")!;
    const to = node(l, `${A}/d:${proposal.id}`);
    const forkEnd = node(l, lane(l, B).headKey);
    expect(e).toMatchObject({ chatId: B, to: to.key, from: forkEnd.key, status: "proposed", decisionId: proposal.id });
    // Ветка Fork кончилась раньше предложения: провод идёт вниз от её конца и входит в ромб сбоку.
    expect(e.d.startsWith(`M${forkEnd.x} ${forkEnd.y}V`)).toBe(true);
    expect(e.d.endsWith(`${to.x} ${to.y}`)).toBe(true);
  });

  test("ветка Fork ещё идёт в момент предложения — провод горизонтальный на строке ромба", () => {
    const child = chat(B, { parent: fork(A, p[0]!.id), messages: [m("10:05"), m("10:50", "codex")] });
    const proposal = d("10:35", { status: "accepted", from_chat: B }, "pppp");
    const l = layoutTree([chat(A, { messages: p, decisions: [proposal] }), child]);
    const e = l.edges.find((x) => x.kind === "proposal")!;
    const to = node(l, `${A}/d:${proposal.id}`);
    expect(e.d).toBe(`M${lane(l, B).x} ${to.y}H${to.x}`);
    expect(e.status).toBe("accepted");
  });

  test("Fork-источника нет в дереве — провода нет", () => {
    const proposal = d("10:35", { status: "proposed", from_chat: "20261001-gone" });
    const l = layoutTree([chat(A, { messages: p, decisions: [proposal] })]);
    expect(l.edges.filter((x) => x.kind === "proposal")).toEqual([]);
  });

  test("замена: тонкая дуга от нового решения к старому на той же ветке", () => {
    const old = d("10:05", { status: "superseded" }, "old1");
    const neu = d("10:35", { status: "accepted", supersedes: old.id }, "new1");
    const l = layoutTree([chat(A, { messages: p, decisions: [old, neu] })]);
    const e = l.edges.find((x) => x.kind === "supersede")!;
    const a = node(l, `${A}/d:${neu.id}`);
    const b = node(l, `${A}/d:${old.id}`);
    expect(e).toMatchObject({ chatId: A, from: a.key, to: b.key, decisionId: neu.id });
    expect(e.d.startsWith(`M${a.x} ${a.y}C`)).toBe(true);
    expect(e.d.endsWith(`${b.x} ${b.y}`)).toBe(true);
    // Старого решения нет — дуги нет.
    const l2 = layoutTree([chat(A, { messages: p, decisions: [neu] })]);
    expect(l2.edges.filter((x) => x.kind === "supersede")).toEqual([]);
  });
});
