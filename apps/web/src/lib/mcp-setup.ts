import { MCP_PACKAGE_VERSION } from "@chat0110/chat-protocol";
import type { AgentCard, ChatContext } from "./agent-catalog.ts";
export const mcpPackageUrl = `https://chat.0110.digital/downloads/chat0110-mcp-${MCP_PACKAGE_VERSION}.tgz`;
export function terminalClient(card: Pick<AgentCard, "id">): string | null {
  return ["codex", "claude-code", "grok-build"].includes(card.id) ? card.id : card.id === "other-ai" ? "other" : null;
}
export function mcpSetupCommand(card: Pick<AgentCard, "id">): string | null {
  const client = terminalClient(card);
  return client ? `npx --yes --package=${mcpPackageUrl} chat0110 setup --client ${client}` : null;
}
export function connectContext(search: string): ChatContext | null {
  const p = new URLSearchParams(search), repo = p.get("repo") ?? "", chat_id = p.get("chat") ?? "";
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) && /^\d{8}-[a-z0-9]{4}$/.test(chat_id) ? { repo, chat_id } : null;
}
/** До регистрации проверяем именно доступный модели транспорт, а не конфигурацию на диске. */
export function sessionSetupPreflight(card:Pick<AgentCard,"id">,en:boolean):string {
 if(terminalClient(card))return en
  ? "Before connecting, inspect the tools available in this session. Use the installed chat0110-local stdio server: chat0110_connect, chat0110_status, chat0110_set_auto_reply, chat0110_next, chat0110_context and chat0110_reply must be present. If they are missing, stop before registration. Restart this MCP in the client settings and check /mcp where supported; refreshing Apps tools is a different operation. Do not use an old Apps connector instead. "
  : "До подключения проверь инструменты, доступные именно этой сессии. Используй установленный stdio-сервер chat0110-local: должны быть chat0110_connect, chat0110_status, chat0110_set_auto_reply, chat0110_next, chat0110_context и chat0110_reply. Если их нет, остановись до регистрации. Перезапусти этот MCP в настройках клиента и проверь /mcp, если клиент поддерживает эту команду; обновление инструментов Apps — другая операция. Не подключай участника через старый Apps-коннектор вместо локального сервера. ";
 return en
  ? "Before connecting, inspect this session's remote MCP catalog: chat0110_pending must accept a required session_id; chat0110_status and chat0110_set_auto_reply must be available. If the catalog is old, stop before registration and report that the Apps tool definition needs refresh/rescan. Adding fields outside the exposed schema does not update it. "
  : "До подключения проверь удалённый MCP-каталог этой сессии: chat0110_pending должен принимать обязательный session_id, а chat0110_status и chat0110_set_auto_reply должны быть доступны. Если каталог старый, остановись до регистрации и сообщи, что определение инструментов Apps требует обновления/Rescan. Добавление полей вне доступной схемы её не обновляет. ";
}
export function sessionTurnInstructions(card:Pick<AgentCard,"id"|"role">,en:boolean):string {
 if(terminalClient(card))return en
  ? "For this stateful stdio server, use chat0110_next, then chat0110_context without arguments, then one chat0110_reply with the assigned task_id, text and outcome. The local server stores the session and claim; do not pass a different session_id. An authorized Claude Code channel can deliver events. Otherwise next is active waiting only and does not wake an idle Codex host. "
  : "Для этого stateful stdio-сервера используй chat0110_next, затем chat0110_context без аргументов, затем один chat0110_reply с выданным task_id, text и outcome. Локальный сервер хранит сессию и claim; не передавай чужой session_id. Разрешённый канал Claude Code может доставлять события. Иначе next — только активное ожидание: простаивающий Codex-хост оно не пробуждает. ";
 if(card.id==="chatgpt")return en
  ? 'Subscribe to chat0110.turn.ready with {"recipient":"chatgpt"}. For each event use chat0110_take(task_id), chat0110_context(task_id,claim), then one chat0110_reply(task_id,claim,text,outcome). '
  : 'Подпишись на chat0110.turn.ready с {"recipient":"chatgpt"}. При каждом событии используй chat0110_take(task_id), chat0110_context(task_id,claim), затем один chat0110_reply(task_id,claim,text,outcome). ';
 return en
  ? `For remote MCP, call chat0110_pending ${JSON.stringify({author:card.role,session_id:"<session_id>",wait:true})}, replacing the placeholder with the exact returned session_id, while the session is active. Then chat0110_take(task_id), chat0110_context(task_id,claim), and one chat0110_reply(task_id,claim,text,outcome). `
  : `Для удалённого MCP вызывай chat0110_pending ${JSON.stringify({author:card.role,session_id:"<session_id>",wait:true})}, подставив точный session_id из connect, пока сессия активна. Затем chat0110_take(task_id), chat0110_context(task_id,claim) и один chat0110_reply(task_id,claim,text,outcome). `;
}
export function sessionSetupTask(card:AgentCard,en:boolean,context:ChatContext):string{
 const params={...context,author:card.role,alias:`${card.id}-${context.chat_id.slice(-4)}`,name:`${card.name} · ${context.repo.split("/")[1]}`};
 return sessionSetupPreflight(card,en)+(en?"Use CHAT.0110 MCP in this existing session. Connect with chat0110_connect: ":"Используй MCP CHAT.0110 в этой существующей сессии. Подключись через chat0110_connect: ")+JSON.stringify(params)+". "+
 (en?"Set name to this session's readable title and model to the actual model if known. Save the returned session_id. Do not connect other sessions or create a new one. On alias conflict do not take over another participant or silently choose another alias: recover only the connector's own saved identity or report the conflict. Check chat0110_status using this transport's schema; report registration, enabled intent and live delivery separately. ":"В name поставь понятное название этой сессии, в model — фактическую модель, если известна. Сохрани session_id из ответа. Другие сессии не подключай и новую не создавай. При конфликте alias не захватывай другого участника и не подставляй новое имя молча: восстанавливай только собственную сохранённую identity коннектора или сообщи о конфликте. Проверь chat0110_status по схеме этого транспорта; регистрацию, включение и живую доставку сообщай отдельно. ")+
 sessionTurnInstructions(card,en)+
 (en?"Check prior effects on resumed tasks; never repeat completed work. The server controls @@ and the final return. If delivery cannot wake this session, report it explicitly. Do not start model polling, paid services or API keys.":"При resumed проверь прежние эффекты; завершённую работу не повторяй. Очередью @@ и возвратом на итог управляет сервер. Если доставка не может пробудить эту сессию, явно сообщи об этом. Не запускай модельный опрос, платные сервисы или ключи API.");
}
