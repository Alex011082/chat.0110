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
export function sessionSetupTask(card:AgentCard,en:boolean,context:ChatContext):string{
 const params={...context,author:card.role,alias:`${card.id}-${context.chat_id.slice(-4)}`,name:`${card.name} · ${context.repo.split("/")[1]}`};
 return (en?"Use CHAT.0110 MCP in this existing session. Connect with chat0110_connect: ":"Используй MCP CHAT.0110 в этой существующей сессии. Подключись через chat0110_connect: ")+JSON.stringify(params)+". "+
 (en?"Set name to this session's readable title and model to the actual model if known. Keep alias unique in this chat. Save the returned session_id: it binds this exact session to this repository and chat. Do not connect other sessions or create a new one. Check chat0110_status and report actual delivery readiness. ":"В name поставь понятное название этой сессии, в model — фактическую модель, если известна. Alias должен быть уникален в этом чате. Сохрани полученный session_id: он привязывает именно эту сессию к этому репозиторию и чату. Другие сессии не подключай и новую не создавай. Проверь chat0110_status и сообщи фактическую готовность доставки. ")+
 (card.id==="chatgpt"?(en?'Subscribe to chat0110.turn.ready with {"recipient":"chatgpt"}. ':'Подпишись на chat0110.turn.ready с {"recipient":"chatgpt"}. '):card.id==="claude-code"?(en?"Use the authorized chat0110-local event channel if available. ":"Используй разрешённый канал событий chat0110-local, если доступен. "):"")+
 (en?"For each addressed event, call chat0110_take, read chat0110_context, then publish exactly one chat0110_reply. The server controls @@ and the final return; do not call other participants yourself. If delivery cannot wake this session, report it explicitly. Do not start model polling, paid services or API keys.":"Для адресованного события вызови chat0110_take, прочитай chat0110_context и опубликуй ровно один chat0110_reply. Очередью @@ и возвратом на итог управляет сервер; сам других участников не вызывай. Если доставка не может пробудить эту сессию, явно сообщи об этом. Не запускай модельный опрос, платные сервисы или ключи API.");
}
