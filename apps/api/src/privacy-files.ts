import { parseFrontmatter, scaffoldContent, isAuthor, isChatId, parseMessageId, validIso, DECISION_ACTIONS } from "@chat0110/chat-protocol";
import type { Privacy } from "./privacy.ts";
import { forbidden } from "./errors.ts";

/** Проверка старых файлов перед копированием/слиянием, без изменения истории. */
export async function cleanConversationFile(privacy: Privacy, path: string, content: string): Promise<string> {
  if (scaffoldContent(path) !== null) return content;
  if (path.endsWith(".json")) {
    const raw = JSON.parse(content);
    const safe = await privacy.object(JSON.parse(privacy.protocol(content)), true);
    return JSON.stringify(safe) === JSON.stringify(raw) ? content : JSON.stringify(safe, null, 2) + "\n";
  }
  const fm = parseFrontmatter(content);
  if (!fm) return (await privacy.scan(content)).text;
  // id/author/reply_to — протокол; title/reason и тело — пользовательский текст.
  const end = content.indexOf("\n---", 3) + 4;
  let header = privacy.protocol(content.slice(0, end));
  const seen = new Set<string>();
  for (const line of content.slice(4, end - 4).split("\n").filter(Boolean)) {
    const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!field) throw forbidden("Неподдерживаемый frontmatter: отправьте сообщение через CHAT.0110");
    const key = field[1]!, value = fm.fields[key]!;
    if (seen.has(key)) throw forbidden("Повтор поля frontmatter: отправьте сообщение через CHAT.0110");
    seen.add(key);
    const valid = ["title", "reason"].includes(key)
      || (["id", "decision", "reply_to", "supersedes"].includes(key) && !!parseMessageId(value))
      || (key === "author" && isAuthor(value))
      || (key === "created_at" && !!validIso(value))
      || (key === "action" && (DECISION_ACTIONS as readonly string[]).includes(value))
      || (key === "from_chat" && isChatId(value))
      || (key === "source_messages" && value.split(",").every((v) => !v.trim() || /^[A-Za-z0-9_-]{1,64}$/.test(v.trim())));
    if (!valid) throw forbidden("Неподдерживаемое поле frontmatter: отправьте сообщение через CHAT.0110");
  }
  for (const name of ["title", "reason"]) {
    const match = header.match(new RegExp(`^${name}: (.*)$`, "m"));
    if (match) header = header.replace(match[0], `${name}: ${(await privacy.scan(match[1]!)).text}`);
  }
  return header + (await privacy.scan(content.slice(end))).text;
}
