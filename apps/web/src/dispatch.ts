import type { DispatchView } from "@chat0110/chat-protocol";
import { ApiFailure, mockRequested } from "./api.ts";
export async function dispatchRequest(chatKey: string, cancelId?: string): Promise<DispatchView> {
  if (mockRequested())
    return {
      sessions: [
        { id: "demo-claude", alias: "клод", name: "Claude · demo", author: "claude", model: "sonnet", online: true },
        { id: "demo-codex", alias: "кодекс", name: "Codex · demo", author: "codex", model: "sol", online: false },
      ],
      chains: [],
    };
  const path = `/api/chats/${chatKey.split("/").map(encodeURIComponent).join("/")}/dispatch`;
  const r = await fetch(path, {
    credentials: "same-origin",
    ...(cancelId
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cancelId }) }
      : {}),
  });
  if (!r.ok) throw new ApiFailure(r.status, "network", "Dispatch unavailable");
  return cancelId ? dispatchRequest(chatKey) : r.json();
}
export const dispatchText = (en: boolean) =>
  en
    ? {
        title: "Agent turns",
        help: "@ recipient · @@ discuss, then return for a final answer",
        invalid: "Choose one @ recipient and, optionally, one different @@ participant.",
        ambiguous: "Several sessions match. Choose a specific name from the list.",
        unknown: "This participant is not connected yet. Open Connect AI to set it up.",
        unavailable: "Cannot load agent sessions. Try again before sending a mention.",
        empty: "No agent sessions connected",
        connect: "Connect AI",
        guide:
          "Set up the chat0110 connector in the agent app, then connect it to this chat. Each session gets its own name.",
        guideLink: "Connection instructions",
        online: "online",
        offline: "waiting for connection",
        route: "Order",
        final: "final",
        stop: "Stop",
        failed: "Could not stop the chain",
        status: {
          preparing: "saving message",
          waiting: "waiting for participant",
          running: "answering",
          done: "completed",
          cancelled: "stopped",
          interrupted: "connection lost — awaiting the same session",
          expired: "15-minute limit reached — stopped",
          needs_owner: "waiting for your decision — stopped",
        },
      }
    : {
        title: "Ходы агентов",
        help: "@ адресат · @@ обсудить и вернуть на итог",
        invalid: "Выбери одного @адресата и, при необходимости, другого @@участника.",
        ambiguous: "Подходят несколько сессий. Выбери точное имя из списка.",
        unknown: "Этот участник ещё не подключён. Открой «Подключить ИИ».",
        unavailable: "Не удалось загрузить сессии. Повтори перед отправкой обращения.",
        empty: "Сессии агентов ещё не подключены",
        connect: "Подключить ИИ",
        guide:
          "Добавь коннектор chat0110 в приложение агента, затем подключи его к этому чату. У каждой сессии будет своё имя.",
        guideLink: "Инструкция подключения",
        online: "на связи",
        offline: "ждёт подключения",
        route: "Порядок",
        final: "итог",
        stop: "Остановить",
        failed: "Не удалось остановить цепочку",
        status: {
          preparing: "запись сообщения",
          waiting: "ждёт участника",
          running: "отвечает",
          done: "завершено",
          cancelled: "остановлено",
          interrupted: "связь потеряна — ждёт ту же сессию",
          expired: "истекли 15 минут — остановлено",
          needs_owner: "нужно твоё решение — остановлено",
        },
      };
