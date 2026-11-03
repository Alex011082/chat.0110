import type { ChatDetail, InviteResponse, Person } from "@chat0110/chat-protocol";
import { useEffect, useId, useState, type ReactNode } from "react";
import { api, errorText } from "../api.ts";
import { agentLinkPhrase } from "../lib/chat.ts";
import { initials } from "../lib/text.ts";
import { s } from "../strings.ts";
import { ActionKey, cx } from "../ui/kit.tsx";
import { CheckIcon, ChevronIcon, PersonIcon, PlusIcon, SearchIcon, SparkIcon } from "../ui/icons.tsx";
import { Menu } from "../ui/Menu.tsx";
import { Sheet } from "../ui/Sheet.tsx";

interface InviteProps {
  chat: ChatDetail;
  /** 2 — инструкция агенту в Chat/AGENTS.md, иначе прежний chats/. */
  store?: 1 | 2;
  phone: boolean;
  onToast: (text: string) => void;
}

/**
 * Буфер обмена может быть закрыт (не https, запрет встроенного окна). Тогда
 * пробуем старый путь — выделить текст и скопировать; не вышло — говорим об этом.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Поле кладём в открытый лист, если он есть: за пределами модального
    // <dialog> всё инертно, и выделение там не работает.
    const host = document.querySelector("dialog[open]") ?? document.body;
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    host.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

const ROUND = "flex size-11 shrink-0 items-center justify-center rounded-full";

/**
 * «+» рядом с кружками участников. Агент — одно касание: ссылка для него уже
 * в буфере. Человек — поиск среди вошедших в chat.0110 и приглашение
 * в репозиторий чата. На компьютере выбор — меню под «+», на телефоне — лист снизу.
 */
export function InviteButton({ chat, store, phone, onToast }: InviteProps) {
  const [choosing, setChoosing] = useState(false);
  const [searching, setSearching] = useState(false);
  const inviteAgent = () => {
    setChoosing(false);
    void copyText(agentLinkPhrase(chat.url, store)).then((ok) => onToast(ok ? s.invite.agentCopied : s.errors.copyFailed));
  };
  const invitePerson = () => {
    setChoosing(false);
    setSearching(true);
  };
  const plus = (
    <span className="flex size-7 items-center justify-center rounded-full border-[1.5px] border-dashed border-ink-3 text-ink-2">
      <PlusIcon size={14} />
    </span>
  );
  return (
    <>
      {phone ? (
        <button
          type="button"
          aria-label={s.invite.open}
          title={s.invite.open}
          aria-haspopup="dialog"
          onClick={() => setChoosing(true)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent"
        >
          {plus}
        </button>
      ) : (
        <Menu
          label={s.invite.open}
          trigger={plus}
          items={[
            {
              kind: "button",
              label: s.invite.agent,
              hint: s.invite.agentHint,
              icon: <span className={cx(ROUND, "size-9 bg-screen text-ink")}><SparkIcon /></span>,
              onClick: inviteAgent,
            },
            {
              kind: "button",
              label: s.invite.person,
              hint: s.invite.personHint,
              icon: <span className={cx(ROUND, "size-9 bg-knob-ink text-knob-ink-fg")}><PersonIcon /></span>,
              onClick: invitePerson,
            },
          ]}
        />
      )}
      {phone ? (
        <Sheet open={choosing} onClose={() => setChoosing(false)} label={s.invite.open} dismissOnBackdrop className={BOTTOM}>
          <div className={cx(BOTTOM_PANEL, "gap-1")}>
            <Grab />
            <h2 className="m-0 px-1 pb-2 text-section font-semibold">{s.invite.open}</h2>
            <ChoiceRow icon={<SparkIcon size={22} />} round="bg-screen text-ink" label={s.invite.agent} hint={s.invite.agentHint} onClick={inviteAgent} />
            <ChoiceRow
              icon={<PersonIcon size={22} />}
              round="bg-knob-ink text-knob-ink-fg"
              label={s.invite.person}
              hint={s.invite.personHint}
              onClick={invitePerson}
              more
            />
            <button
              type="button"
              onClick={() => setChoosing(false)}
              className="mt-2 min-h-12 rounded-[12px] border-0 bg-screen text-copy text-ink-2"
            >
              {s.invite.cancel}
            </button>
          </div>
        </Sheet>
      ) : null}
      <InvitePeople
        open={searching}
        chat={chat}
        phone={phone}
        onClose={() => setSearching(false)}
        onBack={
          phone
            ? () => {
                setSearching(false);
                setChoosing(true);
              }
            : null
        }
      />
    </>
  );
}

const BOTTOM = "mx-0 mt-auto mb-0 w-full";
const BOTTOM_PANEL =
  "flex flex-col rounded-t-[18px] bg-body px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] plinth-sheet";

function Grab() {
  return <span aria-hidden="true" className="mx-auto mb-2 block h-[5px] w-[38px] rounded-full bg-lamp-off" />;
}

function ChoiceRow(p: { icon: ReactNode; round: string; label: string; hint: string; onClick: () => void; more?: boolean }) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      className="flex min-h-[72px] w-full items-center gap-3.5 rounded-[12px] border-0 bg-transparent px-2.5 py-3 text-left text-ink hover:bg-screen"
    >
      <span className={cx(ROUND, p.round)}>{p.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-copy font-semibold">{p.label}</span>
        <span className="text-cap text-ink-2">{p.hint}</span>
      </span>
      {p.more ? <ChevronIcon className="shrink-0 text-ink-3" /> : null}
    </button>
  );
}

