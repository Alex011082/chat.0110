import { useEffect, useRef, useState } from "react";
import { ActionKey, Body, Key, Lamp, Mark, Screen } from "../ui/kit.tsx";
import { LanguageSwitch } from "../ui/LanguageSwitch.tsx";
import {
  agentCards,
  endpoint,
  participationTask,
  connectionInstructions,
  type AgentCard,
} from "../lib/agent-catalog.ts";
import { s } from "../strings.ts";

type Connection = { authorized: boolean; connected: boolean };
type Filter = "all" | "chat" | "code";
const coding = new Set(["codex", "claude-code", "grok-build"]);

export function ConnectAgents() {
  const en = s.locale === "en";
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/connections", {
          credentials: "same-origin",
        });
        if (!alive) return;
        if (response.status === 401) {
          setConnection(null);
          setStatusError(false);
          return;
        }
        if (!response.ok) throw new Error("status");
        const value = await response.json();
        if (alive) {
          setConnection(value.chatgpt);
          setStatusError(false);
        }
      } catch {
        if (alive) setStatusError(true);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);
  const params = new URLSearchParams(location.search);
  const repo = params.get("repo") ?? "",
    chat = params.get("chat") ?? "";
  const context =
    /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) &&
    /^\d{8}-[a-z0-9]{4}$/.test(chat)
      ? { repo, chat_id: chat }
      : null;
  const cards = agentCards(en);
  const visible = cards.filter(
    (card) =>
      (filter === "all" || (filter === "code") === coding.has(card.id)) &&
      `${card.name} ${card.id} ${card.role}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 2400);
    } catch {
      setCopyError(true);
    }
  };
  const task = (card: AgentCard) => participationTask(card, en, context);
  const bundle = (card: AgentCard) => connectionInstructions(card, en, context);
  const copiedLabel = (id: string, label: string) =>
    copied === id ? (en ? "Copied" : "Скопировано") : label;
  const signedIn = connection !== null;
  return (
    <main className="min-h-dvh bg-ground px-4 py-6 text-ink tab:px-8 tab:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-7">
        <header className="flex items-center justify-between gap-4">
          <a href="/" aria-label="CHAT.0110">
            <Mark cell={3} />
          </a>
          <LanguageSwitch />
        </header>
        <div className="flex flex-col gap-3 tab:flex-row tab:items-end tab:justify-between">
          <div className="max-w-2xl">
            <h1 className="m-0 mb-3 text-title font-semibold">
              {en
                ? "Your AI, in one conversation"
                : "Твои ИИ — в одном разговоре"}
            </h1>
            <p className="m-0 text-copy text-ink-2">
              {en
                ? "Choose an app, add CHAT.0110 and invite a session. Then send tasks with @ and bring in a second opinion with @@."
                : "Выбери приложение, добавь CHAT.0110 и пригласи сессию. Затем отправляй задания через @, а через @@ подключай второго участника."}
            </p>
          </div>
          <a className="shrink-0 py-2 text-cap text-ink-2" href="/">
            {en ? "Back to chats" : "Вернуться к чатам"}
          </a>
        </div>
        <Body className="grid gap-6 p-5 pb-7 tab:grid-cols-[1fr_auto] tab:items-center tab:p-6 tab:pb-8">
          <div className="min-w-0">
            <h2 className="m-0 mb-2 text-section font-semibold">
              {en ? "One connection address" : "Один адрес подключения"}
            </h2>
            <p className="m-0 mb-4 max-w-2xl text-cap text-ink-2">
              {en
                ? "Runs on your CHAT.0110 server. No additional service or API key. Your AI app's own access and usage limits still apply."
                : "Работает на твоём сервере CHAT.0110. Без дополнительного сервиса и ключей API. Действуют доступ и лимиты самого приложения ИИ."}
            </p>
            <code className="break-all text-copy">{endpoint}</code>
          </div>
          <Key onClick={() => void copy("endpoint", endpoint)}>
            {copiedLabel(
              "endpoint",
              en ? "Copy MCP address" : "Скопировать адрес MCP",
            )}
          </Key>
        </Body>
        <section
          aria-label={
            en ? "ChatGPT connection status" : "Состояние подключения ChatGPT"
          }
          className="flex flex-col gap-4 border-b border-line pb-6 tab:flex-row tab:items-center tab:justify-between"
        >
          <div className="flex gap-3">
            <Lamp
              state={
                connection?.connected
                  ? "live"
                  : connection?.authorized
                    ? "act"
                    : "off"
              }
              className="mt-1.5"
            />
            <div>
              <p className="m-0 text-copy font-semibold">
                {statusError
                  ? en
                    ? "Connection status unavailable"
                    : "Не удалось проверить подключение"
                  : connection?.connected
                    ? en
                      ? "ChatGPT is listening"
                      : "ChatGPT принимает события"
                    : connection?.authorized
                      ? en
                        ? "ChatGPT connected. Start participation."
                        : "ChatGPT подключён. Запусти участие."
                      : signedIn
                        ? en
                          ? "Connect ChatGPT to get started"
                          : "Подключи ChatGPT, чтобы начать"
                        : en
                          ? "Sign in to see connection status"
                          : "Войди, чтобы увидеть подключения"}
              </p>
              <p className="m-0 mt-1 max-w-2xl text-cap text-ink-2">
                {statusError
                  ? en
                    ? "We'll retry automatically. The setup cards are still available."
                    : "Повторим проверку автоматически. Карточки подключения доступны ниже."
                  : connection?.connected
                    ? en
                      ? "Addressed turns are delivered to the subscribed Work conversation."
                      : "Адресованные ходы доставляются в подписанный Work-разговор."
                    : connection?.authorized
                      ? en
                        ? "Copy the task and send it to a ChatGPT Work conversation with Cloud selected and CHAT.0110 enabled."
                        : "Скопируй задание и отправь его в Work-разговор ChatGPT: выбери Cloud и включи CHAT.0110."
                      : en
                        ? "Adding the server and starting participation are two separate steps."
                        : "Добавление сервера и запуск участия — два отдельных шага."}
              </p>
            </div>
          </div>
          {connection?.authorized && !connection.connected ? (
            <ActionKey
              className="shrink-0"
              onClick={() => void copy("start-chatgpt", task(cards[0]!))}
            >
              {copiedLabel(
                "start-chatgpt",
                en ? "Copy start task" : "Скопировать задание запуска",
              )}
            </ActionKey>
          ) : !signedIn && !statusError ? (
            <Key
              onClick={() => {
                const next = "/connect" + location.search;
                location.href = "/auth/login?next=" + encodeURIComponent(next);
              }}
            >
              {en ? "Sign in with GitHub" : "Войти через GitHub"}
            </Key>
          ) : null}
        </section>
        <div role="status" aria-live="polite" className="sr-only">
          {copied
            ? en
              ? "Copied to clipboard"
              : "Скопировано в буфер обмена"
            : ""}
        </div>
        {copyError ? (
          <p role="alert" className="m-0 text-copy text-action-ink">
            {en
              ? "Copy failed. Open the instructions below and select the text manually."
              : "Не удалось скопировать. Открой инструкцию в карточке и выдели текст вручную."}
          </p>
        ) : null}
        <section aria-labelledby="apps-title">
          <div className="mb-5 flex flex-col gap-4 tab:flex-row tab:items-center tab:justify-between">
            <h2 id="apps-title" className="m-0 text-section font-semibold">
              {en ? "Choose your application" : "Выбери своё приложение"}
            </h2>
            <div className="flex flex-col gap-3 tab:flex-row tab:items-center">
              <div
                className="flex gap-1"
                role="group"
                aria-label={en ? "Application type" : "Тип приложения"}
              >
                {(
                  [
                    ["all", en ? "All" : "Все"],
                    ["chat", en ? "Conversations" : "Чаты"],
                    ["code", en ? "Coding" : "Кодинг"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={`min-h-10 rounded-full border-0 px-4 text-cap ${filter === id ? "bg-slot text-ink shadow-recess" : "bg-transparent text-ink-2"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="agent-search">
                {en ? "Find an application" : "Найти приложение"}
              </label>
              <input
                id="agent-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={en ? "Find an application" : "Найти приложение"}
                className="slot min-h-10 w-full rounded-slot border-0 bg-slot px-4 text-cap text-ink shadow-recess tab:w-48"
              />
            </div>
          </div>
          <div className="grid gap-5 tab:grid-cols-2">
            {visible.map((card) => (
              <Body
                key={card.id}
                className="flex min-w-0 flex-col gap-5 p-5 pb-7 tab:p-6 tab:pb-8"
              >
                <header>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="m-0 text-section font-semibold">
                      {card.name}
                    </h3>
                    <code className="rounded-full bg-slot px-3 py-1 text-cap text-ink-2">
                      {card.id === "other-ai" ? "GitHub" : "@" + card.id}
                    </code>
                  </div>
                  <p className="m-0 text-cap text-ink-2">{card.mode}</p>
                </header>
                <p className="m-0 text-copy text-ink-2">{card.setup}</p>
                <Screen className="px-4 py-3">
                  <pre className="m-0 whitespace-pre-wrap break-all text-cap leading-relaxed">
                    {card.command}
                  </pre>
                </Screen>
                <div className="mt-auto flex flex-col gap-3">
                  <Key
                    onClick={() => void copy(card.id + "-all", bundle(card))}
                  >
                    {copiedLabel(
                      card.id + "-all",
                      en
                        ? "Copy full instructions"
                        : "Скопировать всю инструкцию",
                    )}
                  </Key>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    {card.id !== "other-ai" ? (
                      <button
                        type="button"
                        className="min-h-10 border-0 bg-transparent p-0 text-cap text-ink-2 underline underline-offset-4"
                        onClick={() =>
                          void copy(
                            card.id + "-setup",
                            card.id === "other-ai" ? task(card) : card.command,
                          )
                        }
                      >
                        {copiedLabel(
                          card.id + "-setup",
                          coding.has(card.id)
                            ? en
                              ? "Copy commands"
                              : "Только команды"
                            : card.id === "other-ai"
                              ? en
                                ? "Copy task"
                                : "Только задание"
                              : en
                                ? "Copy address"
                                : "Только адрес",
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="min-h-10 border-0 bg-transparent p-0 text-cap text-ink-2 underline underline-offset-4"
                      onClick={() => void copy(card.id + "-task", task(card))}
                    >
                      {copiedLabel(
                        card.id + "-task",
                        en ? "Copy participation task" : "Только задание",
                      )}
                    </button>
                  </div>
                  <details className="border-t border-line pt-2">
                    <summary className="min-h-10 cursor-pointer py-2 text-cap text-ink-2">
                      {en
                        ? "View task and connection guide"
                        : "Посмотреть задание и инструкцию"}
                    </summary>
                    <p className="text-cap leading-relaxed text-ink-2">
                      {task(card)}
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <a
                        className="py-2 text-cap text-ink-2"
                        href={card.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {en
                          ? "Open connection settings / guide"
                          : "Открыть подключение"}
                      </a>
                      <a
                        className="py-2 text-cap text-ink-2"
                        href={card.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {en ? "Official documentation" : "Документация"}
                      </a>
                    </div>
                  </details>
                </div>
              </Body>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="py-8 text-copy text-ink-2">
              {en
                ? "No matching applications. Clear the search or choose All."
                : "Подходящих приложений нет. Очисти поиск или выбери «Все»."}
            </p>
          ) : null}
        </section>
        <footer className="max-w-3xl pb-6 text-cap leading-relaxed text-ink-2">
          <p>
            {en
              ? "ChatGPT Work receives automatic events after subscribing. Claude Code supports a live local channel. Other clients participate while their task is active; background wake-up depends on the app."
              : "ChatGPT Work получает автоматические события после подписки. Для Claude Code есть живой локальный канал. Остальные клиенты участвуют, пока их задача активна; фоновое пробуждение зависит от приложения."}
          </p>
          <p>
            {en
              ? "Different sessions get different names. If several Claude or Codex sessions are connected, use the exact session name in your mention."
              : "У разных сессий — разные имена. Если подключено несколько сессий Claude или Codex, укажи в обращении точное имя нужной сессии."}
          </p>
        </footer>
      </div>
    </main>
  );
}
