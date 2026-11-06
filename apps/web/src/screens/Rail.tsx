import { LanguageSwitch } from "../ui/LanguageSwitch.tsx";
import { s } from "../strings.ts";
import { cx, Knob, Mark, TextButton } from "../ui/kit.tsx";
import { setDesign, useDesign } from "../lib/design.ts";
import {GlobalSettings} from "./GlobalSettings.tsx";
import {PlusIcon,TreeIcon,ChatsIcon} from "../ui/icons.tsx";

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
  login?:string;
}

/** Алюминиевый рельс с ручками разделов. */
export function Rail({ view, onChats, onTree, onNew, onLogout, canCreate, bottom,login="" }: RailProps) {
  // Переключатель дизайна: на рельсе «прибора» и в светлом на телефоне (там рельс внизу).
  const light = useDesign() === "light";
  const designSwitch = (
    <TextButton onClick={() => setDesign(light ? "device" : "light")} className="min-h-10 px-2.5 text-center">
      {light ? s.design.toDevice : s.design.toLight}
    </TextButton>
  );
  const knobs = (
    <>
      <Knob label={s.rail.chats} current={view === "chats"} onClick={onChats} />
      <Knob label={s.rail.newChat} onClick={onNew} disabled={!canCreate} />
      <Knob label={s.rail.tree} current={view === "tree"} onClick={onTree} />
    </>
  );
  if (bottom) {
    return (
      <nav aria-label={s.rail.label} className="mobile-list-toolbar">
       <h1>{view==="tree"?s.rail.tree:s.list.heading}</h1>
       <button type="button" className="settings-trigger" aria-label={view==="tree"?s.rail.chats:s.rail.tree} onClick={view==="tree"?onChats:onTree}>{view==="tree"?<ChatsIcon/>:<TreeIcon/>}</button>
       <button type="button" className="settings-trigger" aria-label={s.newChat.title} disabled={!canCreate} onClick={onNew}><PlusIcon/></button>
       <GlobalSettings login={login} onLogout={onLogout}/>
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
        <a href="/plugins" className="text-cap text-ink-2">{s.locale === "en" ? "AI plugins" : "Плагины ИИ"}</a>
        {designSwitch}
      <TextButton onClick={onLogout} className="mt-auto min-h-10 px-2.5">
        {s.rail.logout}
      </TextButton>
    </nav>
  );
}
