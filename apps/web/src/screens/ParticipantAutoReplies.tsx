import type { AgentSession } from "@chat0110/chat-protocol";
import { canonicalMention } from "@chat0110/chat-protocol";
import { useState } from "react";
import {
  agentDeliveryState,
  setAutoReply,
  setAuthorAutoReply,
  type AutoReplyView,
} from "../lib/auto-replies.ts";
import { Key } from "../ui/kit.tsx";
import { s } from "../strings.ts";
import {PluginInstallHelp} from "./PluginInstallHelp.tsx";

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
  const requested=view?.auto_requests?.find(row=>row.author===canonicalMention(author))?.enabled??false;
  const toggle = async (session: AgentSession) => {
    if (!canPush || busy) return;
    const enabled = !session.auto_enabled;
    setBusy(session.id);
    setError(false);
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
              ? requested?"Waiting for the plugin · start requested":"Install the plugin once to receive new turns."
              : requested?"Ожидаем плагин · включение запрошено":"Для новых ходов один раз подключи плагин."}
          </p>
          <Key disabled={!!busy} onClick={async()=>{if(busy)return;setBusy("author");setError(false);try{onChange(await setAuthorAutoReply(`${repo}/${chatId}`,author,!requested));}catch{setError(true);}finally{setBusy("");}}} className="self-start text-cap">
            {busy?(en?"Saving…":"Сохраняем…"):requested?(en?"Turn off automatic replies":"Выключить автоответы"):(en?"Turn on automatic replies":"Включить автоответы")}
          </Key>
        </>
      ) : (
        sessions.map((session) => {
          const deliveryState = agentDeliveryState(session, view);
          return (
            <div key={session.id} className="flex flex-col gap-2">
              {(
                <span className="text-cap text-ink-2">
                  {session.name} · @{session.alias}
                </span>
              )}
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
                      ? "Turn off automatic replies"
                      : "Выключить автоответы"
                    : en
                      ? "Turn on automatic replies"
                      : "Включить автоответы"}
              </Key>
            </div>
          );
        })
      )}
      <PluginInstallHelp author={author} repo={repo} chatId={chatId}/>
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
