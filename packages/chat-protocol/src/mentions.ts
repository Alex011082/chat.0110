/** Только явные обращения вне цитат, ссылок и кода становятся маршрутом. */
export function mentionRoute(text: string): string[] {
  let fence = "";
  let quote = false;
  let html = false;
  const plain = text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = "";
        return "";
      }
      if (!line.trim()) {
        quote = false;
        html = false;
        return "";
      }
      if (/^\s{0,3}>/.test(line)) {
        quote = true;
        return "";
      }
      if (quote) return "";
      if (marker) {
        fence = marker[1]!;
        return "";
      }
      if (/^\s{0,3}<[/!a-zA-Z]/.test(line)) html = true;
      if (html || /^(?: {4}|\t)|^\s{0,3}\[[^\]]+\]:/.test(line)) return "";
      return line;
    })
    .join("\n")
    .replace(/(`+)[\s\S]*?\1/g, "")
    .replace(/!?\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])|<[^>]*>|https?:\/\/\S+/g, "");
  const mentions = [
    ...plain.matchAll(
      /(^|[\s(])(@{1,2})([\p{L}\p{N}](?:[\p{L}\p{N}_-]|\.(?=[\p{L}\p{N}])){0,59})(?=$|[^\p{L}\p{N}_@-])/gu,
    ),
  ];
  const first = [...new Set(mentions.filter((m) => m[2] === "@").map((m) => m[3]!.toLowerCase()))];
  const next = [...new Set(mentions.filter((m) => m[2] === "@@").map((m) => m[3]!.toLowerCase()))];
  if (!first.length && !next.length) return [];
  if (first.length !== 1 || next.length > 1 || next[0] === first[0]) throw new Error("mention_route");
  return next.length ? [first[0]!, next[0]!, first[0]!] : first;
}

export interface AgentSession {
  id: string;
  alias: string;
  name: string;
  author: string;
  model: string;
  online: boolean;
  auto_enabled?: boolean;
}
export interface DispatchChain {
  id: string;
  message_id: string;
  route: string[];
  step: number;
  status: "preparing" | "waiting" | "running" | "done" | "cancelled" | "interrupted";
}
export interface DispatchView {
  sessions: AgentSession[];
  chains: DispatchChain[];
}
