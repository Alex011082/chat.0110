import { isAuthor, parseMessageId } from "./ids.ts";

export interface MessageFile {
  id: string;
  author: string;
  reply_to?: string;
  created_at: string;
  text: string;
}

// Плоский YAML: агенты пишут frontmatter руками, поэтому разбор терпимый —
// незнакомые поля и мусор не ломают сообщение, а только не учитываются.
export function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } | null {
  const text = content.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const after = text.slice(end + 4);
  if (after !== "" && !after.startsWith("\n")) return null;
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    fields[m[1]!] = unquote(m[2]!.trim());
  }
  return { fields, body: after.replace(/^\n/, "") };
}

function unquote(value: string): string {
  const m = value.match(/^(['"])(.*)\1$/);
  return m ? m[2]! : value;
}

export function validIso(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseMessageFile(fileName: string, content: string): MessageFile | null {
  const id = fileName.replace(/\.md$/, "");
  const parts = fileName.endsWith(".md") ? parseMessageId(id) : null;
  if (!parts) return null;
  const fm = parseFrontmatter(content);
  const fields = fm?.fields ?? {};
  const author = fields.author && isAuthor(fields.author) ? fields.author : parts.author;
  const msg: MessageFile = {
    id,
    author,
    created_at: validIso(fields.created_at) ?? parts.date,
    text: (fm ? fm.body : content.replace(/\r\n/g, "\n")).trimEnd(),
  };
  if (fields.reply_to && parseMessageId(fields.reply_to)) msg.reply_to = fields.reply_to;
  return orderKeys(msg);
}

// Порядок полей фиксированный, чтобы сравнения в тестах и диффы были стабильны.
function orderKeys(msg: MessageFile): MessageFile {
  const out: MessageFile = { id: msg.id, author: msg.author } as MessageFile;
  if (msg.reply_to) out.reply_to = msg.reply_to;
  out.created_at = msg.created_at;
  out.text = msg.text;
  return out;
}

export function serializeMessageFile(msg: MessageFile): string {
  const lines = ["---", `id: ${msg.id}`, `author: ${msg.author}`];
  if (msg.reply_to) lines.push(`reply_to: ${msg.reply_to}`);
  lines.push(`created_at: ${msg.created_at}`, "---", msg.text.trimEnd(), "");
  return lines.join("\n");
}
