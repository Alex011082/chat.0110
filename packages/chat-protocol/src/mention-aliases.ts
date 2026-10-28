/** Один словарь для автодополнения, серверной маршрутизации и коннектора.
 * Это имена, не утверждение о доступности моделей у какого-либо провайдера.
 */
export const MENTION_ALIASES = {
  claude: [
    "claude",
    "claud",
    "клод",
    "клоде",
    "клода",
    "клоду",
    "клодом",
    "клауд",
    "клауде",
    "клауда",
    "клауду",
    "клаудом",
    "клоуд",
    "клоуда",
    "клоуду",
    "anthropic",
    "антропик",
  ],
  codex: ["codex", "кодекс", "кодекса", "кодексу", "кодексом", "кодексе", "кодэкс", "кодэкса", "кодэксу"],
  chatgpt: [
    "chatgpt",
    "chat-gpt",
    "chat_gpt",
    "gpt",
    "чатжпт",
    "чатджипити",
    "чатджипитию",
    "чатгпт",
    "чат-гпт",
    "чатжпти",
    "джипити",
    "жпт",
    "гпт",
  ],
  grok: ["grok", "грок", "грока", "гроку", "гроком", "гроке", "xai", "x-ai", "иксай"],
  gemini: ["gemini", "джемини", "джеминай", "джеминая", "джеминаю", "гемини", "геминай", "геминая", "геминаю"],
  sol: [
    "sol",
    "сол",
    "соль",
    "сола",
    "солу",
    "солом",
    "соле",
    "соли",
    "солью",
    "gpt-sol",
    "gpt-6-sol",
    "gpt-6.1-sol",
    "gpt-5.6-sol",
  ],
  astra: ["astra", "астра", "астре", "астру", "астры", "астрой", "астрою", "gpt-astra", "gpt-6-astra"],
  terra: [
    "terra",
    "терра",
    "терре",
    "терру",
    "терры",
    "террой",
    "тера",
    "тере",
    "теру",
    "gpt-terra",
    "gpt-6.1-terra",
    "gpt-5.6-terra",
  ],
  luna: ["luna", "луна", "луне", "луну", "луны", "луной", "луною", "gpt-luna", "gpt-6-luna", "gpt-5.6-luna"],
  opus: ["opus", "опус", "опуса", "опусу", "опусом", "опусе", "claude-opus", "клод-опус"],
  sonnet: [
    "sonnet",
    "соннет",
    "соннета",
    "соннету",
    "соннетом",
    "соннете",
    "сонет",
    "сонета",
    "сонету",
    "claude-sonnet",
    "клод-соннет",
  ],
  haiku: ["haiku", "хайку", "хоку", "хокку", "хаику", "claude-haiku", "клод-хайку"],
  deepseek: [
    "deepseek",
    "deep-seek",
    "дипсик",
    "дипсика",
    "дипсику",
    "дипсиком",
    "дипсике",
    "дипсикр",
    "deepseek-r1",
    "дипсик-r1",
  ],
  qwen: ["qwen", "квен", "квена", "квену", "квеном", "квене", "куэн", "куэна", "куэну", "кьювен", "кьювена", "кьювену"],
  llama: ["llama", "лама", "ламе", "ламу", "ламы", "ламой", "ллама", "лламе", "лламу", "лламой", "meta-ai"],
  mistral: ["mistral", "мистраль", "мистраля", "мистралю", "мистралем", "мистрале"],
  mixtral: ["mixtral", "микстраль", "микстраля", "микстралю", "микстралем"],
  codestral: ["codestral", "кодстраль", "кодстраля", "кодстралю", "кодестраль", "кодестралю"],
  perplexity: ["perplexity", "перплексити", "перплекситию", "перплекс", "перплексу"],
  sonar: ["sonar", "сонар", "сонара", "сонару", "сонаром", "сонаре"],
  copilot: ["copilot", "co-pilot", "копилот", "копилота", "копилоту", "копилотом", "копилоте", "ко-пилот"],
  cursor: ["cursor", "курсор", "курсора", "курсору", "курсором", "курсоре"],
  composer: ["composer", "композер", "композера", "композеру", "композером", "композере"],
  kimi: ["kimi", "кими", "киму", "кима", "moonshot", "муншот"],
  minimax: ["minimax", "mini-max", "минимакс", "минимакса", "минимаксу", "минимаксом"],
  glm: ["glm", "джиэлэм", "глм", "zhipu", "жипу", "зипу"],
  ernie: ["ernie", "эрни", "ерни"],
  command: ["command", "cohere", "комманд", "команд", "комманду", "кохер", "кохеру"],
  phi: ["phi", "фи", "фай"],
  gemma: ["gemma", "гемма", "гемме", "гемму", "геммы", "геммой", "джемма", "джемме", "джемму"],
} as const;

export function normalizeMention(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^@{1,2}/, "")
    .trim();
}
const lookup = new Map<string, string>();
for (const [name, aliases] of Object.entries(MENTION_ALIASES))
  for (const alias of aliases) {
    const key = normalizeMention(alias);
    if (lookup.has(key) && lookup.get(key) !== name) throw new Error(`Duplicate mention alias: ${alias}`);
    lookup.set(key, name);
  }
export function canonicalMention(value: string): string {
  const normalized = normalizeMention(value);
  return lookup.get(normalized) ?? normalized;
}
export interface MentionSession {
  id: string;
  alias: string;
  author: string;
  model?: string;
}
export function mentionMatches(value: string, session: MentionSession): boolean {
  const key = canonicalMention(value);
  return (
    normalizeMention(session.alias) === normalizeMention(value) ||
    canonicalMention(session.author) === key ||
    (!!session.model && canonicalMention(session.model) === key)
  );
}
export function resolveMention(value: string, sessions: readonly MentionSession[]): string {
  const exact = sessions.filter((s) => normalizeMention(s.alias) === normalizeMention(value));
  const matches = exact.length ? exact : sessions.filter((s) => mentionMatches(value, s));
  if (matches.length !== 1) throw new Error(matches.length ? "ambiguous" : "unknown");
  return matches[0]!.id;
}
export function suggestMentions(prefix: string, sessions: readonly MentionSession[]): string[] {
  const key = normalizeMention(prefix);
  return sessions
    .filter(
      (s) =>
        normalizeMention(s.alias).startsWith(key) ||
        [canonicalMention(s.author), canonicalMention(s.model ?? "")].some((name) =>
          (MENTION_ALIASES[name as keyof typeof MENTION_ALIASES] as readonly string[] | undefined)?.some((alias) =>
            normalizeMention(alias).startsWith(key),
          ),
        ),
    )
    .map((s) => s.id);
}
