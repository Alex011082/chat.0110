import { readFileSync, lstatSync } from "node:fs";
import { createConnection } from "node:net";
import type { NativeSendResult } from "./native-delivery.ts";

export interface ClaudeInboxTarget { metadata: string; sessionId: string; hostSessionId: string }
export function claudeInboxPath(target: ClaudeInboxTarget): string {
  const metaFile = lstatSync(target.metadata);
  if (!metaFile.isFile() || metaFile.isSymbolicLink() || metaFile.uid !== process.getuid?.()) throw new Error("Неверный файл сессии");
  const meta = JSON.parse(readFileSync(target.metadata, "utf8"));
  const version = String(meta.version).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (!version || version[0] !== 2 || version[1] !== 1 || version[2]! < 224 || meta.peerProtocol !== 1 ||
      meta.entrypoint !== "claude-desktop" || meta.sessionId !== target.sessionId || meta.hostSessionId !== target.hostSessionId)
    throw new Error("Сессия или версия inbox не совпадает с привязкой");
  if (typeof meta.messagingSocketPath !== "string") throw new Error("У сессии нет inbox");
  const socket = lstatSync(meta.messagingSocketPath);
  if (!socket.isSocket() || socket.uid !== process.getuid?.() || (socket.mode & 0o777) !== 0o600)
    throw new Error("Небезопасный inbox сессии");
  return meta.messagingSocketPath;
}
export function sendClaudeInbox(target: ClaudeInboxTarget, text: string, id: string): Promise<NativeSendResult> {
  const path = claudeInboxPath(target);
  const frame = JSON.stringify({ type: "user", message: { role: "user", content: `CHAT0110 delivery ${id}\n${text}` } }) + "\n";
  return new Promise(resolve => {
    let connected = false, settled = false;
    const socket = createConnection({ path });
    const finish = (result: NativeSendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(connected ? "uncertain" : "not_sent"), 3000);
    socket.on("error", () => finish(connected ? "uncertain" : "not_sent"));
    socket.on("connect", () => {
      connected = true;
      socket.write(frame, error => finish(error ? "uncertain" : "sent_unconfirmed"));
    });
  });
}
