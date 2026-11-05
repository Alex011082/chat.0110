import { canonicalMention, MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import type { AgentCard, ChatContext } from "./agent-catalog.ts";

export type McpTransport = "remote" | "local";
export type SessionTransport = McpTransport;
export type ExistingParticipant = { id: string; alias: string; name: string; author: string };
export type SessionSetupOptions = { transport?: SessionTransport; existing?: ExistingParticipant | null; newParticipant?: boolean };
type SetupAction =
  | { mode: "choose"; request?: never; expected?: never }
  | { mode: "blocked"; request?: never; expected?: never }
  | { mode: "resume"; request: { name: "chat0110_status"; arguments: { session_id: string } }; expected: { repo: string; chat: string; author: string; alias: string; id: string } }
  | { mode: "create"; request: { name: "chat0110_connect"; arguments: { repo: string; chat_id: string; author: string; alias: string; name: string } }; expected?: never };

export const mcpPackageUrl = `https://chat.0110.digital/downloads/chat0110-mcp-${MCP_PACKAGE_VERSION}.tgz`;
export function terminalClient(card: Pick<AgentCard, "id">): string | null {
  return ["codex", "claude-code", "grok-build"].includes(card.id) ? card.id : card.id === "other-ai" ? "other" : null;
}
export function mcpSetupCommand(card: Pick<AgentCard, "id">, transport: SessionTransport = "remote"): string | null {
  const client = transport === "local" ? terminalClient(card) : null;
  return client ? `npx --yes --package=${mcpPackageUrl} chat0110 setup --client ${client}` : null;
}
export function connectContext(search: string): ChatContext | null {
  const p = new URLSearchParams(search), repo = p.get("repo") ?? "", chat_id = p.get("chat") ?? "";
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) && /^\d{8}-[a-z0-9]{4}$/.test(chat_id) ? { repo, chat_id } : null;
}

/** Выбор участника не регистрирует и не переключает сессии. */
export function sessionSetupAction(card: AgentCard, context: ChatContext, options: SessionSetupOptions = {}): SetupAction {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(context.repo) || !/^\d{8}-[a-z0-9]{4}$/.test(context.chat_id))
    throw new Error("Нужен точный репозиторий и чат");
  const existing = options.existing;
  if (existing) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing.id) || !existing.alias.trim() || canonicalMention(existing.author) !== card.role || options.newParticipant)
      throw new Error("Выбери прежнюю сессию именно этого приложения");
    if (options.transport === "local") return { mode: "blocked" };
    return {
      mode: "resume",
      request: { name: "chat0110_status", arguments: { session_id: existing.id } },
      expected: { repo: context.repo, chat: context.chat_id, author: card.role, alias: existing.alias, id: existing.id },
    };
  }
  if (!options.newParticipant) return { mode: "choose" };
  return {
    mode: "create",
    request: { name: "chat0110_connect", arguments: { ...context, author: card.role, alias: `${card.id}-${context.chat_id.slice(-4)}`, name: `${card.name} · ${context.repo.split("/")[1]}` } },
  };
}

