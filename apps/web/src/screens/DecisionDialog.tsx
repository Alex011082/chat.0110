import type { Decision, MessageItem, TimelineItem } from "@chat0110/chat-protocol";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText } from "../api.ts";
import { acceptedDecisions, DECISION_TITLE_MAX, decisionRequest, decisionTitle, sourceCandidates } from "../lib/decision.ts";
import { excerpt } from "../lib/text.ts";
import { s } from "../strings.ts";
import { ActionKey, cx, Key, Screen, SLOT } from "../ui/kit.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { whenShort } from "./DecisionCard.tsx";

/** От какого сообщения какого чата записываем решение. */
export interface DecisionTarget {
  repo: string;
  chatId: string;
  canPush: boolean;
  message: MessageItem;
  items: TimelineItem[];
  decisions: Decision[];
}

interface DecisionDialogProps {
  target: DecisionTarget | null;
  now: number;
  onClose: () => void;
  onCreated: (d: Decision) => void;
}

export function DecisionDialog({ target, now, onClose, onCreated }: DecisionDialogProps) {
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      labelledBy="decision-title"
      className="mx-auto mt-[max(16px,5vh)] w-[min(540px,calc(100vw-28px))]"
    >
      {target ? (
        <DecisionForm key={`${target.chatId}/${target.message.id}`} target={target} now={now} onClose={onClose} onCreated={onCreated} />
      ) : null}
    </Sheet>
  );
}

function DecisionForm({
  target,
  now,
  onClose,
  onCreated,
}: {
  target: DecisionTarget;
  now: number;
  onClose: () => void;
  onCreated: (d: Decision) => void;
}) {
  const [title, setTitle] = useState(() => decisionTitle(target.message.text));
  const [text, setText] = useState("");
  const [sources, setSources] = useState<string[]>([target.message.id]);
  const [supersedes, setSupersedes] = useState("");
  const [accept, setAccept] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => sourceCandidates(target.items, target.message.id), [target]);
  const accepted = useMemo(() => acceptedDecisions(target.decisions), [target]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy || !target.canPush) return;
    setBusy(true);
    setError(null);
    try {
      // Порядок оснований — как в ленте, а не как щёлкали.
      const ordered = candidates.map((m) => m.id).filter((id) => sources.includes(id)).reverse();
      const { decision } = await api().createDecision(
        target.repo,
        target.chatId,
        decisionRequest({ title, text, sources: ordered, supersedes, accept }),
      );
      onCreated(decision);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <SheetForm onSubmit={submit} titleId="decision-title" title={s.decision.create.title} lead={s.decision.create.lead} onClose={onClose}>
      {!target.canPush ? <Alert>{s.decision.create.readOnly}</Alert> : null}

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">{s.decision.create.name}</span>
        <input
          type="text"
          required
          maxLength={DECISION_TITLE_MAX}
          data-autofocus
          value={title}
          disabled={!target.canPush}
          onChange={(e) => setTitle(e.target.value)}
          className={cx(SLOT, "text-copy")}
        />
      </label>

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">
          {s.decision.create.why} <span className="font-normal text-ink-2">{s.decision.create.optional}</span>
        </span>
        <textarea
          rows={3}
          value={text}
          disabled={!target.canPush}
          placeholder={s.decision.create.whyPlaceholder}
          onChange={(e) => setText(e.target.value)}
          className={cx(SLOT, "resize-none py-3 text-copy leading-[1.45]")}
        />
      </label>

      <MessageChecklist
        legend={s.decision.create.sources}
        help={s.decision.create.sourcesHelp}
        messages={candidates}
        selected={sources}
        onChange={setSources}
        disabled={!target.canPush}
        now={now}
      />

      {accepted.length > 0 ? (
        <SupersedesSelect
          label={s.decision.create.supersedes}
          none={s.decision.create.none}
          options={accepted}
          value={supersedes}
          onChange={setSupersedes}
          disabled={!target.canPush}
        />
      ) : null}

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={accept}
          disabled={!target.canPush}
          onChange={(e) => setAccept(e.target.checked)}
          className="mt-[2px] size-[18px] shrink-0 accent-[var(--action)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-cap font-semibold">{s.decision.create.acceptNow}</span>
          <span className="text-cap leading-[1.45] text-ink-2">{s.decision.create.acceptNowHelp}</span>
        </span>
      </label>

      {error ? <Alert>{error}</Alert> : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Key onClick={onClose}>{s.cancel}</Key>
        <ActionKey type="submit" disabled={busy || !title.trim() || !target.canPush}>
          {busy ? s.decision.create.busy : accept ? s.decision.create.submitAccept : s.decision.create.submitPropose}
        </ActionKey>
      </div>
    </SheetForm>
  );
}

