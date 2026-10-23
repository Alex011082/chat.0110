import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./kit.tsx";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  /** Щелчок по затемнению закрывает (панель «О чате»), но не форму с текстом. */
  dismissOnBackdrop?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Лист поверх затемнения на родном <dialog>: showModal даёт ловушку фокуса,
 * Escape и инертный фон без самодельного кода; фокус возвращается сам.
 */
export function Sheet({ open, onClose, labelledBy, label, dismissOnBackdrop, className, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal ставит фокус на первую кнопку («×»); нужное поле помечено data-autofocus.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-label={label}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === ref.current) onClose();
      }}
      className={cx("max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 text-ink", className)}
    >
      {open ? children : null}
    </dialog>
  );
}
