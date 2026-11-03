import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./kit.tsx";

export type MenuItem =
  | { kind: "button"; label: string; onClick: () => void; disabled?: boolean; title?: string }
  | { kind: "link"; label: string; href: string; external?: boolean }
  | { kind: "node"; node: ReactNode };

/**
 * Выпадающее меню светлого дизайна: «⋯» в шапке чата и «Настройки» внизу
 * боковой колонки. Редкие действия живут здесь, а не крупными клавишами на
 * экране. Закрывается щелчком мимо, Escape и выбором пункта.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "right",
  up = false,
  className,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  /** Открываться вверх — у кнопки внизу экрана. */
  up?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const row = "flex min-h-9 w-full items-center rounded-[8px] px-3 text-left text-key text-ink no-underline hover:bg-screen hover:text-ink";
  return (
    <div ref={root} className={cx("relative", className)}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex size-8 items-center justify-center rounded-[8px] border-0 bg-transparent text-[18px] leading-none text-ink-2 hover:bg-screen hover:text-ink"
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          className={cx(
            "absolute z-30 flex w-max min-w-52 flex-col gap-0.5 rounded-[12px] bg-body p-1.5 plinth-sheet",
            align === "right" ? "right-0" : "left-0",
            up ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {items.map((item, i) =>
            item.kind === "node" ? (
              <div key={i} className="px-3 py-1.5">
                {item.node}
              </div>
            ) : item.kind === "link" ? (
              <a
                key={i}
                role="menuitem"
                href={item.href}
                className={row}
                {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                title={item.title}
                disabled={item.disabled}
                className={cx(row, "border-0 bg-transparent disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent")}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
