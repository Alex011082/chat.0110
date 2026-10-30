import type { AgentSession } from "@chat0110/chat-protocol";
import { canonicalMention } from "@chat0110/chat-protocol";
import { useState } from "react";
import {
  autoReplyLaunchUrl,
  agentDeliveryState,
  setAutoReply,
  type AutoReplyView,
} from "../lib/auto-replies.ts";
import { Key, KeyLink } from "../ui/kit.tsx";
import { s } from "../strings.ts";

export function ParticipantAutoReplies({
  author,
  sessions,
  view,
  repo,
  chatId,
  canPush,
  onChange,
}: {
  author: string;
  sessions: AgentSession[];
  view: AutoReplyView | null;
  repo: string;
  chatId: string;
  canPush: boolean;
  onChange: (value: AutoReplyView) => void;
}) {
  const en = s.locale === "en";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);
  const chatgpt = canonicalMention(author) === "chatgpt";
  const launchUrl = autoReplyLaunchUrl(repo, chatId, author, en);
  const toggle = async (session: AgentSession) => {
    if (!canPush || busy) return;
    const enabled = !session.auto_enabled;
    setBusy(session.id);
    setError(false);
    // Открываем приложение в событии клика: браузер не блокирует вкладку как popup.
    // Повторные запуски с живой подпиской остаются целиком внутри чата.
    if (enabled && chatgpt && !view?.chatgpt?.connected)
      window.open(launchUrl, "_blank", "noopener,noreferrer");
    try {
      onChange(await setAutoReply(`${repo}/${chatId}`, session.id, enabled));
    } catch {
      setError(true);
    } finally {
      setBusy("");
    }
  };
  if (!canPush) return null;
  if (!view)
    return (
      <p className="m-0 mt-2 text-cap text-ink-2">
        {en ? "Checking the connection…" : "Проверяем подключение…"}
      </p>
    );
  return (
    <div className="mt-2 flex flex-col gap-2">
      {sessions.length === 0 ? (
        <>
          <p className="m-0 text-cap text-ink-2">
            {en
              ? "The participant is in the history. Connect its session to receive new turns."
              : "Участник есть в истории. Для новых ходов нужна подключённая сессия."}
          </p>
          <KeyLink href={launchUrl} className="self-start text-cap">
            {en ? "Start automatic replies" : "Запустить автоответы"}
          </KeyLink>
        </>
      ) : (
        sessions.map((session) => {
          const deliveryState = agentDeliveryState(session, view);
          return (
            <div key={session.id} className="flex flex-col gap-2">
              {sessions.length > 1 ? (
                <span className="text-cap text-ink-2">
                  {session.name} · @{session.alias}
                </span>
              ) : null}
              <span role="status" className="text-cap text-ink-2">
                {deliveryState === "working"
                  ? en ? "Answering" : "Отвечает"
                  : deliveryState === "waiting"
                  ? en
                    ? "Listening for addressed turns"
                    : "Ожидает адресованные сообщения"
                  : session.auto_enabled
                    ? chatgpt
                      ? en
                        ? "Waiting for the ChatGPT subscription"
                        : "Ожидаем подписку ChatGPT"
                      : en
                        ? "Enabled · waiting for a delivery channel"
                        : "Включены · ждём канал доставки"
                    : en
                      ? "Automatic replies are off"
                      : "Автоответы выключены"}
              </span>
              <Key
                onClick={() => void toggle(session)}
                disabled={!!busy}
                className="self-start text-cap"
              >
                {busy === session.id
                  ? en
                    ? "Saving…"
                    : "Сохраняем…"
                  : session.auto_enabled
                    ? en
                      ? "Stop automatic replies"
                      : "Остановить автоответы"
                    : en
                      ? "Start automatic replies"
                      : "Запустить автоответы"}
              </Key>
              {chatgpt && session.auto_enabled && !view.chatgpt?.connected ? (
                <a
                  href={launchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="py-1 text-cap text-ink-2"
                >
                  {en
                    ? "Open ChatGPT to finish starting"
                    : "Открыть ChatGPT для завершения запуска"}
                </a>
              ) : null}
            </div>
          );
        })
      )}
      {error ? (
        <p role="alert" className="m-0 text-cap text-action-ink">
          {en
            ? "Could not save. Try again."
            : "Не удалось сохранить. Повтори попытку."}
        </p>
      ) : null}
    </div>
  );
}
