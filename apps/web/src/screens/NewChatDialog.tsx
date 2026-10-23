import type { ChatSummary, RepoInfo } from "@chat0110/chat-protocol";
import { useId, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { s } from "../strings.ts";
import { ActionKey, cx, Key, Readout, Screen, SLOT } from "../ui/kit.tsx";
import { Sheet } from "../ui/Sheet.tsx";

interface NewChatProps {
  open: boolean;
  onClose: () => void;
  repos: RepoInfo[];
  repo: string | null;
  installUrl: string | null;
  onCreated: (chat: ChatSummary) => void;
}

export function NewChatDialog(p: NewChatProps) {
  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      labelledBy="new-chat-title"
      className="mx-auto mt-[max(16px,6vh)] w-[min(460px,calc(100vw-28px))]"
    >
      <NewChatForm {...p} />
    </Sheet>
  );
}

function NewChatForm({ onClose, repos, repo, installUrl, onCreated }: NewChatProps) {
  const writable = repos.filter((r) => r.can_push);
  const initial = writable.find((r) => r.full_name.toLowerCase() === repo?.toLowerCase()) ?? writable[0];
  const [target, setTarget] = useState(initial?.full_name ?? "");
  const [title, setTitle] = useState("");
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!target || !name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = first.trim()
        ? { repo: target, title: name, first_message: first.trim() }
        : { repo: target, title: name };
      const { chat } = await api().createChat(body);
      onCreated(chat);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="box-border flex flex-col gap-5 rounded-device bg-plate px-6 pt-[22px] pb-[30px] plinth-sheet"
    >
      <div className="flex items-center justify-between gap-2.5">
        <h1 id="new-chat-title" className="m-0 text-[20px] font-semibold tracking-[-0.02em]">
          {s.newChat.title}
        </h1>
        <button
          type="button"
          aria-label={s.close}
          onClick={onClose}
          className="flex size-[34px] items-center justify-center rounded-full border-0 bg-body text-[18px] text-ink plinth-knob active:translate-y-px"
        >
          ×
        </button>
      </div>

      {writable.length === 0 ? (
        <p role="alert" className="m-0 text-cap text-action-ink">
          {s.newChat.noWritable}
        </p>
      ) : null}

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">{s.newChat.repo}</span>
        <select
          className={cx(SLOT, "text-copy")}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={writable.length === 0}
          aria-describedby={`${ids}-repo-help`}
        >
          {writable.map((r) => (
            <option key={r.full_name} value={r.full_name}>{`${r.owner} / ${r.name}`}</option>
          ))}
        </select>
        <span id={`${ids}-repo-help`} className="text-cap text-ink-2">
          {s.newChat.repoHelp}{" "}
          {installUrl ? (
            <a href={installUrl} className="text-ink">
              {s.newChat.installOther}
            </a>
          ) : null}
        </span>
      </label>

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">{s.newChat.name}</span>
        <input
          type="text"
          required
          maxLength={120}
          data-autofocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={cx(SLOT, "text-copy")}
        />
      </label>

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">
          {s.newChat.firstMessage} <span className="font-normal text-ink-2">{s.newChat.optional}</span>
        </span>
        <textarea
          rows={3}
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          className={cx(SLOT, "resize-none py-3 text-copy leading-[1.45]")}
        />
      </label>

      <Screen className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5">
        <Readout small label={s.newChat.branch} value={s.newChat.branchValue} />
        <Readout small label={s.newChat.pr} value={s.newChat.prValue} />
        <div className="col-span-2">
          <Readout small label={s.newChat.rules} value={s.newChat.rulesValue} />
        </div>
      </Screen>

      {error ? (
        <p role="alert" className="m-0 text-cap text-action-ink">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Key onClick={onClose}>{s.cancel}</Key>
        <ActionKey type="submit" disabled={busy || !target || !title.trim()}>
          {busy ? s.newChat.creating : s.newChat.create}
        </ActionKey>
      </div>
    </form>
  );
}
