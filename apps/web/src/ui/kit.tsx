import { useId, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { s } from "../strings.ts";

// Детали прибора (docs/design.md, «Детали»). Рецепты теней — в styles.css
// (plinth-*, recess*, bezel); здесь они собраны в компоненты, чтобы экраны не
// повторяли длинные строки классов.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- Клавиши -------------------------------------------------------------------

const KEY =
  "inline-flex items-center justify-center gap-2 min-h-10 rounded-full pb-[3px] text-key leading-tight text-center " +
  "[text-wrap:balance] font-semibold no-underline " +
  "select-none border-0 transition-[transform,box-shadow] duration-75 active:translate-y-px " +
  "disabled:opacity-55 disabled:active:translate-y-0 aria-disabled:opacity-55";
const PLASTIC = "px-[18px] bg-body text-ink hover:text-ink plinth-3 active:plinth-1 disabled:active:plinth-3";
const ACTION =
  "px-5 gap-[9px] bg-action text-white hover:text-white plinth-action active:plinth-action-pressed " +
  "disabled:active:plinth-action";

function ActionDot() {
  return <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-white" />;
}

/** Пластиковая клавиша. */
export function Key({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx(KEY, PLASTIC, className)} {...rest} />;
}

export function KeyLink({ className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cx(KEY, PLASTIC, className)} {...rest} />;
}

/** Оранжевая клавиша — одна на экран. */
export function ActionKey({ className, type = "button", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx(KEY, ACTION, className)} {...rest}>
      <ActionDot />
      {children}
    </button>
  );
}

export function ActionKeyLink({ className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cx(KEY, ACTION, className)} {...rest}>
      <ActionDot />
      {children}
    </a>
  );
}

/** Круглая клавиша отправки на телефоне. */
export function ActionRound({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "flex size-[46px] shrink-0 items-center justify-center rounded-full border-0 bg-action plinth-action",
        "active:translate-y-px active:plinth-action-pressed disabled:opacity-55",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="size-[9px] rounded-full bg-white" />
    </button>
  );
}

/** Тихая текстовая кнопка: «Ответить», «Выйти». */
export function TextButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx("min-h-8 border-0 bg-transparent p-0 text-cap text-ink-2 hover:text-action-ink", className)}
      {...rest}
    />
  );
}

export function TextLink({ className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cx("inline-flex min-h-8 items-center text-cap text-ink-2 no-underline hover:text-action-ink", className)}
      {...rest}
    />
  );
}

// --- Ручки -----------------------------------------------------------------------

function Tick({ current, short }: { current?: boolean; short?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx("w-[2px] rounded-[2px]", short ? "h-[10px]" : "h-[11px]", current ? "bg-lamp" : "bg-ink-2")}
    />
  );
}

interface KnobProps {
  label: string;
  current?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  href?: string;
  className?: string;
}

/** Ручка рельса: круг 42px с риской, подпись под ней. Текущая — чёрная с оранжевой риской. */
export function Knob({ label, current, disabled, title, onClick, href, className }: KnobProps) {
  const dial = (
    <span
      aria-hidden="true"
      className={cx(
        "box-border flex size-[42px] justify-center rounded-full pt-[6px]",
        current ? "bg-knob-ink plinth-ink" : "bg-body plinth-3",
      )}
    >
      <Tick current={current} />
    </span>
  );
  const cls = cx(
    "flex min-w-14 flex-col items-center gap-[7px] border-0 bg-transparent p-0 text-knob font-medium no-underline",
    current ? "text-ink" : "text-ink-2",
    disabled && "opacity-55 cursor-default hover:text-ink-2",
    !disabled && "hover:text-ink [&:active>span]:translate-y-px",
    className,
  );
  if (href && !disabled) {
    return (
      <a href={href} className={cls} aria-current={current ? "page" : undefined} onClick={onClick ? (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick();
      } : undefined}>
        {dial}
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      title={title}
      aria-disabled={disabled || undefined}
      aria-current={current ? "page" : undefined}
      onClick={disabled ? undefined : onClick}
    >
      {dial}
      {label}
      {disabled && title ? <span className="sr-only-text">{` — ${title}`}</span> : null}
    </button>
  );
}

/** Круглая клавиша 40px в шапке телефона: «‹» или риска. */
export function RoundKey({
  className,
  glyph,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { glyph?: ReactNode }) {
  return (
    <button
      type={type}
      className={cx(
        "box-border flex size-10 shrink-0 justify-center rounded-full border-0 bg-body text-ink plinth-knob",
        "active:translate-y-px",
        glyph ? "items-center text-[20px] leading-none" : "pt-[6px]",
        className,
      )}
      {...rest}
    >
      {glyph ?? <Tick short />}
    </button>
  );
}

// --- Лампы -----------------------------------------------------------------------

export type LampState = "live" | "act" | "off";

/** Лампа: зелёная — живо, оранжевое кольцо — ждёт действия, серая — выключена. */
export function Lamp({
  state,
  size = 10,
  ring = true,
  className,
}: {
  state: LampState;
  size?: 6 | 8 | 10;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "box-border inline-block shrink-0 rounded-full",
        size === 10 ? "size-2.5" : size === 8 ? "size-2" : "size-1.5",
        state === "live" && "bg-pilot",
        state === "act" && "border-2 border-solid border-lamp",
        state === "off" && "bg-lamp-off",
        ring && "lamp-ring",
        className,
      )}
    />
  );
}

