import type { AppConfig, ChatActivation, ChatSummary, Decision, GraphResponse, Me, MessageItem, RepoInfo, TimelineResponse } from "@chat0110/chat-protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiFailure, errorText } from "../api.ts";
import { navigate, storageGet, storageSet, useLayout, useNow, useRoute } from "../hooks.ts";
import { eventMatchesChat, type OpenChatRef } from "../lib/chat.ts";
import type { DecisionVerb } from "../lib/decision.ts";
import { routePath, splitRepo } from "../lib/route.ts";
import type { LocalEntry } from "../lib/timeline.ts";
import { s } from "../strings.ts";
import { ActionKey, cx, RoundKey } from "../ui/kit.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { Toast } from "../ui/Toast.tsx";
import { ChatList } from "./ChatList.tsx";
import { ChatView, MainPlaceholder } from "./ChatView.tsx";
import { DecisionDialog, type DecisionTarget } from "./DecisionDialog.tsx";
import { ForkDialog, type ForkTarget } from "./ForkDialog.tsx";
import { InfoColumn } from "./InfoColumn.tsx";
import { NewChatDialog } from "./NewChatDialog.tsx";
import { ProposeDialog, type ProposeTarget } from "./ProposeDialog.tsx";
import { Rail } from "./Rail.tsx";
import { TreeView } from "./TreeView.tsx";

const LAST_REPO = "chat0110.lastRepo";
const POLL_MS = 60_000;
const DEBOUNCE_MS = 300;

interface TimelineState {
  key: string | null;
  data: TimelineResponse | null;
  error: ApiFailure | null;
  syncedAt: number | null;
}
const NO_TIMELINE: TimelineState = { key: null, data: null, error: null, syncedAt: null };

interface GraphState {
  repo: string | null;
  data: GraphResponse | null;
  error: string | null;
}
const NO_GRAPH: GraphState = { repo: null, data: null, error: null };

function asFailure(e: unknown): ApiFailure {
  return e instanceof ApiFailure ? e : new ApiFailure(0, "network", errorText(e));
}

function newLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Shell({ me, config, onLogout }: { me: Me; config: AppConfig | null; onLogout: () => void }) {
  const route = useRoute();
  const layout = useLayout();
  const now = useNow();
  const phone = layout === "phone";

  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [activation, setActivation] = useState<ChatActivation | null>(null);
  const [activating, setActivating] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [tl, setTl] = useState<TimelineState>(NO_TIMELINE);
  const [outbox, setOutbox] = useState<Record<string, LocalEntry[]>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [reply, setReply] = useState<MessageItem | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [graph, setGraph] = useState<GraphState>(NO_GRAPH);
  const [forkTarget, setForkTarget] = useState<ForkTarget | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<DecisionTarget | null>(null);
  const [proposeTarget, setProposeTarget] = useState<ProposeTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);

  // --- Репозиторий: из адреса, иначе последний выбранный, иначе первый ----------
  const repoFull = useMemo(() => {
    if (!route.owner || !route.repo) return null;
    const wanted = `${route.owner}/${route.repo}`.toLowerCase();
    return repos?.find((r) => r.full_name.toLowerCase() === wanted)?.full_name ?? `${route.owner}/${route.repo}`;
  }, [route.owner, route.repo, repos]);
  const repoInfo = repos?.find((r) => r.full_name === repoFull) ?? null;
  const chatKey = repoFull && route.chatId ? `${repoFull.toLowerCase()}/${route.chatId}` : null;

  const loadRepos = useCallback(async () => {
    setReposError(null);
    try {
      setRepos(await api().repos());
    } catch (e) {
      setReposError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  useEffect(() => {
    if (repoFull || !repos || repos.length === 0) return;
    const last = storageGet(LAST_REPO)?.toLowerCase();
    const pick = repos.find((r) => r.full_name.toLowerCase() === last) ?? repos[0]!;
    navigate({ owner: pick.owner, repo: pick.name, chatId: null }, { replace: true });
  }, [repoFull, repos]);

  useEffect(() => {
    if (repoInfo) storageSet(LAST_REPO, repoInfo.full_name);
  }, [repoInfo]);

  // --- Список чатов ---------------------------------------------------------------
  const chatsSeq = useRef(0);
  const loadChats = useCallback(async () => {
    if (!repoFull) return;
    const seq = ++chatsSeq.current;
    try {
      const list = await api().chats(repoFull);
      if (seq !== chatsSeq.current) return;
      setChats(list);
      setChatsError(null);
    } catch (e) {
      if (seq !== chatsSeq.current) return;
      setChatsError(errorText(e));
    }
  }, [repoFull]);
  useEffect(() => {
    setChats(null);
    setChatsError(null);
    void loadChats();
  }, [loadChats]);

  // --- Лента открытого чата ----------------------------------------------------------
  const tlSeq = useRef(0);
  const loadTimeline = useCallback(async () => {
    if (!repoFull || !route.chatId || !chatKey) return;
    const seq = ++tlSeq.current;
    try {
      const data = await api().timeline(repoFull, route.chatId);
      if (seq !== tlSeq.current) return;
      setTl({ key: chatKey, data, error: null, syncedAt: Date.now() });
    } catch (e) {
      if (seq !== tlSeq.current) return;
      setTl((t) => (t.key === chatKey ? { ...t, error: asFailure(e) } : { ...NO_TIMELINE, key: chatKey, error: asFailure(e) }));
    }
  }, [repoFull, route.chatId, chatKey]);
  useEffect(() => {
    setReply(null);
    setInfoOpen(false);
    if (chatKey) void loadTimeline();
  }, [chatKey, loadTimeline]);

  const current = tl.key === chatKey ? tl : NO_TIMELINE;

  // --- Дерево: GET /api/graph, только пока открыт экран «Дерево» -----------------
  const treeOpen = !!route.tree && !!repoFull;
  const graphSeq = useRef(0);
  const loadGraph = useCallback(async () => {
    if (!repoFull || !route.tree) return;
    const seq = ++graphSeq.current;
    try {
      const data = await api().graph(repoFull);
      if (seq !== graphSeq.current) return;
      setGraph({ repo: repoFull, data, error: null });
    } catch (e) {
      if (seq !== graphSeq.current) return;
      setGraph((g) => (g.repo === repoFull ? { ...g, error: errorText(e) } : { repo: repoFull, data: null, error: errorText(e) }));
    }
  }, [repoFull, route.tree]);
  useEffect(() => {
    if (treeOpen) void loadGraph();
  }, [treeOpen, loadGraph]);
  const currentGraph = graph.repo === repoFull ? graph : NO_GRAPH;

  // --- Живые обновления: SSE будит, мы перечитываем; плюс опрос раз в минуту ---------
  const latest = useRef({ loadChats, loadTimeline, loadGraph, tree: false, open: null as OpenChatRef | null });
  latest.current.loadChats = loadChats;
  latest.current.loadTimeline = loadTimeline;
  latest.current.loadGraph = loadGraph;
  latest.current.tree = treeOpen;
  latest.current.open =
    repoFull && route.chatId
      ? { repo: repoFull, chat_id: route.chatId, number: current.data?.chat.number ?? -1 }
      : null;

  useEffect(() => {
    if (!repoFull) return;
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    let chatTimer: ReturnType<typeof setTimeout> | undefined;
    // Пуши в ветки чатов тоже будят repo.updated — пачку событий склеиваем в один запрос.
    const bumpList = () => {
      clearTimeout(listTimer);
      listTimer = setTimeout(() => {
        void latest.current.loadChats();
        if (latest.current.tree) void latest.current.loadGraph();
      }, DEBOUNCE_MS);
    };
    const off = api().subscribe(repoFull, {
      onRepo: bumpList,
      onChat: (ev) => {
        bumpList();
        const open = latest.current.open;
        if (open && eventMatchesChat(ev, open)) {
          clearTimeout(chatTimer);
          chatTimer = setTimeout(() => void latest.current.loadTimeline(), DEBOUNCE_MS);
        }
      },
    });
    return () => {
      off();
      clearTimeout(listTimer);
      clearTimeout(chatTimer);
    };
  }, [repoFull]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void latest.current.loadChats();
      void latest.current.loadTimeline();
      if (latest.current.tree) void latest.current.loadGraph();
    };
    const id = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // --- Отправка: сразу в ленту, потом коммит; ошибка не теряет текст ------------------
  const patchEntry = useCallback((key: string, localId: string, patch: Partial<LocalEntry>) => {
    setOutbox((box) => ({
      ...box,
      [key]: (box[key] ?? []).map((e) => (e.localId === localId ? { ...e, ...patch } : e)),
    }));
  }, []);

  const post = useCallback(
    async (key: string, repo: string, chatId: string, entry: LocalEntry) => {
      try {
        const req = entry.reply_to ? { text: entry.text, reply_to: entry.reply_to } : { text: entry.text };
        const { item } = await api().postMessage(repo, chatId, req);
        patchEntry(key, entry.localId, { status: "published", item, error: undefined });
        if (latest.current.open?.chat_id === chatId) void latest.current.loadTimeline();
      } catch (e) {
        patchEntry(key, entry.localId, { status: "error", error: errorText(e) });
      }
    },
    [patchEntry],
  );

  const send = (text: string, replyTo?: string) => {
    if (!repoFull || !route.chatId || !chatKey) return;
    const entry: LocalEntry = {
      localId: newLocalId(),
      text,
      created_at: new Date().toISOString(),
      status: "sending",
      ...(replyTo ? { reply_to: replyTo } : {}),
    };
    setOutbox((box) => ({ ...box, [chatKey]: [...(box[chatKey] ?? []), entry] }));
    void post(chatKey, repoFull, route.chatId, entry);
  };

  const retry = (localId: string) => {
    if (!repoFull || !route.chatId || !chatKey) return;
    const entry = outbox[chatKey]?.find((e) => e.localId === localId);
    if (!entry) return;
    patchEntry(chatKey, localId, { status: "sending", error: undefined });
    void post(chatKey, repoFull, route.chatId, { ...entry, status: "sending" });
  };

  const accept = async (n: number) => {
    if (!repoFull || !route.chatId) return;
    await api().acceptAgentPr(repoFull, route.chatId, n);
    await loadTimeline();
    void loadChats();
  };

  // --- Переходы ---------------------------------------------------------------------
  const openChat = (c: ChatSummary) => {
    const r = splitRepo(c.repo);
    if (r) navigate({ owner: r.owner, repo: r.name, chatId: c.chat_id });
  };
  const pickRepo = (full: string) => {
    const r = splitRepo(full);
    if (!r) return;
    storageSet(LAST_REPO, full);
    navigate({ owner: r.owner, repo: r.name, chatId: null });
  };
  const toList = () => navigate({ owner: route.owner, repo: route.repo, chatId: null });
  const onCreated = (c: ChatSummary) => {
    setNewOpen(false);
    void loadChats();
    openChat(c);
  };
  const onReply = (m: MessageItem) => {
    setReply(m);
    setFocusTick((t) => t + 1);
  };
  const toTree = () =>
    navigate({ owner: route.owner, repo: route.repo, chatId: null, tree: true, select: route.chatId ?? route.select ?? null });
  const selectInTree = (chatId: string | null) =>
    navigate({ owner: route.owner, repo: route.repo, chatId: null, tree: true, select: chatId }, { replace: true });
  const treeChatMode = () => navigate({ owner: route.owner, repo: route.repo, chatId: route.select ?? null });
  const forkFromMessage = (m: MessageItem) => {
    const chat = current.data?.chat;
    if (!chat) return;
    setForkTarget({
      repo: chat.repo,
      chatId: chat.chat_id,
      chatTitle: chat.title,
      canPush: chat.can_push,
      message: { id: m.id, display: m.display, created_at: m.created_at, text: m.text },
    });
  };
  // --- Решения ------------------------------------------------------------------------
  const decide = (m: MessageItem) => {
    const data = current.data;
    if (!data) return;
    setDecisionTarget({
      repo: data.chat.repo,
      chatId: data.chat.chat_id,
      canPush: data.chat.can_push,
      message: m,
      items: data.items,
      decisions: data.decisions ?? [],
    });
  };
  const onDecided = async (d: Decision) => {
    setDecisionTarget(null);
    await loadTimeline();
    // Лента подсветит новую карточку, когда она появится.
    navigate({ owner: route.owner, repo: route.repo, chatId: route.chatId }, { replace: true, hash: d.id });
  };
  const onDecision = async (d: Decision, verb: DecisionVerb, text?: string) => {
    if (!repoFull || !route.chatId) return;
    await api().decisionAction(repoFull, route.chatId, d.id, verb, text ? { text } : undefined);
    await loadTimeline();
  };
  const openPropose = () => {
    const data = current.data;
    if (!data?.chat.parent) return;
    setInfoOpen(false);
    setProposeTarget({
      chat: data.chat,
      items: data.items,
      decisions: data.decisions ?? [],
      parentTitle: parentTitle ?? data.chat.parent.chat_id,
    });
  };
  const onProposed = (_d: Decision) => {
    const to = proposeTarget?.parentTitle ?? "";
    setProposeTarget(null);
    setToast(s.decision.propose.sent(to));
    void loadTimeline();
    void loadChats();
  };

  const onForked = (c: ChatSummary) => {
    setForkTarget(null);
    void loadChats();
    if (treeOpen) void loadGraph();
    openChat(c);
  };

  useEffect(() => {
    if (!repoFull) return;
    let cancel = false;
    setActivation(null);
    void api()
      .activation(repoFull)
      .then((next) => {
        if (!cancel) setActivation(next);
      })
      .catch(() => {
        if (!cancel) setActivation(null);
      });
    return () => {
      cancel = true;
    };
  }, [repoFull]);

  const connectRepo = useCallback(async () => {
    if (!repoFull) return;
    setActivating(true);
    try {
      setActivation(await api().activate(repoFull));
      setToast(s.connect.done);
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setActivating(false);
    }
  }, [repoFull]);

  const mustConnect = !!activation && !activation.activated && !activation.legacy_chats && !activation.protocol_invalid;
  const startChat = useCallback(() => {
    if (mustConnect) {
      setToast(s.connect.needFirst);
      return;
    }
    setNewOpen(true);
  }, [mustConnect]);

  const canCreate = !!repos?.some((r) => r.can_push) && !mustConnect;
  const installUrl = config?.install_url ?? null;
  const meRef = useMemo(() => ({ login: me.login.toLowerCase(), display: me.login.toLowerCase() }), [me.login]);
  const local = (chatKey && outbox[chatKey]) || [];
  const path = routePath(route);

  // --- Сборка экрана ------------------------------------------------------------------
  const list = (
    <ChatList
      repos={repos}
      repo={repoFull}
      onRepo={pickRepo}
      chats={chats}
      chatsError={chatsError ?? reposError}
      onRetry={() => void (reposError ? loadRepos() : loadChats())}
      selected={route.chatId}
      onOpen={openChat}
      onNew={startChat}
      activation={activation}
      activating={activating}
      onActivate={() => void connectRepo()}
      installUrl={installUrl}
      now={now}
      phone={phone}
    />
  );

  const summary = chats?.find((c) => c.chat_id === route.chatId) ?? null;
  const parentId = current.data?.chat.parent?.chat_id;
  const parentTitle = parentId
    ? (current.data?.inherited?.title ?? chats?.find((c) => c.chat_id === parentId)?.title ?? null)
    : null;
  let main: ReactNode;
  if (current.data) {
    main = (
      <ChatView
        data={current.data}
        sync={current}
        local={local}
        me={meRef}
        now={now}
        phone={phone}
        infoKnob={layout === "tablet"}
        infoOpen={infoOpen}
        onInfo={() => setInfoOpen((o) => !o)}
        onBack={toList}
        path={path}
        reply={reply}
        focusTick={focusTick}
        onReply={onReply}
        onClearReply={() => setReply(null)}
        onSend={send}
        onRetry={retry}
        onAccept={accept}
        parentTitle={parentTitle}
        onFork={forkFromMessage}
        onDecide={decide}
        onDecision={onDecision}
        onPropose={current.data.chat_store === 2 || !current.data.chat.parent ? null : openPropose}
      />
    );
  } else if (route.chatId && current.error && current.error.code !== "network" && current.error.code !== "rate_limited") {
    main = (
      <MainPlaceholder
        phone={phone}
        onBack={phone ? toList : undefined}
        title={s.empty.notFound}
        text={`${current.error.message} ${s.empty.notFoundText}`}
      />
    );
  } else if (route.chatId) {
    main = (
      <MainPlaceholder
        phone={phone}
        onBack={phone ? toList : undefined}
        title={summary?.title ?? s.loading}
        text={current.error ? errorText(current.error) : s.loading}
      />
    );
  } else {
    main = (
      <MainPlaceholder
        phone={phone}
        title={repos && repos.length === 0 ? s.list.noRepos.title : s.empty.pick}
        text={repos && repos.length === 0 ? s.list.noRepos.text : s.empty.pickText}
        action={
          canCreate ? (
            <ActionKey onClick={startChat}>{s.empty.create}</ActionKey>
          ) : null
        }
      />
    );
  }

  const info = current.data ? (
    <InfoColumn
      chat={current.data.chat}
      items={current.data.items}
      now={now}
      forks={current.data.forks}
      inherited={current.data.inherited}
      parentTitle={parentTitle}
      decisions={current.data.decisions ?? []}
      outgoing={current.data.outgoing ?? []}
      onJump={() => setInfoOpen(false)}
      onPropose={current.data.chat_store === 2 || !current.data.chat.parent ? null : openPropose}
    />
  ) : null;

  const dialog = repos ? (
    <NewChatDialog
      open={newOpen}
      onClose={() => setNewOpen(false)}
      repos={repos}
      repo={repoFull}
      installUrl={installUrl}
      onCreated={onCreated}
    />
  ) : null;

  const forkDialog = (
    <>
      <ForkDialog target={forkTarget} onClose={() => setForkTarget(null)} onCreated={onForked} />
      <DecisionDialog target={decisionTarget} now={now} onClose={() => setDecisionTarget(null)} onCreated={(d) => void onDecided(d)} />
      <ProposeDialog target={proposeTarget} now={now} onClose={() => setProposeTarget(null)} onSent={onProposed} />
      <Toast text={toast} onClose={hideToast} />
    </>
  );

  const rail = (bottom: boolean) => (
    <Rail
      view={route.tree ? "tree" : "chats"}
      onChats={toList}
      onTree={toTree}
      onNew={startChat}
      onLogout={onLogout}
      canCreate={canCreate}
      bottom={bottom}
    />
  );

  if (route.tree) {
    const tree = (
      <TreeView
        repo={repoFull}
        graph={currentGraph.data}
        error={currentGraph.error}
        onRetry={() => void loadGraph()}
        select={route.select ?? null}
        onSelect={selectInTree}
        onChatMode={treeChatMode}
        onFork={setForkTarget}
        onNew={startChat}
        canPush={!!repoInfo?.can_push}
        canCreate={canCreate}
        now={now}
        layout={layout}
      />
    );
    return (
      <>
        {phone ? (
          <div className="flex h-dvh flex-col bg-ground">
            <main className="min-h-0 flex-1">{tree}</main>
            {rail(true)}
          </div>
        ) : (
          <div className="grid h-dvh grid-cols-[104px_minmax(0,1fr)] bg-ground text-ink">
            {rail(false)}
            <main className="box-border flex h-dvh min-w-0 flex-col px-4 py-5 desk:px-[26px] desk:py-[30px] desk:short:py-5">
              {tree}
            </main>
          </div>
        )}
        {dialog}
        {forkDialog}
      </>
    );
  }

  if (phone) {
    let screen: ReactNode;
    if (!route.chatId) {
      screen = (
        <div className="flex h-dvh flex-col bg-ground">
          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
          {rail(true)}
        </div>
      );
    } else if (infoOpen && info) {
      screen = (
        <div className="flex h-dvh flex-col bg-ground">
          <div className="flex shrink-0 items-center gap-2.5 px-3.5 pt-3.5 pb-2">
            <RoundKey glyph="‹" aria-label={s.info.closeInfo} onClick={() => setInfoOpen(false)} />
            <h1 className="m-0 min-w-0 truncate text-section font-semibold">{s.info.label}</h1>
          </div>
          <aside aria-label={s.info.label} className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-8">
            {info}
          </aside>
        </div>
      );
    } else {
      screen = <main className="h-dvh">{main}</main>;
    }
    return (
      <>
        {screen}
        {dialog}
        {forkDialog}
      </>
    );
  }

  return (
    <>
      <div
        className={cx(
          "grid h-dvh bg-ground text-ink",
          layout === "desktop"
            ? "grid-cols-[104px_280px_minmax(0,1fr)_300px]"
            : "grid-cols-[104px_minmax(240px,280px)_minmax(0,1fr)]",
        )}
      >
        {rail(false)}
        {list}
        <main
          className={cx(
            "flex h-dvh min-w-0 flex-col gap-4 py-5 pl-2 short:gap-4 short:py-5 desk:gap-[22px] desk:py-[30px] desk:short:gap-4 desk:short:py-5",
            layout === "desktop" ? "pr-2" : "pr-4",
          )}
        >
          {main}
        </main>
        {layout === "desktop" ? (
          <aside aria-label={s.info.label} className="box-border h-dvh min-w-0 overflow-y-auto px-[22px] py-[30px]">
            {info}
          </aside>
        ) : null}
      </div>
      {layout === "tablet" ? (
        <Sheet
          open={infoOpen && !!info}
          onClose={() => setInfoOpen(false)}
          label={s.info.label}
          dismissOnBackdrop
          className="mr-0 ml-auto h-dvh max-h-dvh w-[min(340px,100vw)]"
        >
          <aside className="box-border h-full overflow-y-auto bg-ground px-[22px] pt-5 pb-8">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="m-0 text-section font-semibold">{s.info.label}</h2>
              <RoundKey glyph="×" aria-label={s.info.closeInfo} onClick={() => setInfoOpen(false)} />
            </div>
            {info}
          </aside>
        </Sheet>
      ) : null}
      {dialog}
      {forkDialog}
    </>
  );
}
