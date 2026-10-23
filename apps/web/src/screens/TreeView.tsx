import { displayName, parseMessageId, type GraphResponse } from "@chat0110/chat-protocol";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { routeHref, type Layout } from "../hooks.ts";
import { chatRoute, splitRepo } from "../lib/route.ts";
import { plural } from "../lib/text.ts";
import { ago, clock, dateTimeShort, dayKey, isFresh } from "../lib/time.ts";
import { awaitsHuman } from "../lib/decision.ts";
import { excerpt } from "../lib/text.ts";
import { layoutTree, TREE_GEOMETRY, type TreeEdge, type TreeGeometry, type TreeLane, type TreeLayout, type TreeNode } from "../lib/tree.ts";
import { forms, s } from "../strings.ts";
import { followInApp } from "../ui/AppLink.tsx";
import { ActionKeyLink, Body, cx, Grille, Key, Knob, Lamp, Plate, Readout, Screen } from "../ui/kit.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { DecisionShape } from "./DecisionCard.tsx";
import type { ForkTarget } from "./ForkDialog.tsx";

// Экран «Дерево»: все чаты репо — вертикальные ветки на плите прибора, Fork —
// изогнутые провода от точки ветвления. Раскладку считает lib/tree.ts; здесь
// только рисунок и клавиши. Доступная замена — иерархия в списке чатов.

const PHONE_GEOMETRY: TreeGeometry = { ...TREE_GEOMETRY, laneW: 128, padX: 4 };

interface TreeViewProps {
  repo: string | null;
  graph: GraphResponse | null;
  error: string | null;
  onRetry: () => void;
  select: string | null;
  onSelect: (chatId: string | null) => void;
  /** Ручка «Чат»: к выбранному чату или к списку. */
  onChatMode: () => void;
  onFork: (target: ForkTarget) => void;
  onNew: () => void;
  canPush: boolean;
  canCreate: boolean;
  now: number;
  layout: Layout;
}

