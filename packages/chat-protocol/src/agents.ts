// Известные агенты и их GitHub-логины. Логины ботов сверяются с фактом на
// тестовом чате (docs/protocol.md, «Поведение агентов на деле»).
export const AGENTS: Record<string, { name: string; logins: string[] }> = {
  claude: { name: "Claude", logins: ["claude[bot]", "claude", "anthropic-claude[bot]"] },
  codex: { name: "Codex", logins: ["chatgpt-codex-connector[bot]", "codex[bot]", "openai-codex[bot]"] },
  chatgpt: { name: "ChatGPT", logins: ["chatgpt[bot]"] },
  gemini: { name: "Gemini", logins: ["gemini-code-assist[bot]"] },
  grok: { name: "Grok", logins: [] },
};

const BY_LOGIN = new Map(
  Object.entries(AGENTS).flatMap(([id, a]) => a.logins.map((l) => [l.toLowerCase(), id] as const)),
);

export function resolveAuthor(login: string): string {
  const key = login.toLowerCase();
  return BY_LOGIN.get(key) ?? key;
}

export function isAgent(author: string): boolean {
  return author in AGENTS;
}

export function displayName(author: string): string {
  return AGENTS[author]?.name ?? author;
}