/** Каталог проверяется до регистрации; сохранённая конфигурация его не заменяет. */
export function sessionSetupPreflight(card: Pick<AgentCard, "id">, en: boolean, transport: SessionTransport = "remote"): string {
  if (transport === "local" && terminalClient(card)) return en
    ? "You explicitly selected the separate local transport. Inspect this session's chat0110-local tools: connect, status, set_auto_reply, next, context and reply must be available. Use their exposed schemas. If missing, stop before registration; do not switch to another connector silently. "
    : "Явно выбран отдельный локальный транспорт. Проверь инструменты chat0110-local этой сессии: connect, status, set_auto_reply, next, context и reply. Используй доступные схемы. Если инструментов нет, остановись до регистрации; молча другой коннектор не выбирай. ";
  return en
    ? "Inspect this session's remote CHAT.0110 catalog before connecting. It must expose account, connect, pending, status, set_auto_reply, take, context and reply with the chat0110_ prefix. pending requires session_id; status and set_auto_reply accept that exact session_id; reply accepts task_id, claim, text and outcome (continue, complete, needs_owner). If definitions are stale, stop before registration. Refresh the existing private connection in its plugin settings; publisher MCPs → Issues → Rescan updates a published plugin and is a different operation. Preserve the connection and saved identity. Do not bypass schemas, reinstall a local server, revoke OAuth or create another alias. "
    : "До подключения проверь удалённый каталог CHAT.0110 именно этой сессии. Нужны account, connect, pending, status, set_auto_reply, take, context и reply с префиксом chat0110_. У pending обязателен session_id; status и set_auto_reply принимают точный session_id; reply принимает task_id, claim, text и outcome (continue, complete, needs_owner). Если определения устарели, остановись до регистрации. Обнови существующее личное подключение через Refresh в настройках плагина; publisher MCPs → Issues → Rescan обновляет опубликованный плагин и является другим действием. Сохрани подключение и прежнюю identity. Не обходи схемы, не устанавливай локальный сервер, не отзывай OAuth и не создавай другой alias. ";
}
export function sessionTurnInstructions(card: Pick<AgentCard, "id" | "role">, en: boolean, transport: SessionTransport = "remote"): string {
  if (transport === "local" && terminalClient(card)) return en
    ? "For the explicitly selected stateful stdio transport use chat0110_next → chat0110_context without arguments → one chat0110_reply. The local server stores the session and claim. Active waiting does not wake an idle application. "
    : "Для явно выбранного stateful stdio используй chat0110_next → chat0110_context без аргументов → один chat0110_reply. Сессию и claim хранит локальный сервер. Активное ожидание не пробуждает простаивающее приложение. ";
  if (card.id === "chatgpt") return en
    ? 'If the user requests monitoring and this ChatGPT host supports events, subscribe to chat0110.turn.ready with {"recipient":"chatgpt"}. On an addressed event use chat0110_take(task_id), chat0110_context(task_id,claim), then one chat0110_reply(task_id,claim,text,outcome). Otherwise report active-calls-only delivery. '
    : 'Если человек просит мониторинг и этот ChatGPT-хост поддерживает события, подпишись на chat0110.turn.ready с {"recipient":"chatgpt"}. При адресованном событии используй chat0110_take(task_id), chat0110_context(task_id,claim), затем один chat0110_reply(task_id,claim,text,outcome). Иначе сообщи, что доставка работает только при активных вызовах. ';
  const args = JSON.stringify({ author: card.role, session_id: "<session_id>", wait: true });
  return en
    ? `For remote MCP call chat0110_pending ${args}, replacing the placeholder with the exact saved session_id, while the session is active. Then take(task_id) → context(task_id,claim) → one reply(task_id,claim,text,outcome), all with the chat0110_ prefix. Remote MCP does not wake an idle or closed application. `
    : `Для remote MCP вызывай chat0110_pending ${args}, подставив точный сохранённый session_id, пока сессия активна. Затем take(task_id) → context(task_id,claim) → один reply(task_id,claim,text,outcome), все с префиксом chat0110_. Remote MCP не пробуждает простаивающее или закрытое приложение. `;
}
export function sessionSetupTask(card: AgentCard, en: boolean, context: ChatContext, options: SessionSetupOptions = {}): string {
  const action = sessionSetupAction(card, context, options);
  if (action.mode === "choose") return en
    ? "Choose the exact existing participant or explicitly choose to create a new one. Do not register a participant yet."
    : "Выбери точного прежнего участника либо явно выбери создание нового. Пока не регистрируй участника.";
  if (action.mode === "blocked") return en
    ? "This existing participant uses a different transport. Keep its identity and queue; do not reconnect it through a local server or create another alias."
    : "У прежнего участника другой транспорт. Сохрани его identity и очередь; не переподключай через локальный сервер и не создавай другой alias.";
  const preflight = sessionSetupPreflight(card, en, options.transport);
  const host = en
    ? `Use only this existing ${card.name} session. Confirm that the actual application author is ${card.role}; otherwise stop. Do not impersonate another host to enable delivery. `
    : `Используй только эту существующую сессию ${card.name}. Проверь, что автор фактического приложения — ${card.role}; иначе остановись. Не подменяй приложение ради доставки. `;
  if (action.mode === "resume") return preflight + host + (en
    ? `Check the existing participant selected from ${context.repo}, chat ${context.chat_id}: ${JSON.stringify(action.expected)}. Call only chat0110_status with ${JSON.stringify(action.request.arguments)}. Compare returned session.id, alias and author with the selected participant; status does not return repo/chat, which come from the authorized chat selector. On error or mismatch stop without registration, rebind or another alias. Keep name, model, enabled state, queued tasks and chains unchanged. Do not call connect, set_auto_reply, pending, take or reply during this check. Report registration, enabled intent and live delivery separately, then stop. Send this request only to the original session.`
    : `Проверь прежнего участника, выбранного в ${context.repo}, чат ${context.chat_id}: ${JSON.stringify(action.expected)}. Вызови только chat0110_status с ${JSON.stringify(action.request.arguments)}. Сравни session.id, alias и author из ответа с выбранным участником; repo/chat не возвращаются в status и берутся из авторизованного выбора чата. При ошибке или несовпадении остановись без регистрации, перепривязки и другого alias. Сохрани name, model, включение, задания и цепочки. Во время этой проверки не вызывай connect, set_auto_reply, pending, take или reply. Отдельно сообщи регистрацию, намерение участия и живую доставку, затем остановись. Этот запрос отправляй только прежней сессии.`);
  return preflight + host + (en
    ? `A new participant was explicitly requested for this chat. Call chat0110_connect with ${JSON.stringify(action.request.arguments)}. Set name to this session's readable title and model only to the actual known model. Save the returned session_id. On alias conflict stop; do not rebind or invent another alias. Read status using this transport's schema. Preserve owner off; do not enable participation without an explicit request. Report registration, enabled intent and live delivery separately. `
    : `Для этого чата явно выбрано создание нового участника. Вызови chat0110_connect с ${JSON.stringify(action.request.arguments)}. В name поставь понятное название этой сессии, в model — только фактическую известную модель. Сохрани возвращённый session_id. При конфликте alias остановись; не перепривязывай и не придумывай другой alias. Прочитай status по схеме этого транспорта. Сохрани owner off; не включай участие без явного запроса. Отдельно сообщи регистрацию, намерение участия и живую доставку. `) + sessionTurnInstructions(card, en, options.transport) + (en
    ? "Inspect prior effects on resumed tasks and never repeat completed work. The server schedules @@ and the final return. Do not start model polling, paid services or API keys."
    : "При resumed проверь прежние эффекты; завершённую работу не повторяй. Сервер управляет @@ и итоговым возвратом. Не запускай модельный опрос, платные сервисы или ключи API.");
}
