import type { ChatActivation, ChatMigration, ChatSummary, RepoInfo } from "@chat0110/chat-protocol";
import { useMemo, useState, type ReactNode } from "react";
import { arrangeChatTree, type ChatTreeNode } from "../lib/chat.ts";
import { agoShort, isFresh } from "../lib/time.ts";
import { s } from "../strings.ts";
import { routeHref } from "../hooks.ts";
import { chatRoute } from "../lib/route.ts";
import { cx, Key, KeyLink, Lamp, Mark, Plate, SLOT } from "../ui/kit.tsx";

interface ChatListProps {
  repos: RepoInfo[] | null;
  repo: string | null;
  onRepo: (fullName: string) => void;
  chats: ChatSummary[] | null;
  chatsError: string | null;
  onRetry: () => void;
  selected: string | null;
  onOpen: (chat: ChatSummary) => void;
  onNew: () => void;
  activation: ChatActivation | null;
  activating: boolean;
  onActivate: () => void;
  migration: ChatMigration | null;
  migrating: boolean;
  onMigrate: () => void;
  installUrl: string | null;
  now: number;
  /** На телефоне сверху — знак 0110. */
  phone?: boolean;
}

export function ChatList(p: ChatListProps) {
  const [query, setQuery] = useState("");
  const { open, archived } = useMemo(() => arrangeChatTree(p.chats ?? [], query), [p.chats, query]);
  const current = p.repos?.find((r) => r.full_name.toLowerCase() === p.repo?.toLowerCase());

  if (p.repos && p.repos.length === 0) {
    return (
      <Wrap phone={p.phone}>
        <NoRepos installUrl={p.installUrl} />
      </Wrap>
    );
  }

  return (
    <Wrap phone={p.phone}>
      <label className="flex flex-col gap-1.5">
        <span className="text-cap font-semibold">{s.list.repo}</span>
        <select
          className={cx(SLOT, "text-key")}
          value={current?.full_name ?? ""}
          onChange={(e) => p.onRepo(e.target.value)}
          disabled={!p.repos}
        >
          {!p.repos ? <option value="">{s.loading}</option> : null}
          {p.repos?.map((r) => (
            <option key={r.full_name} value={r.full_name}>
              {`${r.owner} / ${r.name}${r.can_push ? "" : ` — ${s.list.repoReadOnly}`}`}
            </option>
          ))}
        </select>
      </label>

      <Activation
        activation={p.activation}
        activating={p.activating}
        canPush={!!current?.can_push}
        onActivate={p.onActivate}
        migration={p.migration}
        migrating={p.migrating}
        onMigrate={p.onMigrate}
      />

      <label className="flex flex-col gap-1.5">
        <span className="sr-only-text">{s.list.searchLabel}</span>
        <input
          type="search"
          className={cx(SLOT, "text-key")}
          placeholder={s.list.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {p.chatsError ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-1 text-cap text-action-ink">
          {p.chatsError}
          <Key onClick={p.onRetry}>{s.retry}</Key>
        </div>
      ) : null}

      {p.chats === null && !p.chatsError ? <p className="m-0 px-1 text-cap text-ink-2">{s.loading}</p> : null}

      {p.chats && p.chats.length === 0 ? (
        <Plate className="flex flex-col items-start gap-2.5 px-5 pt-[18px] pb-6">
          <h3 className="m-0 text-copy font-semibold">{s.list.noChats.title}</h3>
          <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.list.noChats.text}</p>
          {current?.can_push ? <Key onClick={p.onNew}>{s.empty.create}</Key> : null}
        </Plate>
      ) : null}

      {p.chats && p.chats.length > 0 && open.length + archived.length === 0 ? (
        <p className="m-0 px-1 text-cap text-ink-2">{s.list.nothingFound}</p>
      ) : null}

      {open.length > 0 ? <Nodes nodes={open} p={p} /> : null}

      {archived.length > 0 ? (
        <>
          <h3 className="m-0 scale px-0.5 pt-2.5 font-normal text-ink-2">{s.list.archive}</h3>
          <Nodes nodes={archived} p={p} />
        </>
      ) : null}
    </Wrap>
  );
}

/**
 * Чаты деревом Fork: вложенные списки (диктор слышит уровень), дети — с
 * тонкой линией ветки от родителя. Это и есть доступная замена графа (п. 22).
 */
