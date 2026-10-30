import {
  canonicalMention,
  type AgentSession,
  type DispatchView,
} from "@chat0110/chat-protocol";
import { agentCards, participationTask } from "./agent-catalog.ts";

export type AutoReplyView = DispatchView & {
  chatgpt?: {
    authorized: boolean;
    connected: boolean;
    last_error: string | null;
  };
};
export function agentDeliveryState(session: AgentSession, view: AutoReplyView): "off" | "waiting_transport" | "waiting" | "working" {
  if (!session.auto_enabled) return "off";
  if (view.chains.some(chain => chain.status === "running" && chain.route[chain.step] === session.id)) return "working";
  const listening = canonicalMention(session.author) === "chatgpt" ? view.chatgpt?.connected : session.delivery_ready;
  return listening ? "waiting" : "waiting_transport";
}
// Личный плагин владельца CHAT.0110. Ссылка открывает Work с готовым запросом,
// а состояние «на связи» приходит только после настоящей подписки MCP Events.
const CHATGPT_PLUGIN =
  "https://chatgpt.com/plugins/plugin_asdk_app_6ae004bca1008191b9ce93dfbb9116a0";
export function sessionsForAuthor(
  sessions: AgentSession[],
  author: string,
): AgentSession[] {
  const canonical = canonicalMention(author);
  return sessions.filter(
    (session) => canonicalMention(session.author) === canonical,
  );
}
export function autoReplyLaunchUrl(
  repo: string,
  chatId: string,
  author: string,
  en: boolean,
): string {
  const canonical = canonicalMention(author);
  if (canonical === "chatgpt") {
    const card = agentCards(en)[0]!;
    const prompt =
      (en
        ? `Enable CHAT.0110 automatic replies for ${repo}, chat ${chatId}. `
        : `Включи автоответы CHAT.0110 для ${repo}, чат ${chatId}. `) +
      participationTask(card, en, { repo, chat_id: chatId });
    const url = new URL(CHATGPT_PLUGIN);
    url.searchParams.set("install", "");
    url.searchParams.set("surface", "work");
    url.searchParams.set("prompt", prompt);
    return url.toString();
  }
  const query = new URLSearchParams({ repo, chat: chatId });
  return `/connect?${query}#${canonical === "claude" ? "claude-code" : canonical}`;
}
export async function setAutoReply(
  chatKey: string,
  sessionId: string,
  enabled: boolean,
): Promise<AutoReplyView> {
  const response = await fetch(
    `/api/chats/${chatKey.split("/").map(encodeURIComponent).join("/")}/auto-replies`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, enabled }),
    },
  );
  if (!response.ok) throw new Error("auto-replies");
  return response.json();
}

/** Сессия видна до первого ответа: иначе выключенный новый ИИ нельзя запустить. */
export function mergeAgentParticipants(history: import("@chat0110/chat-protocol").Participant[], sessions: AgentSession[]): import("@chat0110/chat-protocol").Participant[] {
  const result = [...history];
  for (const session of sessions) {
    if (!result.some((participant) => participant.is_agent && canonicalMention(participant.author) === canonicalMention(session.author)))
      result.push({ author: session.author, display: session.name, is_agent: true, last_at: "", count: 0 });
  }
  return result;
}
