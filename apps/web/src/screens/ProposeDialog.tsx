import type { ChatDetail, Decision, TimelineItem } from "@chat0110/chat-protocol";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import {
  acceptedDecisions,
  DECISION_TITLE_MAX,
  defaultEvidence,
  forkMessages,
  proposalOutline,
  proposeRequest,
} from "../lib/decision.ts";
import { s } from "../strings.ts";
import { ActionKey, cx, Key, Readout, Screen, SLOT } from "../ui/kit.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { Alert, MessageChecklist, SheetForm, SupersedesSelect } from "./DecisionDialog.tsx";

// «Предложить родителю» (п. 4.7 спеки): не слияние сообщений, а одно
// предложение решения в родителе со ссылками на доказательства из Fork.

export interface ProposeTarget {
  chat: ChatDetail;
  /** Своя лента Fork — без унаследованной истории родителя. */
  items: TimelineItem[];
  /** Свои решения Fork — для заготовки текста. */
  decisions: Decision[];
  parentTitle: string;
}

interface ProposeDialogProps {
  target: ProposeTarget | null;
  now: number;
  onClose: () => void;
  onSent: (d: Decision) => void;
}

export function ProposeDialog({ target, now, onClose, onSent }: ProposeDialogProps) {
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      labelledBy="propose-title"
      className="mx-auto mt-[max(16px,5vh)] w-[min(560px,calc(100vw-28px))]"
    >
      {target ? <ProposeForm key={target.chat.chat_id} target={target} now={now} onClose={onClose} onSent={onSent} /> : null}
    </Sheet>
  );
}

type ParentDecisions = { state: "loading" } | { state: "error" } | { state: "ready"; list: Decision[] };

function ProposeForm({ target, now, onClose, onSent }: { target: ProposeTarget; now: number; onClose: () => void; onSent: (d: Decision) => void }) {
  const { chat } = target;
  const parentId = chat.parent!.chat_id;
  const messages = useMemo(() => forkMessages(target.items), [target.items]);
  const [evidence, setEvidence] = useState<string[]>(() => defaultEvidence(messages));
  const [title, setTitle] = useState(() => chat.title.slice(0, DECISION_TITLE_MAX));
  const [text, setText] = useState(() =>
    proposalOutline({
      reason: chat.meta?.parent?.reason ?? "",
      decisions: target.decisions,
      messages: messages.filter((m) => evidence.includes(m.id)),
    }),
  );
  const [supersedes, setSupersedes] = useState("");
  const [parent, setParent] = useState<ParentDecisions>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Что можно заменить — решения родителя: читаем его ленту своим токеном.
  useEffect(() => {
    let alive = true;
    api()
      .timeline(chat.repo, parentId)
      .then(
        (data) => alive && setParent({ state: "ready", list: acceptedDecisions(data.decisions ?? []) }),
        () => alive && setParent({ state: "error" }),
      );
    return () => {
      alive = false;
    };
  }, [chat.repo, parentId]);

  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim() || busy || !chat.can_push) return;
    setBusy(true);
    setError(null);
    try {
      const sources = messages.map((m) => m.id).filter((id) => evidence.includes(id));
      const { decision } = await api().proposeToParent(chat.repo, chat.chat_id, proposeRequest({ title, text, sources, supersedes }));
      onSent(decision);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const options = parent.state === "ready" ? parent.list : [];

  return (
    <SheetForm
      onSubmit={submit}
      titleId="propose-title"
      title={s.decision.propose.title}
      lead={s.decision.propose.lead(target.parentTitle)}
      onClose={onClose}
    >
      {!chat.can_push ? <Alert>{s.decision.propose.readOnly}</Alert> : null}

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">{s.decision.propose.name}</span>
        <input
          type="text"
          required
          maxLength={DECISION_TITLE_MAX}
          data-autofocus
          value={title}
          disabled={!chat.can_push}
          onChange={(e) => setTitle(e.target.value)}
          className={cx(SLOT, "text-copy")}
        />
      </label>

      <label className="flex flex-col gap-[7px]">
        <span className="text-cap font-semibold">{s.decision.propose.gist}</span>
        <textarea
          rows={7}
          required
          value={text}
          disabled={!chat.can_push}
          onChange={(e) => setText(e.target.value)}
          className={cx(SLOT, "resize-y py-3 text-key leading-[1.45]")}
        />
      </label>

      <MessageChecklist
        legend={s.decision.propose.evidence}
        help={s.decision.propose.evidenceHelp}
        messages={newestFirst}
        selected={evidence}
        onChange={setEvidence}
        disabled={!chat.can_push}
        now={now}
        empty={s.decision.propose.noMessages}
      />

      {parent.state === "ready" && options.length === 0 ? null : (
        <SupersedesSelect
          label={s.decision.propose.supersedes}
          none={s.decision.propose.none}
          options={options}
          value={supersedes}
          onChange={setSupersedes}
          disabled={!chat.can_push || parent.state !== "ready"}
          {...(parent.state === "loading" ? { placeholder: s.decision.propose.loading } : {})}
        />
      )}
      {parent.state === "error" ? <p className="-mt-3 mb-0 text-cap leading-[1.45] text-ink-2">{s.decision.propose.loadError}</p> : null}

      <Screen className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5">
        <Readout small label={s.header.parent} value={target.parentTitle} />
        <Readout small label={s.fork.branch} value={`chat/${parentId}`} />
      </Screen>

      {error ? <Alert>{error}</Alert> : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Key onClick={onClose}>{s.cancel}</Key>
        <ActionKey type="submit" disabled={busy || !title.trim() || !text.trim() || !chat.can_push}>
          {busy ? s.decision.propose.busy : s.decision.propose.submit}
        </ActionKey>
      </div>
    </SheetForm>
  );
}