type RowState = "busy" | InviteResponse["status"];

/** Можно ли уже звать: логин от двух знаков, «@» в начале не считается. */
export function searchable(query: string): string | null {
  const q = query.trim().replace(/^@/, "");
  return q.length >= 2 ? q : null;
}

/** В чате уже есть: писал сюда как человек (агентов по логину не ищут). */
export function alreadyInChat(chat: ChatDetail, login: string): boolean {
  const key = login.toLowerCase();
  return chat.participants.some((p) => !p.is_agent && p.author.toLowerCase() === key);
}

function InvitePeople(p: {
  open: boolean;
  chat: ChatDetail;
  phone: boolean;
  onClose: () => void;
  onBack: (() => void) | null;
}) {
  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      labelledBy="invite-person-title"
      dismissOnBackdrop
      className={p.phone ? BOTTOM : "mx-auto mt-[max(16px,8vh)] w-[min(460px,calc(100vw-28px))]"}
    >
      <PeopleSearch {...p} />
    </Sheet>
  );
}

// Итог приглашения и копирования пишем в самом листе: общая подсказка
// сверху экрана оказалась бы под его затемнением.
export function PeopleSearch({
  chat,
  phone,
  onClose,
  onBack,
  initial = "",
  initialResults = null,
}: {
  chat: ChatDetail;
  phone: boolean;
  onClose: () => void;
  onBack: (() => void) | null;
  /** Для тестов: готовая строка поиска и выдача без запроса. */
  initial?: string;
  initialResults?: Person[] | null;
}) {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<Person[] | null>(initialResults);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = useId();
  const q = searchable(query);

  useEffect(() => {
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    if (initialResults && q === searchable(initial)) return;
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api()
        .people(q)
        .then(
          (found) => alive && setResults(found),
          (e) => alive && setError(errorText(e)),
        )
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, initial, initialResults]);

  const invite = async (person: Person) => {
    setError(null);
    setNotice(null);
    setRows((r) => ({ ...r, [person.login]: "busy" }));
    try {
      const out = await api().invite(chat.repo, chat.chat_id, person.login);
      setRows((r) => ({ ...r, [person.login]: out.status }));
      setNotice(out.status === "invited" ? s.invite.sent(person.name ?? person.login) : null);
    } catch (e) {
      setRows((r) => {
        const next = { ...r };
        delete next[person.login];
        return next;
      });
      setError(errorText(e));
    }
  };

  const copyApp = () =>
    void copyText(location.origin).then((ok) => (ok ? setNotice(s.invite.appCopied) : setError(s.errors.copyFailed)));

  return (
    <div
      className={cx(
        "flex flex-col",
        phone ? cx(BOTTOM_PANEL, "h-[calc(100dvh-72px)]") : "max-h-[min(640px,84dvh)] rounded-[14px] bg-body px-5 pt-4 pb-5 plinth-sheet",
      )}
    >
      {phone ? <Grab /> : null}
      <div className="mb-3 flex items-center gap-1">
        {onBack ? (
          <button
            type="button"
            aria-label={s.invite.back}
            onClick={onBack}
            className="-ml-2 flex size-9 items-center justify-center rounded-[8px] border-0 bg-transparent text-ink-2"
          >
            <ChevronIcon left size={22} />
          </button>
        ) : null}
        <h2 id="invite-person-title" className="m-0 min-w-0 flex-1 text-section font-semibold">
          {s.invite.personTitle}
        </h2>
        {onBack ? null : (
          <button
            type="button"
            aria-label={s.toast.close}
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-[8px] border-0 bg-transparent text-[20px] text-ink-2 hover:bg-screen"
          >
            ×
          </button>
        )}
      </div>
      <label className="flex min-h-12 shrink-0 items-center gap-2.5 rounded-[12px] bg-screen px-3.5">
        <SearchIcon className="shrink-0 text-ink-3" />
        <span className="sr-only-text">{s.invite.search}</span>
        <input
          data-autofocus
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
            setNotice(null);
          }}
          placeholder={s.invite.search}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${ids}-state`}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-copy text-ink outline-none"
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <p id={`${ids}-state`} aria-live="polite" className={cx("m-0 px-1 pt-4 text-cap text-ink-2", !(q === null || loading) && "sr-only-text")}>
          {q === null ? s.invite.typeMore : loading ? s.invite.searching : results?.length ? s.invite.found : s.invite.nobody}
        </p>
        {q && results && results.length > 0 ? (
          <>
            <span className="scale px-1 pt-4 pb-1 text-ink-3">{s.invite.found}</span>
            {/* Пока ищем новое, прежняя выдача бледнеет, а не мигает. */}
            <ul className={cx("m-0 flex list-none flex-col p-0 transition-opacity", loading && "opacity-50")}>
              {results.map((person) => (
                <PersonRow
                  key={person.login}
                  person={person}
                  state={alreadyInChat(chat, person.login) ? "inChat" : rows[person.login] ?? null}
                  onInvite={() => void invite(person)}
                />
              ))}
            </ul>
          </>
        ) : null}
        {q && !loading && results && results.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-3 py-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-screen text-ink-3">
              <PersonIcon size={24} />
            </span>
            <b className="text-copy">{s.invite.nobody}</b>
            <p className="m-0 text-cap text-ink-2">{s.invite.nobodyText(`@${q}`)}</p>
            <ActionKey onClick={copyApp} className="mt-2 self-stretch">
              {s.invite.copyApp}
            </ActionKey>
            <p className="m-0 text-cap text-ink-3">{s.invite.copyAppHint}</p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 px-1 pt-3 text-cap text-action-ink [overflow-wrap:anywhere]">
            {error}
          </p>
        ) : null}
      </div>

      <p role="status" className={cx("m-0 shrink-0 text-cap text-ink", notice && "mt-3 flex items-start gap-2 rounded-[12px] bg-screen px-3 py-2.5")}>
        {notice ? (
          <>
            <CheckIcon size={16} className="mt-px shrink-0 text-pilot" />
            {notice}
          </>
        ) : null}
      </p>
      <p className="m-0 mt-3 shrink-0 border-t border-line px-1 pt-3 text-cap text-ink-2">{s.invite.note}</p>
    </div>
  );
}

function PersonRow({ person, state, onInvite }: { person: Person; state: RowState | "inChat" | null; onInvite: () => void }) {
  const name = person.name ?? person.login;
  return (
    <li className="flex items-center gap-3 border-b border-line px-1 py-2.5 last:border-b-0">
      {person.avatar_url ? (
        <img src={person.avatar_url} alt="" className="size-10 shrink-0 rounded-full bg-knob-ink" />
      ) : (
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-knob-ink text-[14px] font-semibold text-knob-ink-fg">
          {initials(person.login, name)}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-copy font-semibold">{name}</span>
        <span className="truncate text-cap text-ink-2">@{person.login}</span>
      </span>
      {state === "inChat" ? (
        <span className="shrink-0 text-cap text-ink-3">{s.invite.inChat}</span>
      ) : state === "invited" || state === "member" ? (
        <span className="flex shrink-0 items-center gap-1.5 text-cap font-semibold text-ink-2">
          <CheckIcon size={16} />
          {state === "invited" ? s.invite.invited : s.invite.member}
        </span>
      ) : (
        <button
          type="button"
          disabled={state === "busy"}
          onClick={onInvite}
          aria-label={`${s.invite.invite}: ${name}`}
          className="min-h-9 shrink-0 rounded-[9px] border border-line bg-transparent px-3.5 text-cap font-semibold text-action-ink hover:bg-screen disabled:text-ink-3"
        >
          {state === "busy" ? s.invite.inviting : s.invite.invite}
        </button>
      )}
    </li>
  );
}
