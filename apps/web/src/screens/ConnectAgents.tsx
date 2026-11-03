import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canonicalMention, MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import { ActionKey, Body, Key, Lamp, Mark, Screen } from "../ui/kit.tsx";
import { LanguageSwitch } from "../ui/LanguageSwitch.tsx";
import { agentCards, endpoint,type ChatContext } from "../lib/agent-catalog.ts";
import { connectContext, mcpSetupCommand, mcpPackageUrl,sessionSetupTask } from "../lib/mcp-setup.ts";
import { dispatchRequest } from "../dispatch.ts";
import { api } from "../api.ts";
import type { AutoReplyView } from "../lib/auto-replies.ts";
import { s } from "../strings.ts";

type Connections = { chatgpt: { authorized: boolean; connected: boolean; last_error: string | null }; local?: { authorized: boolean } };

/** Установка, допуск аккаунта и ответ сессии — три разных проверяемых результата. */
export function ConnectAgents({chatContext,initialClient,embedded=false}:{chatContext?:ChatContext;initialClient?:string;embedded?:boolean}={}) {
  const en = s.locale === "en";
  const [showClients,setShowClients]=useState(!initialClient);
  const search = typeof location === "undefined" ? "" : location.search;
  const context = useMemo(() => chatContext??connectContext(search), [search,chatContext]);
  const [selected, setSelected] = useState(() => {
    const hash = typeof location === "undefined" ? "" : location.hash.slice(1);
    return initialClient??(hash === "claude" ? "claude-code" : hash || "codex");
  });
  const cards = agentCards(en), card = cards.find(c => c.id === selected) ?? cards.find(c => c.id === "codex")!;
  const command = mcpSetupCommand(card), terminal = !!command;
  const [connections, setConnections] = useState<Connections | null>(null);
  const [view, setView] = useState<AutoReplyView | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState(false);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [sessionChoice, setSessionChoice] = useState("");
  const pendingProbe = useRef<{ key: string; request_id: string; text: string } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const back = context ? `/${context.repo}/${context.chat_id}` : "/";
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/connections", { credentials: "same-origin", signal });
      if (signal?.aborted) return;
      if (response.status === 401) { setConnections(null); setView(null); setError(false); return; }
      if (!response.ok) throw Error("status");
      const value = await response.json();
      const state = context ? await dispatchRequest(`${context.repo}/${context.chat_id}`) : null;
      if (!signal?.aborted) { setConnections(value); setView(state as AutoReplyView | null); setError(false); }
    } catch { if (!signal?.aborted) setError(true); }
  }, [context]);
  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal);
    const timer = setInterval(() => void refresh(abort.signal), 5000);
    return () => { abort.abort(); clearInterval(timer); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [refresh]);
  const sessions = view?.sessions.filter(session => card.id === "other-ai" ? !["codex", "claude", "chatgpt", "grok"].includes(canonicalMention(session.author)) : canonicalMention(session.author) === card.role) ?? [];
  const target = sessions.find(session => session.id === sessionChoice) ?? (sessions.length === 1 ? sessions[0] : null);
  const chain = view?.chains.find(c => c.message_id === probeMessage);
  const authorized = terminal ? connections?.local?.authorized : card.id === "chatgpt" ? connections?.chatgpt.authorized : null;
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text); setCopied(id); setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 2200);
    } catch { setCopyError(true); }
  };
  const probe = async () => {
    if (!context || !target?.auto_enabled || probing) return;
    setProbing(true); setProbeError(false);
    const key = `${context.repo}/${context.chat_id}/${target.id}`;
    const request = pendingProbe.current?.key === key ? pendingProbe.current : {
      key, request_id: crypto.randomUUID(),
      text: `@${target.alias} ${en ? "Connection test. Reply here with the exact code" : "Проверка подключения. Ответь в этот чат точным кодом"}: MCP-${crypto.randomUUID().slice(0, 8)}. ${en ? "Do not change files or run other tasks." : "Не меняй файлы и не выполняй других задач."}`,
    };
    pendingProbe.current = request;
    try {
      const response = await api().postMessage(context.repo, context.chat_id, { text: request.text, request_id: request.request_id });
      setProbeMessage(response.item.id); pendingProbe.current = null;
      await refresh();
    } catch { setProbeError(true); }
    finally { setProbing(false); }
  };
  return (
    <main className={embedded?"bg-ground p-4 text-ink tab:p-6":"min-h-dvh bg-ground px-4 py-6 text-ink tab:px-8 tab:py-10"}>
      <div className="mx-auto flex max-w-5xl flex-col gap-7">
        {!embedded?<header className="flex flex-wrap items-center justify-between gap-4">
          <a href={back} aria-label="CHAT.0110"><Mark cell={3} /></a>
          <div className="flex items-center gap-5"><a href={back} className="py-2 text-cap text-ink-2">{en ? "Back to chat" : "Вернуться в чат"}</a><LanguageSwitch /></div>
        </header>:null}
        <div>
          <h1 className="m-0 text-title font-semibold tracking-[-0.03em]">{en ? "Connect your AI" : "Подключить ИИ"}</h1>
          <p className="mb-0 mt-3 text-copy text-ink-2">{en ? "Choose your app. Install the MCP server once and authorize access to CHAT.0110." : "Выбери приложение. Один раз установи MCP-сервер и разреши доступ к CHAT.0110."}</p>
          {context?<p className="mb-0 mt-3 text-copy [overflow-wrap:anywhere]">{en?"This connection is for":"Подключение для"} <strong>{context.repo}</strong><br/>{en?"Chat":"Чат"}: {context.chat_id}</p>:null}
        </div>
        <section aria-labelledby="client-heading" className="flex min-w-0 flex-col gap-3">
          {showClients?<>
          <h2 id="client-heading" className="m-0 text-section font-semibold">{en ? "Where does your AI run?" : "Где работает твой ИИ?"}</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label={en ? "AI application" : "Приложение ИИ"}>
            {cards.map(item => <Key key={item.id} aria-pressed={item.id === card.id} onClick={() => { setSelected(item.id); setCopied(""); setProbeMessage(null); setProbeError(false); }} style={item.id === card.id ? { background: "var(--screen)", boxShadow: "inset 0 2px 4px var(--line)" } : undefined}>{item.id === "other-ai" ? en ? "Another MCP client" : "Другой MCP-клиент" : item.name}</Key>)}
          </div>
          </>:<div className="flex flex-wrap items-center justify-between gap-3"><h2 id="client-heading" className="m-0 text-section font-semibold">{card.name}</h2><Key onClick={()=>setShowClients(true)}>{en?"Change app":"Другое приложение"}</Key></div>}
        </section>
        <Body className="flex min-w-0 flex-col gap-5 p-5 pb-7 tab:p-7 tab:pb-9">
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-section font-semibold">{terminal ? en ? `${card.name}: one terminal command` : `${card.id === "other-ai" ? "Другой клиент" : card.name}: одна команда в терминале` : en ? `${card.name}: add an MCP server` : `${card.name}: добавь MCP-сервер`}</h2>
            <p className="m-0 text-copy text-ink-2">{terminal ? en ? "Run this in the terminal available to your agent. It installs a real stdio MCP server and prints the GitHub authorization link." : "Выполни в терминале, доступном твоему агенту. Команда установит настоящий stdio MCP-сервер и покажет ссылку для входа через GitHub." : en ? "This web app has no terminal. Add this address in its connector settings, select OAuth and authorize GitHub access." : "В веб-приложении нет терминала. Добавь этот адрес в настройках коннекторов, выбери OAuth и разреши доступ через GitHub."}</p>
          </div>
          <Screen as="div" className="m-0 min-w-0 whitespace-pre-wrap px-4 py-4 text-key leading-relaxed [overflow-wrap:anywhere]"><code>{command ?? endpoint}</code></Screen>
          <div className="flex flex-wrap items-center gap-3">
            <ActionKey onClick={() => void copy("main", command ?? endpoint)}>{copied === "main" ? en ? "Copied" : "Скопировано" : terminal ? en ? "Copy command" : "Скопировать команду" : en ? "Copy MCP address" : "Скопировать адрес MCP"}</ActionKey>
            {!terminal ? <a href={card.url} target="_blank" rel="noreferrer" className="py-2 text-key text-action-ink">{en ? "Open connector settings" : "Открыть настройки подключения"} ↗</a> : null}
          </div>
          <p className="m-0 text-cap text-ink-2">{terminal ? en ? "Requires Node.js 22+ (includes npx). No repository clone, Bun, gh or paid API keys. Your existing sessions are not restarted." : "Нужен Node.js 22+ (с npx). Без клонирования репозитория, Bun, gh и платных API-ключей. Текущие сессии не перезапускаются." : en ? "Runs on CHAT.0110. Your AI subscription's normal limits apply. A connector does not grant permission to perform unrelated work." : "Работает на сервере CHAT.0110. Действуют обычные лимиты твоей подписки ИИ. Подключение не разрешает посторонние действия."}</p>
          {card.id === "other-ai" ? <p className="m-0 text-cap text-ink-2">{en ? "For clients without a supported installation CLI, the command prints a ready mcpServers configuration. Paste it into your client's MCP settings." : "Для клиента без поддерживаемой команды установки появится готовый блок mcpServers. Вставь его в настройки MCP своего приложения."}</p> : null}
        </Body>
        {copyError ? <p role="alert" className="m-0 text-copy text-action-ink">{en ? "Copy failed. Select the command above manually." : "Не удалось скопировать. Выдели команду выше вручную."}</p> : null}
        <section className="flex flex-col gap-3" aria-labelledby="delivery-heading">
          <h2 id="delivery-heading" className="m-0 text-section font-semibold">{en ? "How replies reach this chat" : "Как ответы попадут в чат"}</h2>
          <p className="m-0 text-copy text-ink-2">{card.id === "claude-code" ? en ? "For automatic events in an open Claude Code session, authorize the chat0110-local channel. A connection probe must be acknowledged by that session. Installing MCP alone does not approve a channel." : "Для автоматических событий в открытой сессии Claude Code разреши канал chat0110-local. Сессия должна подтвердить пробное событие. Установка MCP сама по себе не даёт допуск каналу." : card.id === "chatgpt" ? en ? "In ChatGPT Work, enable CHAT.0110 and subscribe to addressed turns. An active subscription means the event route exists; only a reply proves that the AI handled a turn." : "В ChatGPT Work включи CHAT.0110 и подписку на адресованные ходы. Активная подписка означает наличие маршрута событий; обработку хода доказывает только ответ ИИ." : en ? "MCP tools work while the AI session is active. For automatic wake-up, the application must support an event channel or a verified host adapter. Installing a server cannot add that capability to the application." : "MCP-инструменты работают в активной сессии ИИ. Для автоматического пробуждения приложению нужен канал событий или проверенный host-адаптер. Установка сервера не добавляет эту возможность самому приложению."}</p>
          {terminal ? <p className="m-0 text-cap text-ink-2">{en ? "After installation, refresh the MCP tools in your existing session. Its chat0110_connect tool joins that session to a chosen chat. Other open sessions are not joined automatically." : "После установки обнови MCP-инструменты в своей существующей сессии. Инструмент chat0110_connect подключает именно её к выбранному чату. Остальные открытые сессии автоматически не подключаются."}</p> : null}
        </section>
        <section aria-labelledby="check-heading" className="flex flex-col gap-4 border-y border-line py-6">
          {context?<><h3 className="m-0 text-section font-semibold">{en?"Send this to the session that should answer":"Отправь в ту сессию, которая должна отвечать"}</h3>
            <p className="m-0 text-cap text-ink-2">{en?"The repository and chat identify the conversation. The session ID returned at connection identifies the recipient. Requests never go to an arbitrary session of the same model.":"Репозиторий и чат определяют разговор. Полученный при подключении session_id определяет адресата. Запрос не уходит в случайную сессию той же модели."}</p>
            <Key className="self-start" onClick={()=>void copy("participation",sessionSetupTask(card,en,context))}>{copied==="participation"?(en?"Copied":"Скопировано"):(en?"Copy request for this session":"Скопировать запрос для этой сессии")}</Key>
            <details className="text-cap text-ink-2"><summary className="cursor-pointer py-2">{en?"Show request":"Показать запрос"}</summary><pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">{sessionSetupTask(card,en,context)}</pre></details>
          </>:null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="check-heading" className="m-0 text-section font-semibold">{en ? "Check the connection" : "Проверить подключение"}</h2>
            <Key disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}>{refreshing ? en ? "Checking…" : "Проверяем…" : en ? "Refresh status" : "Обновить статус"}</Key>
          </div>
          {context ? <a className="text-cap text-ink-2 [overflow-wrap:anywhere]" href={back}>{context.repo} · {context.chat_id}</a> : <p className="m-0 text-cap text-ink-2">{en ? "Open this page from a chat to check its participant and send a test." : "Открой эту страницу из чата, чтобы проверить его участника и отправить тест."}</p>}
          {error ? <p role="alert" className="m-0 text-cap text-action-ink">{en ? "Status unavailable. Retrying; this does not mean the agent is connected." : "Статус недоступен. Повторяем проверку; это не означает, что агент подключён."}</p> : !connections ? <a href={`/auth/login?next=${encodeURIComponent("/connect" + search)}`} className="py-2 text-key text-action-ink">{en ? "Sign in with GitHub to see status" : "Войти через GitHub для проверки статуса"}</a> : <>
            <p className="m-0 flex items-center gap-3 text-copy"><Lamp state="off" />{authorized === null ? en ? "Check OAuth authorization in your AI app" : "Проверь разрешение OAuth в своём приложении ИИ" : authorized ? en ? "Account authorized · session readiness is checked separately" : "Доступ аккаунта разрешён · готовность сессии проверяется отдельно" : en ? "This connection has not authorized the account yet" : "Аккаунт ещё не разрешил это подключение"}</p>
            {context && view ? <>
              <p className="m-0 text-copy">{!sessions.length ? en ? "This AI has not joined this chat yet" : "Этот ИИ ещё не подключил свою сессию к чату" : target ? `${target.name} · @${target.alias}` : en ? "Select the exact session" : "Выбери точную сессию"}</p>
              {sessions.length > 1 ? <label className="flex max-w-xl flex-col gap-2 text-cap">{en ? "AI session" : "Сессия ИИ"}<select value={target?.id ?? ""} onChange={e => { setSessionChoice(e.target.value); setProbeMessage(null); setProbeError(false); }} className="min-h-10 min-w-0 rounded-slot border border-line bg-slot px-3 text-ink"><option value="">{en ? "Choose a session" : "Выбери сессию"}</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.name} · @{session.alias}</option>)}</select></label> : null}
              {card.id === "chatgpt" ? <p className="m-0 text-cap text-ink-2">{connections.chatgpt.last_error ? en ? "Event delivery failed. Reconnect the ChatGPT subscription." : "Ошибка доставки событий. Восстанови подписку ChatGPT." : connections.chatgpt.connected ? en ? "Event subscription active · a reply has not been verified by this check" : "Подписка на события активна · ответ этой проверкой ещё не подтверждён" : en ? "No active ChatGPT event subscription" : "Нет активной подписки ChatGPT на события"}</p> : null}
              {!view.chains.length ? <p className="m-0 text-cap text-ink-2">{en ? "No addressed turns have been created in this chat yet. A plain @ without a recipient does not trigger an AI." : "В этом чате пока не создано адресованных ходов. Один символ @ без адресата не вызывает ИИ."}</p> : null}
              <div className="flex flex-wrap items-center gap-3"><Key disabled={!target?.auto_enabled || probing} onClick={() => void probe()}>{probing ? en ? "Sending…" : "Отправляем…" : en ? "Send a test to this chat" : "Отправить тест в этот чат"}</Key><span className="text-cap text-ink-2">{en ? "Publishes one short request to the selected AI." : "Опубликует один короткий запрос выбранному ИИ."}</span></div>
              {target && !target.auto_enabled ? <p className="m-0 text-cap text-ink-2">{en ? "Enable this participant's automatic replies in the chat first." : "Сначала включи автоответы этого участника в чате."}</p> : null}
              {probeError ? <p role="alert" className="m-0 text-cap text-action-ink">{en ? "Sending failed. Retry: the same request will not create a duplicate." : "Не удалось отправить. Повтори: тот же запрос не создаст дубликат."}</p> : null}
              {probeMessage ? <p role="status" className="m-0 text-copy">{chain?.status === "done" ? en ? "The AI completed the test. Read its answer in the chat." : "ИИ завершил тест. Прочитай его ответ в чате." : chain?.status === "running" ? en ? "The AI claimed the test turn; waiting for its answer." : "ИИ получил тестовый ход; ждём ответ." : chain && ["expired", "cancelled", "interrupted", "needs_owner"].includes(chain.status) ? en ? "Test stopped or delivery interrupted. Check the participant in the chat." : "Тест остановлен или доставка прервалась. Проверь участника в чате." : en ? "Test published; waiting for the AI to receive it." : "Тест опубликован; ждём получения ИИ."}</p> : null}
            </> : null}
          </>}
        </section>
        <details className="text-cap text-ink-2"><summary className="cursor-pointer py-2">{en ? "MCP address, package and technical details" : "Адрес MCP, пакет и технические сведения"}</summary><div className="mt-3 flex flex-col items-start gap-3">
          <code className="[overflow-wrap:anywhere]">{endpoint}</code><Key onClick={() => void copy("endpoint", endpoint)}>{copied === "endpoint" ? en ? "Copied" : "Скопировано" : en ? "Copy address" : "Скопировать адрес"}</Key>
          <a href={mcpPackageUrl} className="py-1 text-action-ink">Node stdio MCP · {MCP_PACKAGE_VERSION} · .tgz</a>
          <a href="/plugins" className="py-1 text-action-ink">{en ? "Plugin packages" : "Пакеты плагинов"}</a>
          <p className="m-0">{en ? "The CLI registers chat0110-local without removing other servers. OAuth credentials stay in a private local file. CHAT.0110 remains on the server; no incoming port is exposed on your computer." : "CLI регистрирует chat0110-local, не удаляя другие серверы. OAuth хранится в приватном локальном файле. CHAT.0110 остаётся на сервере; входящий порт компьютера наружу не открывается."}</p>
        </div></details>
        <div role="status" aria-live="polite" className="sr-only-text">{copied ? en ? "Copied to clipboard" : "Скопировано в буфер обмена" : ""}</div>
      </div>
    </main>
  );
}
