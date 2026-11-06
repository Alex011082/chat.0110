import type { AgentSession } from "@chat0110/chat-protocol";
import { canonicalMention } from "@chat0110/chat-protocol";
import { useState } from "react";
import {
  agentConnectionLabel,agentSessionName,
  setAutoReply,
  setAuthorAutoReply,
  type AutoReplyView,
} from "../lib/auto-replies.ts";
import { Key } from "../ui/kit.tsx";
import { s } from "../strings.ts";
import {PluginInstallHelp} from "./PluginInstallHelp.tsx";
import {Toggle} from "../ui/Toggle.tsx";
import {ChannelReplacement} from "./ChannelReplacement.tsx";

export function ParticipantAutoReplies({
  author,
  sessions,
  view,
  repo,
  chatId,
  canPush,
  onChange,
  compact=false,
}: {
  author: string;
  sessions: AgentSession[];
  view: AutoReplyView | null;
  repo: string;
  chatId: string;
  canPush: boolean;
  onChange: (value: AutoReplyView) => void;
  compact?:boolean;
}) {
  const en = s.locale === "en";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);
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
      <div className="flex flex-col gap-3"><p className="m-0 mt-2 text-cap text-ink-2">
        {en ? "Checking the connection…" : "Проверяем подключение…"}
      </p><PluginInstallHelp author={author} repo={repo} chatId={chatId}/></div>
    );
  return (
    <div className="mt-2 flex flex-col gap-2">
      {sessions.length === 0 ? (
        <>
          <p className="m-0 text-cap text-ink-2">
            {en
              ? requested?"Waiting for the plugin · start requested":"Install the plugin once to receive new turns."
              : "Нужно подключить"}
          </p>
          {compact?<div className="control-row"><span>{en?"Automatic replies":"Автоответы"}</span><Toggle label={en?"Automatic replies":"Автоответы"} checked={requested} disabled={!!busy} onChange={async()=>{if(busy)return;setBusy("author");setError(false);try{onChange(await setAuthorAutoReply(`${repo}/${chatId}`,author,!requested));}catch{setError(true);}finally{setBusy("");}}}/></div>:<Key disabled={!!busy} onClick={async()=>{if(busy)return;setBusy("author");setError(false);try{onChange(await setAuthorAutoReply(`${repo}/${chatId}`,author,!requested));}catch{setError(true);}finally{setBusy("");}}} className="self-start text-cap">
            {busy?(en?"Saving…":"Сохраняем…"):requested?(en?"Turn off automatic replies":"Выключить автоответы"):(en?"Turn on automatic replies":"Включить автоответы")}
          </Key>}
        </>
      ) : (
        sessions.map((session) => {

          return (
            <div key={session.id} className="flex flex-col gap-2">
              {!compact?(
                <span className="text-cap text-ink-2">
                  {agentSessionName(session)}
                </span>
              ):null}
              <span role="status" className="text-cap text-ink-2">
                {agentConnectionLabel(session,view,en)}
              </span>
              <span className="text-cap text-ink-2 [overflow-wrap:anywhere]">{en?"Address":"Обращение"}: @{session.alias}</span>
              {compact?<div className="control-row"><span>{en?"Automatic replies":"Автоответы"}</span><Toggle label={`${en?"Automatic replies":"Автоответы"}: ${agentSessionName(session)}`} checked={!!session.auto_enabled} disabled={!!busy} onChange={()=>void toggle(session)}/></div>:<Key
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
              </Key>}
              <details><summary className="participant-detail-toggle">{en?"Connection details":"Подключение и подробности"}</summary>
               <p className="text-cap text-ink-2">{session.auto_enabled?(en?"Automatic replies are enabled. Delivery depends on a connected client for this chat.":"Автоответы включены. Доставка зависит от подключённого клиента этого чата."):(en?"New tasks are paused; existing history is preserved.":"Новые задания приостановлены; история сохранена.")}</p>
               <ChannelReplacement key={`${repo}/${chatId}/${session.id}`} session={session} repo={repo} chatId={chatId}/>
              </details>
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
