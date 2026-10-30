import { LanguageSwitch } from "../ui/LanguageSwitch.tsx";
import { s } from "../strings.ts";
import { cx, Knob, Mark, TextButton } from "../ui/kit.tsx";

interface RailProps {
  /** Какой раздел открыт: ручка текущего — чёрная. */
  view: "chats" | "tree";
  onChats: () => void;
  onTree: () => void;
  onNew: () => void;
  onLogout: () => void;
  canCreate: boolean;
  /** На телефоне рельс лежит внизу горизонтально. */
  bottom?: boolean;
}

/** Алюминиевый рельс с ручками разделов. */
export function Rail({ view, onChats, onTree, onNew, onLogout, canCreate, bottom }: RailProps) {
  const knobs = (
    <>
      <Knob label={s.rail.chats} current={view === "chats"} onClick={onChats} />
      <Knob label={s.rail.newChat} onClick={onNew} disabled={!canCreate} />
      <Knob label={s.rail.tree} current={view === "tree"} onClick={onTree} />
    </>
  );
  if (bottom) {
    return (
      <nav
        aria-label={s.rail.label}
        className="flex shrink-0 flex-col gap-3 border-t border-line bg-rail px-3 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]"
      >
        <div className="flex w-full justify-around gap-2">{knobs}</div>
        <div className="flex w-full items-center justify-between gap-2">
        <LanguageSwitch />
        <a href="/connect" className="text-cap text-ink-2">{s.locale === "en" ? "Connect AI" : "Подключить ИИ"}</a>
        <TextButton onClick={onLogout} className="mt-[9px] min-h-10 px-2.5">
          {s.rail.logout}
        </TextButton>
        </div>
      </nav>
    );
  }
  return (
    <nav
      aria-label={s.rail.label}
      className={cx(
        "box-border flex h-full w-[104px] flex-col items-center gap-[26px] overflow-y-auto",
        "border-r border-line bg-rail pt-[30px] pb-[26px]",
      )}
    >
      <Mark cell={3} />
      <span className="-mt-[18px] text-scale tracking-[0.03em] text-ink-2">{s.markSub}</span>
      {knobs}
        <LanguageSwitch />
        <a href="/connect" className="text-cap text-ink-2">{s.locale === "en" ? "Connect AI" : "Подключить ИИ"}</a>
      <TextButton onClick={onLogout} className="mt-auto min-h-10 px-2.5">
        {s.rail.logout}
      </TextButton>
    </nav>
  );
}