// --- Общие детали форм решений ---------------------------------------------------

/** Корпус листа-формы: заголовок, пояснение, «×». */
export function SheetForm({
  onSubmit,
  titleId,
  title,
  lead,
  onClose,
  children,
}: {
  onSubmit: (e: FormEvent) => void;
  titleId: string;
  title: string;
  lead: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="box-border flex max-h-[calc(100dvh-max(16px,5vh)-16px)] flex-col gap-5 overflow-y-auto rounded-device bg-plate px-6 pt-[22px] pb-[30px] plinth-sheet"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 id={titleId} className="m-0 text-[20px] font-semibold tracking-[-0.02em]">
            {title}
          </h1>
          <p className="m-0 text-cap leading-[1.45] text-ink-2">{lead}</p>
        </div>
        <button
          type="button"
          aria-label={s.close}
          onClick={onClose}
          className="flex size-[34px] shrink-0 items-center justify-center rounded-full border-0 bg-body text-[18px] text-ink plinth-knob active:translate-y-px"
        >
          ×
        </button>
      </div>
      {children}
    </form>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 text-cap leading-[1.45] text-action-ink">
      {children}
    </p>
  );
}

/** Список сообщений с галочками — основания решения или доказательства предложения. */
export function MessageChecklist({
  legend,
  help,
  messages,
  selected,
  onChange,
  disabled,
  now,
  empty,
}: {
  legend: string;
  help: string;
  messages: readonly MessageItem[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  now: number;
  empty?: string;
}) {
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-[7px] border-0 p-0">
      <legend className="p-0 text-cap font-semibold">
        {legend} <span className="font-normal text-ink-2">· {help}</span>
      </legend>
      {messages.length === 0 && empty ? <p className="m-0 text-cap text-ink-2">{empty}</p> : null}
      {messages.length > 0 ? (
        <Screen className="flex max-h-[232px] flex-col overflow-y-auto p-1.5">
          {messages.map((m) => (
            <label
              key={m.id}
              className={cx("flex items-start gap-3 rounded-row px-2.5 py-2", !disabled && "cursor-pointer hover:bg-plate")}
            >
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                disabled={disabled}
                onChange={(e) => toggle(m.id, e.target.checked)}
                className="mt-[2px] size-[18px] shrink-0 accent-[var(--action)]"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-cap text-ink-2">
                  <b className="font-semibold text-ink">{m.display}</b> · {whenShort(m.created_at, now)}
                </span>
                <span className="text-key leading-snug [overflow-wrap:anywhere]">{excerpt(m.text, 110)}</span>
              </span>
            </label>
          ))}
        </Screen>
      ) : null}
    </fieldset>
  );
}

/** «Заменяет»: только принятые решения. */
export function SupersedesSelect({
  label,
  none,
  options,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  none: string;
  options: readonly Decision[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  /** Вместо «— ничего», пока список грузится. */
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-cap font-semibold">{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cx(SLOT, "text-copy")}>
        <option value="">{placeholder ?? none}</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
    </label>
  );
}
