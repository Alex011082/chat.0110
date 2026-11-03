import type { ReactNode } from "react";
import { setDesign } from "../lib/design.ts";
import { s } from "../strings.ts";
import { ChatsIcon, GearIcon, PlusIcon, TreeIcon } from "../ui/icons.tsx";
import { cx, Mark } from "../ui/kit.tsx";
import { LanguageSwitch } from "../ui/LanguageSwitch.tsx";
import { Menu } from "../ui/Menu.tsx";

/**
 * Боковая колонка светлого дизайна: рельс прибора и список чатов в одной
 * колонке. Сверху — знак и две частые кнопки (новый чат, дерево), внизу —
 * кто вошёл и меню с редким: язык, плагины ИИ, дизайн, выход.
 */
export function LightSidebar({
  login,
  view,
  onChats,
  onTree,
  onNew,
  canCreate,
  onLogout,
  children,
}: {
  login: string;
  view: "chats" | "tree";
  onChats: () => void;
  onTree: () => void;
  onNew: () => void;
  canCreate: boolean;
  onLogout: () => void;
  children: ReactNode;
}) {
  const icon =
    "flex size-8 items-center justify-center rounded-[8px] border-0 bg-transparent text-ink-2 hover:bg-screen hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <nav aria-label={s.rail.label} className="flex h-dvh min-w-0 flex-col border-r border-line bg-rail">
      <div className="flex shrink-0 items-center gap-1 px-4 pt-4 pb-2">
        <span className="flex items-end gap-1.5">
          <Mark cell={3} />
          <span className="text-cap leading-none text-ink-3">{s.markSub}</span>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className={cx(icon, view === "tree" && "bg-screen text-ink")}
          aria-label={view === "tree" ? s.design.chats : s.design.tree}
          title={view === "tree" ? s.design.chats : s.design.tree}
          aria-pressed={view === "tree"}
          onClick={view === "tree" ? onChats : onTree}
        >
          {view === "tree" ? <ChatsIcon /> : <TreeIcon />}
        </button>
        <button type="button" className={icon} aria-label={s.design.newChat} title={s.design.newChat} disabled={!canCreate} onClick={onNew}>
          <PlusIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-4 py-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-knob-ink text-[11px] font-semibold text-knob-ink-fg"
        >
          {login.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-key">{login}</span>
        <Menu
          label={s.design.settings}
          trigger={<GearIcon />}
          up
          items={[
            { kind: "node", node: <LanguageSwitch /> },
            { kind: "link", label: s.design.plugins, href: "/plugins" },
            { kind: "button", label: s.design.toDevice, onClick: () => setDesign("device") },
            { kind: "button", label: s.rail.logout, onClick: onLogout },
          ]}
        />
      </div>
    </nav>
  );
}
