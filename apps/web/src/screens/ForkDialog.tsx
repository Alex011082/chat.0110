import type { ChatSummary } from "@chat0110/chat-protocol";
import { useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { FORK_REASON_MAX, FORK_TITLE_MAX, forkRequest, forkTitle } from "../lib/fork.ts";
import { excerpt } from "../lib/text.ts";
import { dateTimeShort } from "../lib/time.ts";
import { s } from "../strings.ts";
import { ActionKey, cx, Key, Readout, Screen, SLOT } from "../ui/kit.tsx";
import { Sheet } from "../ui/Sheet.tsx";

/** От какого сообщения какого чата делаем Fork. */
export interface ForkTarget {
  repo: string;
  chatId: string;
  chatTitle: string;
  canPush: boolean;
  message: {
    id: string;
    display: string;
    created_at: string;
    /** Текст есть в ленте; у узла дерева — только автор и время. */
    text: string | null;
  };
}

interface ForkDialogProps {
  target: ForkTarget | null;
  onClose: () => void;
  onCreated: (chat: ChatSummary) => void;
}

export function ForkDialog({ target, onClose, onCreated }: ForkDialogProps) {
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      labelledBy="fork-title"
      className="mx-auto mt-[max(16px,5vh)] w-[min(500px,calc(100vw-28px))]"
    >
      {target ? <ForkForm key={`${target.chatId}/${target.message.id}`} target={target} onClose={onClose} onCreated={onCreated} /> : null}
    </Sheet>
  );
}

function ForkForm({ target, onClose, onCreated }: { target: ForkTarget; onClose: () => void; onCreated: (c: ChatSummary) => void }) {
  const [title, setTitle] = useState(() => forkTitle(target.chatTitle));
  const [reason, setReason] = useState("");
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quote = target.message.text ? excerpt(target.message.text, 56) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy || !target.canPush) return;
    setBusy(true);
    setError(null);
    try {
      const { chat } = await api().fork(target.repo, target.chatId, forkRequest(target.message.id, { title, reason, first }));
      onCreated(chat);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="box-border flex max-h-[calc(100dvh-32px)] flex-col gap-5 overflow-y-auto rounded-device bg-plate px-6 pt-[22px] pb-[30px] plinth-sheet"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 id="fork-title" className="m-0 text-[20px] font-semibold tracking-[-0.02em]">
            {s.fork.title}
          </h1>
          <p className="m-0 text-cap leading-[1.45] text-ink-2">{s.fork.lead}</p>
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

      {!target.canPush ? (
        <p role="alert" className="m-0 text-cap leading-[1.45] text-action-ink">
          {s.fork.readOnly}
        </p>
      ) : null}

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">{s.fork.name}</span>
        <input
          type="text"
          required
          maxLength={FORK_TITLE_MAX}
          data-autofocus
          value={title}
          disabled={!target.canPush}
          onChange={(e) => setTitle(e.target.value)}
          className={cx(SLOT, "text-copy")}
        />
      </label>

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">
          {s.fork.reason} <span className="font-normal text-ink-2">{s.fork.optional}</span>
        </span>
        <input
          type="text"
          maxLength={FORK_REASON_MAX}
          value={reason}
          disabled={!target.canPush}
          placeholder={s.fork.reasonPlaceholder}
          onChange={(e) => setReason(e.target.value)}
          className={cx(SLOT, "text-copy")}
        />
      </label>

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">
          {s.fork.firstMessage} <span className="font-normal text-ink-2">{s.fork.optional}</span>
        </span>
        <textarea
          rows={3}
          value={first}
          disabled={!target.canPush}
          onChange={(e) => setFirst(e.target.value)}
          className={cx(SLOT, "resize-none py-3 text-copy leading-[1.45]")}
        />
      </label>

      <Screen className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5">
        <div className="col-span-2">
          <Readout
            small
            label={s.fork.from}
            value={s.fork.fromValue(target.message.display, dateTimeShort(target.message.created_at), quote)}
          />
        </div>
        <Readout small label={s.fork.branch} value={s.fork.branchValue} />
        <Readout small label={s.fork.prInto} value={s.fork.prIntoValue(target.chatId)} />
        <div className="col-span-2">
          <Readout small label={s.fork.context} value={s.fork.contextValue} />
        </div>
      </Screen>

      {error ? (
        <p role="alert" className="m-0 text-cap text-action-ink">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Key onClick={onClose}>{s.cancel}</Key>
        <ActionKey type="submit" disabled={busy || !title.trim() || !target.canPush}>
          {busy ? s.fork.creating : s.fork.create}
        </ActionKey>
      </div>
    </form>
  );
}