// --- Корпуса --------------------------------------------------------------------

type Box = HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "header" | "form" | "aside" };

/** Плита: светлая, цоколь 6px, радиус 20. */
export function Plate({ as: Tag = "section", className, ...rest }: Box) {
  return <Tag className={cx("rounded-plate bg-plate plinth-6", className)} {...rest} />;
}

/** Корпус: цоколь 8px, радиус 18. */
export function Body({ as: Tag = "section", className, ...rest }: Box) {
  return <Tag className={cx("rounded-body bg-body plinth-8", className)} {...rest} />;
}

/** Экран: утопленное окошко, радиус 16. */
export function Screen({ as: Tag = "div", className, ...rest }: Box) {
  return <Tag className={cx("rounded-screen bg-screen recess-screen", className)} {...rest} />;
}

/** Показание на экране: шкала 11px и значение 15px/600. */
export function Readout({ label, value, small }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="scale text-ink-2">{label}</span>
      <span className={cx("font-semibold [overflow-wrap:anywhere]", small ? "text-key" : "text-copy leading-snug")}>
        {value}
      </span>
    </div>
  );
}

/** Щель ввода: класс для input/select/textarea. */
export const SLOT =
  "slot box-border min-h-11 w-full rounded-slot border-0 bg-slot px-3.5 text-ink caret-lamp recess appearance-none";

// --- Решётка и знак -------------------------------------------------------------

/** Решётка-«динамик» из точек. */
export function Grille({ width, height, className }: { width: number | string; height: number; className?: string }) {
  const id = "grille-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const w = typeof width === "number" ? width : 400;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="xMinYMid slice"
      aria-hidden="true"
      className={cx("shrink-0 text-ink", className)}
    >
      <defs>
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="2.5" fill="currentColor" fillOpacity=".5" />
        </pattern>
      </defs>
      <rect width={w} height={height} fill={`url(#${id})`} />
    </svg>
  );
}

// Клеточные цифры 5×7 знака 0110 — те же клетки, что в мокапе.
const DIGITS = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
} as const;
const MARK_CELLS: Array<[number, number]> = [];
"0110".split("").forEach((d, i) => {
  DIGITS[d as "0" | "1"].forEach((row, y) => {
    row.split("").forEach((c, x) => {
      if (c === "#") MARK_CELLS.push([i * 6 + x, y]);
    });
  });
});

/** Знак 0110 из клеток (crispEdges). cell=3 — рельс, cell=5 — вход. */
export function Mark({ cell = 3, className }: { cell?: 3 | 5; className?: string }) {
  return (
    <svg
      width={23 * cell}
      height={7 * cell}
      viewBox={`0 0 ${23 * cell} ${7 * cell}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      role="img"
      aria-label={s.mark}
      className={cx("shrink-0 text-ink", className)}
    >
      {MARK_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} />
      ))}
    </svg>
  );
}
