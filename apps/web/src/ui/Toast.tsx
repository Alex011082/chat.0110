import { useEffect } from "react";
import { s } from "../strings.ts";
import { Lamp } from "./kit.tsx";

/**
 * Короткое подтверждение сверху экрана: «Предложение отправлено…». Человек
 * остаётся там, где был; через 5 с строка гаснет сама.
 */
export function Toast({ text, onClose }: { text: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(14px,env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      {text ? (
        <div
          role="status"
          className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full bg-body py-1 pr-1.5 pl-4 text-cap font-semibold plinth-knob"
        >
          <Lamp state="live" size={8} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
          <button
            type="button"
            aria-label={s.toast.close}
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[17px] text-ink-2 hover:text-action-ink"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