export function TreeView(p: TreeViewProps) {
  const phone = p.layout === "phone";
  const geo = phone ? PHONE_GEOMETRY : TREE_GEOMETRY;
  const tree = useMemo(() => (p.graph ? layoutTree(p.graph.chats, geo) : null), [p.graph, geo]);
  const selected = (p.select && tree?.lanes.find((l) => l.chatId === p.select)) || null;
  const repo = splitRepo(p.repo ?? "");

  const decisionCount = tree ? tree.lanes.reduce((n, l) => n + l.decisions.length, 0) : 0;
  const summary = tree
    ? s.tree.summary(
        plural(tree.lanes.length, forms.chats),
        plural(tree.lanes.filter((l) => l.parentId).length, forms.forks),
        plural(tree.lanes.reduce((n, l) => n + l.chat.messages.length, 0), forms.messages),
        decisionCount ? plural(decisionCount, forms.decisions) : null,
      )
    : s.loading;

  const header = (
    <Body
      as="header"
      className={cx(
        "flex shrink-0 flex-wrap items-center justify-between rounded-device plinth-10",
        phone ? "gap-x-4 gap-y-3 px-4 pt-4 pb-6" : "gap-x-[30px] gap-y-4 px-[26px] pt-[22px] pb-8 short:pt-4 short:pb-6",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-cap text-ink-2">{s.tree.caption(repo?.owner ?? "")}</span>
        <h1
          className={cx(
            "m-0 font-semibold [overflow-wrap:anywhere]",
            phone ? "text-section" : "text-[24px] leading-[1.15] tracking-[-0.03em] desk:text-title",
          )}
        >
          {repo?.name ?? s.tree.label}
        </h1>
        <span className="text-cap text-ink-2" aria-live="polite">
          {summary}
        </span>
      </div>
      <div className="flex items-center gap-[22px]">
        <Grille width={70} height={34} className="hidden desk:block" />
        <div role="group" aria-label={s.tree.modes} className={cx("flex", phone ? "gap-2" : "gap-[18px]")}>
          <Knob label={s.tree.chat} onClick={p.onChatMode} />
          <Knob label={s.tree.tree} current />
          <Knob label={s.tree.timeline} disabled title={s.tree.soon} />
          <Knob label={s.tree.decisions} disabled title={s.tree.soon} />
        </div>
      </div>
    </Body>
  );

  let body: ReactNode;
  if (p.error && !tree) {
    body = (
      <Plate className="flex flex-col items-start gap-2.5 px-6 pt-[22px] pb-7" role="alert">
        <h2 className="m-0 text-copy font-semibold">{s.tree.loadError}</h2>
        <p className="m-0 text-cap text-ink-2">{p.error}</p>
        <Key onClick={p.onRetry}>{s.retry}</Key>
      </Plate>
    );
  } else if (!tree) {
    body = (
      <Plate className="px-6 py-6">
        <p className="m-0 text-cap text-ink-2">{s.loading}</p>
      </Plate>
    );
  } else if (tree.lanes.length === 0) {
    body = (
      <Plate className="flex flex-col items-start gap-2.5 px-6 pt-[22px] pb-7">
        <h2 className="m-0 text-copy font-semibold">{s.tree.empty.title}</h2>
        <p className="m-0 max-w-[52ch] text-cap leading-[1.45] text-ink-2">{s.tree.empty.text}</p>
        {p.canCreate ? <Key onClick={p.onNew}>{s.empty.create}</Key> : null}
      </Plate>
    );
  } else {
    body = (
      <TreePlate
        tree={tree}
        repo={p.repo ?? ""}
        selected={selected}
        onSelect={p.onSelect}
        now={p.now}
        phone={phone}
      />
    );
  }

  const panel =
    tree && selected ? (
      <LanePanel
        lane={selected}
        tree={tree}
        repo={p.repo ?? ""}
        now={p.now}
        canPush={p.canPush}
        onSelect={p.onSelect}
        onFork={p.onFork}
        onClose={p.layout === "desktop" ? null : () => p.onSelect(null)}
      />
    ) : null;

  return (
    <>
      <div className={cx("flex h-full min-h-0 flex-col", phone ? "gap-3.5 px-3.5 pt-3.5 pb-3" : "gap-[22px] short:gap-4")}>
        {header}
        <div className="flex min-h-0 flex-1 gap-[22px]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
          {p.layout === "desktop" && tree && tree.lanes.length > 0 ? (
            <aside aria-label={s.tree.selected} className="box-border w-[300px] shrink-0 overflow-y-auto pb-4">
              {panel ?? <Legend />}
            </aside>
          ) : null}
        </div>
      </div>
      {p.layout !== "desktop" ? (
        <Sheet
          open={!!panel}
          onClose={() => p.onSelect(null)}
          label={selected?.chat.title ?? s.tree.selected}
          dismissOnBackdrop
          className={
            phone
              ? "mx-0 mt-auto mb-0 max-h-[86dvh] w-full max-w-none overflow-y-auto"
              : "mr-0 ml-auto h-dvh max-h-dvh w-[min(360px,100vw)]"
          }
        >
          <div className={cx("box-border bg-ground", phone ? "rounded-t-device px-3.5 pt-3.5 pb-[max(20px,env(safe-area-inset-bottom))]" : "h-full overflow-y-auto px-[22px] pt-5 pb-8")}>
            {panel}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

// --- Плита с деревом -----------------------------------------------------------

const GUTTER = { desk: 66, phone: 50 };
const HEAD = 84;

const when = (iso: string, now: number) => (dayKey(iso) === dayKey(now) ? clock(iso) : dateTimeShort(iso));
const shortDay = (iso: string) =>
  new Intl.DateTimeFormat(s.locale, { day: "numeric", month: "short" }).format(new Date(iso)).replace(/\.$/, "");

function nodeRole(n: TreeNode): "start" | "fork" | "head" | null {
  return n.kind === "dot" || n.kind === "decision" ? null : n.kind;
}

const decisionStatus = (n: TreeNode) => (n.decision ? s.decision.status[n.decision.status] : "");

/** Провод предложения из Fork: пунктир оранжевый — ждёт, чёрный — принято, бледный — нет. */
function ProposalWire({ e }: { e: TreeEdge }) {
  const st = e.status ?? "proposed";
  const waiting = awaitsHuman(st);
  const accepted = st === "accepted";
  return (
    <g opacity={waiting || accepted ? undefined : 0.55}>
      <path d={e.d} className="fill-none stroke-plate" strokeWidth={7} strokeLinecap="round" />
      <path
        d={e.d}
        className={cx("fill-none", waiting ? "stroke-lamp" : accepted ? "stroke-ink" : "stroke-ink-3")}
        strokeWidth={waiting || accepted ? 2 : 1.5}
        strokeDasharray={waiting ? "6 4" : undefined}
        strokeLinecap={waiting ? "butt" : "round"}
      />
    </g>
  );
}

function TreePlate({
  tree,
  repo,
  selected,
  onSelect,
  now,
  phone,
}: {
  tree: TreeLayout;
  repo: string;
  selected: TreeLane | null;
  onSelect: (id: string | null) => void;
  now: number;
  phone: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TreeNode | null>(null);
  const gutter = phone ? GUTTER.phone : GUTTER.desk;
  const { geometry: geo } = tree;
  const laneById = useMemo(() => new Map(tree.lanes.map((l) => [l.chatId, l] as const)), [tree]);
  const nodesByLane = useMemo(() => {
    const m = new Map<string, TreeNode[]>();
    for (const n of tree.nodes) {
      const list = m.get(n.chatId) ?? [];
      list.push(n);
      m.set(n.chatId, list);
    }
    return m;
  }, [tree]);
  // Разделители дней: строка, с которой начинается новый календарный день.
  const dayStarts = useMemo(() => {
    const set = new Set<number>();
    let prev = "";
    for (const n of tree.nodes) {
      const k = dayKey(n.at);
      if (k !== prev && prev) set.add(n.row);
      prev = k;
    }
    return set;
  }, [tree]);

  // Пришли с выбранной веткой (?chat=) — показать её начало. Только при
  // появлении плиты: щелчок по заголовку ветки прокрутку не трогает.
  const arrived = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || arrived.current) return;
    arrived.current = true;
    if (!selected) return;
    const start = tree.nodes.find((n) => n.key === selected.startKey);
    if (!start) return;
    el.scrollLeft = Math.max(0, gutter + start.x - el.clientWidth / 2);
    el.scrollTop = Math.max(0, start.y - el.clientHeight / 3);
  }, [selected, tree, gutter]);

  const closed = (chatId: string) => laneById.get(chatId)?.chat.state === "closed";
  const W = tree.width;
  const H = tree.height;
  const headerW = geo.laneW - 14;

  return (
    <section
      aria-label={s.tree.label}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-plate bg-plate plinth-6"
    >
      <div ref={scroller} className="mb-1.5 min-h-0 flex-1 overflow-auto overscroll-contain">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${gutter}px ${W + 16}px`,
            gridTemplateRows: `${HEAD}px ${H}px`,
            width: gutter + W + 16,
            minWidth: "100%",
          }}
        >
          {/* Угол над шкалой времени: стоит на месте при прокрутке в обе стороны. */}
          <div className="sticky top-0 left-0 z-30 bg-plate" />

          {/* Заголовки веток — липкие сверху. */}
          <div className="sticky top-0 z-20 border-0 border-b border-solid border-line bg-plate">
            {tree.lanes.map((l) => {
              const isSel = selected?.chatId === l.chatId;
              const live = l.chat.state === "open" && isFresh(l.chat.updated_at, now);
              return (
                <button
                  key={l.chatId}
                  type="button"
                  aria-pressed={isSel}
                  aria-label={s.tree.laneLabel(l.chat.title)}
                  title={l.chat.title}
                  onClick={() => onSelect(isSel ? null : l.chatId)}
                  className={cx(
                    "absolute top-[11px] box-border flex flex-col items-start gap-[3px] rounded-row border-0 px-2.5 pt-[7px] pb-[11px] text-left text-ink",
                    isSel ? "pressed pb-[9px]" : "bg-body plinth-row active:translate-y-px",
                    l.chat.state === "closed" && "opacity-55",
                  )}
                  style={{ left: l.x - headerW / 2, width: headerW }}
                >
                  <span className="flex w-full min-w-0 items-start gap-1.5">
                    <Lamp state={live ? "live" : "off"} size={6} ring={false} className="mt-[5px]" />
                    <span className="line-clamp-2 h-[31px] text-[12.5px] leading-[1.24] font-semibold [overflow-wrap:anywhere]">
                      {l.chat.title}
                    </span>
                  </span>
                  <span className="scale pl-3 leading-none text-ink-2">
                    {s.tree.lanePr(l.chat.number)}
                    {l.depth > 0 ? ` · ${s.list.fork}` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Шкала времени слева — липкая: риски у каждого события, подписи у главных. */}
          <div className="sticky left-0 z-10 bg-plate">
            <svg width={gutter} height={H} aria-hidden="true" className="block">
              <line x1={gutter - 1} y1={0} x2={gutter - 1} y2={H} className="stroke-line" strokeWidth={1} />
              {tree.nodes.map((n) => {
                const major = n.kind !== "dot";
                const day = dayStarts.has(n.row) || n.row === 0;
                return (
                  <g key={n.key}>
                    <line
                      x1={gutter - (major ? 9 : 5)}
                      x2={gutter - 1}
                      y1={n.y}
                      y2={n.y}
                      className={major ? "stroke-ink-2" : "stroke-ink-3"}
                      strokeWidth={major ? 1.5 : 1}
                    />
                    {day ? (
                      <text x={gutter - 13} y={n.y + 3.5} textAnchor="end" className="fill-ink text-[10.5px] font-semibold uppercase">
                        {shortDay(n.at)}
                      </text>
                    ) : major ? (
                      <text x={gutter - 13} y={n.y + 3.5} textAnchor="end" className="fill-ink-2 text-[10.5px]">
                        {clock(n.at)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>

          <svg width={W + 16} height={H} role="group" aria-label={s.tree.plot} className="block overflow-visible">
            <defs>
              <filter id="tree-soft" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.8" />
              </filter>
            </defs>

            {/* Сетка: пунктир оси каждой ветки и волосок смены дня. */}
            {tree.lanes.map((l) => (
              <line key={`g:${l.chatId}`} x1={l.x} x2={l.x} y1={0} y2={H} className="stroke-line" strokeWidth={1} strokeDasharray="1 5" />
            ))}
            {tree.nodes
              .filter((n) => dayStarts.has(n.row))
              .map((n) => (
                <line key={`d:${n.key}`} x1={0} x2={W + 16} y1={n.y - geo.rowH / 2} y2={n.y - geo.rowH / 2} className="stroke-line" strokeWidth={1} />
              ))}

            {/* Выбранная ветка — утоплена, как нажатая клавиша. */}
            {selected ? (
              <rect
                x={selected.x - 9}
                y={selected.topY - 14}
                width={18}
                height={selected.endY - selected.topY + 28}
                rx={9}
                className="fill-screen stroke-line"
                strokeWidth={1}
              />
            ) : null}

            {tree.edges
              .filter((e) => e.kind === "lane")
              .map((e) => (
                <path
                  key={e.key}
                  d={e.d}
                  className="fill-none stroke-ink-3"
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={closed(e.chatId) ? 0.55 : undefined}
                />
              ))}
            {tree.edges
              .filter((e) => e.kind === "fork")
              .map((e) => (
                <g key={e.key} opacity={closed(e.chatId) ? 0.55 : undefined}>
                  {/* Подложка цвета плиты: провод Fork «перепрыгивает» чужие ветки. */}
                  <path d={e.d} className="fill-none stroke-plate" strokeWidth={7} strokeLinecap="round" />
                  <path d={e.d} className="fill-none stroke-ink" strokeWidth={2} strokeLinecap="round" />
                </g>
              ))}
            {/* Замена решения — тонкая точечная дуга от нового к старому. */}
            {tree.edges
              .filter((e) => e.kind === "supersede")
              .map((e) => (
                <path
                  key={e.key}
                  d={e.d}
                  className="fill-none stroke-ink-3"
                  strokeWidth={1.25}
                  strokeDasharray="0.5 4"
                  strokeLinecap="round"
                  opacity={closed(e.chatId) ? 0.55 : undefined}
                />
              ))}
            {tree.edges
              .filter((e) => e.kind === "proposal")
              .map((e) => (
                <ProposalWire key={e.key} e={e} />
              ))}

            {tree.lanes.map((l) => (
              <g key={`n:${l.chatId}`} role="group" aria-label={l.chat.title} opacity={l.chat.state === "closed" ? 0.55 : undefined}>
                {(nodesByLane.get(l.chatId) ?? []).map((n) => (
                  <NodeLink
                    key={n.key}
                    n={n}
                    lane={l}
                    repo={repo}
                    now={now}
                    onTip={setTip}
                  />
                ))}
              </g>
            ))}
          </svg>

          {tip ? <Tip n={tip} tree={tree} lanes={laneById} gutter={gutter} now={now} /> : null}
        </div>
      </div>
    </section>
  );
}

function NodeLink({
  n,
  lane,
  repo,
  now,
  onTip,
}: {
  n: TreeNode;
  lane: TreeLane;
  repo: string;
  now: number;
  onTip: (n: TreeNode | null) => void;
}) {
  const to = chatRoute(repo, n.chatId);
  const hash = n.decision?.id ?? n.messageId ?? undefined;
  const role = nodeRole(n);
  const who = n.author ? displayName(n.author) : s.tree.created;
  const live = lane.chat.state === "open" && isFresh(lane.chat.updated_at, now);
  const show = () => onTip(n);
  const hide = () => onTip(null);
  const label = n.decision
    ? s.tree.decisionLabel(n.decision.title, decisionStatus(n), lane.chat.title)
    : s.tree.nodeLabel(who, when(n.at, now), lane.chat.title, role ? s.tree.role[role] : null);
  return (
    <a
      href={routeHref(to, hash)}
      className="tree-node"
      aria-label={label}
      onClick={(e) => followInApp(e, to, hash ? { hash } : {})}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <g transform={`translate(${n.x} ${n.y})`}>
        <circle r={12} className="fill-transparent" />
        <circle r={n.kind === "start" ? 13 : n.kind === "dot" ? 8 : 11} className="tree-ring fill-none" strokeWidth={2} />
        {n.kind === "decision" ? (
          n.decision ? <DecisionShape status={n.decision.status} /> : null
        ) : (
          <NodeShape kind={n.kind} head={n.head} fork={n.forks.length > 0} live={live && n.head} />
        )}
      </g>
    </a>
  );
}

/** Узел прибора: ручка-начало, чёрный диск Fork, лампа-итог, точка-сообщение. */
function NodeShape({ kind, head, fork, live }: { kind: Exclude<TreeNode["kind"], "decision">; head: boolean; fork: boolean; live: boolean }) {
  if (kind === "start") {
    return (
      <>
        <circle cy={3} r={9.5} className="fill-ink" opacity={0.2} filter="url(#tree-soft)" />
        <circle cy={1.75} r={9} className="fill-base" />
        <circle r={9} className="tree-cap fill-body" strokeWidth={1} />
        <path d="M-6.2 -4.6A8 8 0 0 1 6.2 -4.6" className="tree-hi fill-none" strokeWidth={1} strokeLinecap="round" />
        {live ? (
          <circle r={3.2} className="fill-pilot" />
        ) : fork ? (
          <circle r={3.2} className="fill-ink" />
        ) : (
          <rect x={-1} y={-6.5} width={2} height={5} rx={1} className="fill-ink-2" />
        )}
      </>
    );
  }
  if (kind === "fork") {
    return (
      <>
        <circle r={7} className="fill-ink" />
        {head && live ? <circle r={3} className="fill-pilot" /> : null}
      </>
    );
  }
  if (kind === "head") {
    return live ? (
      <>
        <circle r={9} className="fill-base" />
        <circle r={7} className="fill-pilot" />
      </>
    ) : (
      <circle r={6} className="fill-plate stroke-ink" strokeWidth={2} />
    );
  }
  return <circle r={4} className="fill-plate stroke-ink-2" strokeWidth={1.5} />;
}

function Tip({
  n,
  tree,
  lanes,
  gutter,
  now,
}: {
  n: TreeNode;
  tree: TreeLayout;
  lanes: Map<string, TreeLane>;
  gutter: number;
  now: number;
}) {
  const role = nodeRole(n);
  const who = n.author ? displayName(n.author) : s.tree.created;
  const forkTitles = n.forks.map((id) => lanes.get(id)?.chat.title).filter(Boolean);
  // У правого края подсказка встаёт слева от узла.
  const flip = n.x > tree.width - 260;
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-40 flex flex-col gap-0.5 rounded-[11px] bg-screen px-2.5 pt-1.5 pb-2 whitespace-nowrap shadow-[var(--recess-screen),var(--lift-row)]"
      style={{
        left: gutter + n.x + (flip ? -16 : 16),
        top: HEAD + n.y - 15,
        transform: flip ? "translateX(-100%)" : undefined,
      }}
    >
      <span className="text-cap font-semibold">
        {n.decision ? s.tree.decisionTip(excerpt(n.decision.title, 48), decisionStatus(n)) : `${who} · ${when(n.at, now)}`}
      </span>
      {n.decision ? <span className="scale text-ink-2">{when(n.at, now)}</span> : null}
      {role ? (
        <span className="scale text-ink-2">
          {s.tree.roleTip[role]}
          {forkTitles.length ? ` → ${forkTitles.join(", ")}` : ""}
        </span>
      ) : null}
    </div>
  );
}

// --- Панель выбранной ветки и легенда --------------------------------------------

function LanePanel({
  lane,
  tree,
  repo,
  now,
  canPush,
  onSelect,
  onFork,
  onClose,
}: {
  lane: TreeLane;
  tree: TreeLayout;
  repo: string;
  now: number;
  canPush: boolean;
  onSelect: (id: string | null) => void;
  onFork: (t: ForkTarget) => void;
  onClose: (() => void) | null;
}) {
  const c = lane.chat;
  const head = tree.nodes.find((n) => n.key === lane.headKey);
  const parent = lane.parentId ? tree.lanes.find((l) => l.chatId === lane.parentId) : null;
  const children = lane.children.map((id) => tree.lanes.find((l) => l.chatId === id)!).filter(Boolean);
  const live = c.state === "open" && isFresh(c.updated_at, now);

  // Точка Fork: сообщение родителя по id; если это комментарий — хотя бы «комментарий PR».
  let forkAt: string | null = null;
  if (c.parent) {
    const exact = parent ? tree.nodes.find((n) => n.chatId === parent.chatId && n.messageId === c.parent!.message_id) : undefined;
    const parsed = parseMessageId(c.parent.message_id);
    if (exact?.author) forkAt = `${displayName(exact.author)} · ${when(exact.at, now)}`;
    else if (parsed) forkAt = `${displayName(parsed.author)} · ${when(parsed.date, now)}`;
    else forkAt = s.timeline.comment;
  }

  const forkHead = () => {
    if (!head?.messageId || !head.author) return;
    onFork({
      repo,
      chatId: c.chat_id,
      chatTitle: c.title,
      canPush,
      message: { id: head.messageId, display: displayName(head.author), created_at: head.at, text: null },
    });
  };
  const open = chatRoute(repo, c.chat_id);
  const openHash = head?.messageId ?? undefined;

  return (
    <Plate className="flex flex-col gap-[18px] px-6 pt-[22px] pb-7">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-center gap-2 text-cap text-ink-2">
            <Lamp state={live ? "live" : "off"} size={8} />
            {s.tree.selected}
          </span>
          <h2 className="m-0 text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{c.title}</h2>
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label={s.tree.close}
            onClick={onClose}
            className="flex size-[34px] shrink-0 items-center justify-center rounded-full border-0 bg-body text-[18px] text-ink plinth-knob active:translate-y-px"
          >
            ×
          </button>
        ) : null}
      </div>

      <Screen className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5">
        <Readout small label={s.tree.pr} value={s.header.prValue(c.number, c.draft, c.state === "closed")} />
        <Readout small label={s.tree.messages} value={String(c.messages.length)} />
        <div className="col-span-2">
          <Readout small label={s.tree.branch} value={c.branch} />
        </div>
        {forkAt ? (
          <div className="col-span-2">
            <Readout small label={s.tree.forkPoint} value={forkAt} />
          </div>
        ) : null}
      </Screen>

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2 text-cap">
        {c.parent ? (
          <>
            <dt className="text-ink-2">{s.tree.parent}</dt>
            <dd className="m-0 [overflow-wrap:anywhere]">
              {parent ? (
                <button
                  type="button"
                  onClick={() => onSelect(parent.chatId)}
                  className="border-0 bg-transparent p-0 text-left text-cap font-semibold text-ink underline decoration-ink-3 underline-offset-2 hover:text-action-ink"
                >
                  {parent.chat.title}
                </button>
              ) : (
                <span className="text-ink-2">{s.tree.orphan}</span>
              )}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-2">{s.tree.createdBy}</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">
          {c.created_by}, {dateTimeShort(c.created_at)}
        </dd>
        <dt className="text-ink-2">{s.tree.updated}</dt>
        <dd className="m-0">{ago(c.updated_at, now)}</dd>
        {children.length > 0 ? (
          <>
            <dt className="text-ink-2">{s.tree.forks}</dt>
            <dd className="m-0 flex flex-col items-start gap-1">
              {children.map((k) => (
                <button
                  key={k.chatId}
                  type="button"
                  onClick={() => onSelect(k.chatId)}
                  className="border-0 bg-transparent p-0 text-left text-cap font-semibold text-ink underline decoration-ink-3 underline-offset-2 hover:text-action-ink"
                >
                  ↳ {k.chat.title}
                </button>
              ))}
            </dd>
          </>
        ) : null}
      </dl>

      {lane.decisions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="scale text-ink-2">{s.tree.decisions}</span>
          <ul className="-mx-3 m-0 flex list-none flex-col p-0">
            {lane.decisions
              .map((k) => tree.nodes.find((n) => n.key === k)?.decision)
              .filter((d): d is NonNullable<typeof d> => !!d)
              .reverse()
              .map((d) => (
                <li key={d.id}>
                  <a
                    href={routeHref(open, d.id)}
                    onClick={(e) => followInApp(e, open, { hash: d.id })}
                    className="flex min-w-0 flex-col gap-0.5 rounded-row px-3 pt-2 pb-2.5 text-ink no-underline hover:bg-screen hover:text-ink"
                  >
                    <span className="flex items-start gap-2.5">
                      <svg width={14} height={14} viewBox="-8 -8 16 16" aria-hidden="true" className="mt-[3px] shrink-0 overflow-visible">
                        <DecisionShape status={d.status} />
                      </svg>
                      <span className="min-w-0 text-key leading-snug font-semibold [overflow-wrap:anywhere]">{d.title}</span>
                    </span>
                    <span className={cx("pl-6 text-cap", awaitsHuman(d.status) ? "text-action-ink" : "text-ink-2")}>
                      {s.decision.status[d.status]}
                      {d.from_chat ? ` · ${s.decision.fromFork}` : ""}
                    </span>
                  </a>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {c.parent ? <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.tree.contextNote}</p> : null}

      <div className="flex flex-wrap gap-3">
        <ActionKeyLink href={routeHref(open, openHash)} onClick={(e) => followInApp(e, open, openHash ? { hash: openHash } : {})}>
          {s.tree.open}
        </ActionKeyLink>
        <Key onClick={forkHead} disabled={!head?.messageId} title={head?.messageId ? undefined : s.tree.forkHeadNone}>
          {s.tree.forkHead}
        </Key>
      </div>
    </Plate>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width={28} height={28} viewBox="-14 -14 28 28" aria-hidden="true" className="shrink-0 overflow-visible">
      {children}
    </svg>
  );
}

/** Легенда — напечатанная на корпусе подсказка, пока ветка не выбрана. */
function Legend() {
  const rows: Array<[ReactNode, string]> = [
    [<NodeShape kind="start" head={false} fork={false} live={false} />, s.tree.legendStart],
    [<NodeShape kind="fork" head={false} fork live={false} />, s.tree.legendFork],
    [<NodeShape kind="head" head fork={false} live />, s.tree.legendHead],
    [<NodeShape kind="dot" head={false} fork={false} live={false} />, s.tree.legendDot],
    [
      <g opacity={0.55}>
        <line x1={0} x2={0} y1={-11} y2={11} className="stroke-ink-3" strokeWidth={2} strokeLinecap="round" />
        <circle r={4} className="fill-plate stroke-ink-2" strokeWidth={1.5} />
      </g>,
      s.tree.legendClosed,
    ],
    [<DecisionShape status="accepted" />, s.tree.legendAccepted],
    [<DecisionShape status="proposed" />, s.tree.legendAwaiting],
    [<DecisionShape status="rejected" />, s.tree.legendRejected],
    [
      <path d="M12 -9V-2C12 4 6 7 -12 7" className="fill-none stroke-lamp" strokeWidth={2} strokeDasharray="5 3.5" />,
      s.tree.legendProposal,
    ],
  ];
  return (
    <Plate className="flex flex-col gap-4 px-6 pt-[22px] pb-7">
      <div className="flex items-center justify-between gap-2.5">
        <h2 className="m-0 text-section font-semibold tracking-[-0.01em]">{s.tree.legend}</h2>
        <Grille width={46} height={16} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rows.map(([glyph, label]) => (
          <li key={label} className="flex items-center gap-3 text-cap leading-[1.35]">
            <Glyph>{glyph}</Glyph>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.tree.legendHint}</p>
    </Plate>
  );
}