function Nodes({ nodes, p, nested }: { nodes: ChatTreeNode[]; p: ChatListProps; nested?: boolean }) {
  return (
    <ul className={cx("m-0 flex list-none flex-col p-0", nested ? "mt-2 gap-2 pl-[15px]" : "gap-3.5")}>
      {nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        return (
          <li key={n.chat.chat_id} className={cx(nested && "relative pl-3.5")}>
            {nested ? (
              <span
                aria-hidden="true"
                className={cx(
                  "absolute left-0 -top-2 w-2.5 border-0 border-l-[1.5px] border-solid border-ink-3",
                  last ? "h-[30px] rounded-bl-[7px] border-b-[1.5px]" : "bottom-0",
                )}
              />
            ) : null}
            {nested && !last ? (
              <span aria-hidden="true" className="absolute top-[22px] left-0 w-2.5 border-0 border-t-[1.5px] border-solid border-ink-3" />
            ) : null}
            <Row
              chat={n.chat}
              selected={n.chat.chat_id === p.selected}
              onOpen={p.onOpen}
              now={p.now}
              archived={n.chat.state !== "open"}
              compact={n.depth > 0}
              forkOf={n.parentTitle}
            />
            {n.children.length > 0 ? <Nodes nodes={n.children} p={p} nested /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Wrap({ phone, children }: { phone?: boolean | undefined; children: ReactNode }) {
  return (
    <aside
      aria-label={s.list.label}
      className={cx(
        "box-border flex min-w-0 flex-col gap-3.5 overflow-y-auto",
        phone ? "px-4 pt-5 pb-6" : "h-full px-[22px] py-[30px]",
      )}
    >
      {phone ? (
        <div className="flex items-end gap-2.5 pb-1">
          <Mark cell={3} />
          <span className="text-scale tracking-[0.03em] text-ink-2">{s.markSub}</span>
        </div>
      ) : null}
      <h2 className="m-0 mb-1 text-section font-semibold tracking-[-0.01em]">{s.list.heading}</h2>
      {children}
    </aside>
  );
}

function Row({
  chat,
  selected,
  archived,
  onOpen,
  now,
  compact,
  forkOf,
}: {
  chat: ChatSummary;
  selected: boolean;
  archived?: boolean;
  onOpen: (c: ChatSummary) => void;
  now: number;
  compact?: boolean;
  forkOf?: string | null;
}) {
  const live = !archived && isFresh(chat.updated_at, now);
  const href = routeHref(chatRoute(chat.repo, chat.chat_id));
  return (
    <a
      href={href}
      aria-current={selected ? "true" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(chat);
      }}
      className={cx(
        "flex rounded-row text-ink no-underline hover:text-ink",
        compact ? "gap-2.5" : "gap-3",
        selected ? (compact ? "pressed px-3 py-2.5" : "pressed p-3.5") : compact ? "bg-body px-3 pt-2.5 pb-3.5" : "bg-body px-3.5 pt-3 pb-4",
        !selected && !archived && "plinth-row active:translate-y-px",
        !selected && archived && "opacity-60 shadow-[inset_0_0_0_1px_var(--line)]",
      )}
    >
      <Lamp state={live ? "live" : "off"} size={compact ? 8 : 10} className="mt-[5px]" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cx("leading-snug font-semibold [overflow-wrap:anywhere]", compact ? "text-key" : "text-copy")}>
          {forkOf ? <span className="sr-only-text">{`${s.list.forkOf(forkOf)}: `}</span> : null}
          {chat.title}
        </span>
        <span className="text-cap text-ink-2">
          {s.list.rowMeta(chat.number, archived ? s.list.closed : agoShort(chat.updated_at, now))}
        </span>
      </span>
    </a>
  );
}

function Activation({
  activation,
  activating,
  canPush,
  onActivate,
  migration,
  migrating,
  onMigrate,
}: {
  activation: ChatActivation | null;
  activating: boolean;
  canPush: boolean;
  onActivate: () => void;
  migration: ChatMigration | null;
  migrating: boolean;
  onMigrate: () => void;
}) {
  if (!activation) return null;
  const pending = migration?.items.some((item) => item.status === "pending") ?? false;
  const moved = migration?.items.some((item) => item.status === "migrated") ?? false;
  const blocked = migration?.items.some((item) => item.status === "conflict" || item.status === "protocol_invalid") ?? false;
  const idleLegacy = activation.activated ? s.connect.onLegacy : s.connect.legacy;
  const legacyText = blocked ? s.migrate.conflict : pending ? s.migrate.pending : moved ? s.migrate.done : idleLegacy;
  const text = activation.protocol_invalid
    ? s.connect.broken
    : activation.legacy_chats
      ? legacyText
      : activation.activated
        ? s.connect.on
        : s.connect.off;
  const showConnect = canPush && !activation.protocol_invalid && activation.gaps.length > 0;
  const showMigrate = canPush && pending;
  const busy = activating || migrating;
  return (
    <Plate className="flex flex-col items-start gap-2.5 px-4 py-3.5">
      <p className="m-0 text-cap leading-[1.45] text-ink-2">{text}</p>
      {showConnect ? (
        <Key onClick={onActivate} disabled={busy}>
          {activating ? s.connect.working : s.connect.action}
        </Key>
      ) : null}
      {showMigrate ? (
        <Key onClick={onMigrate} disabled={busy}>
          {migrating ? s.migrate.working : s.migrate.action}
        </Key>
      ) : null}
    </Plate>
  );
}

function NoRepos({ installUrl }: { installUrl: string | null }) {
  return (
    <Plate className="flex flex-col items-start gap-2.5 px-5 pt-[18px] pb-6">
      <h3 className="m-0 text-copy font-semibold">{s.list.noRepos.title}</h3>
      <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.list.noRepos.text}</p>
      {installUrl ? <KeyLink href={installUrl}>{s.list.noRepos.action}</KeyLink> : null}
    </Plate>
  );
}
