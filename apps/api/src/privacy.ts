import { createHmac, randomBytes } from "node:crypto";
import { HttpError } from "./errors.ts";
import { LocalEntities } from "./privacy-worker.ts";
import { MENTION_ALIASES, normalizeMention } from "@chat0110/chat-protocol";

export const CATEGORIES = ["SECRET", "EMAIL", "PHONE", "DOCUMENT", "CARD", "BANK_ACCOUNT", "PERSON", "ADDRESS"] as const;
export type Category = (typeof CATEGORIES)[number];
export interface Span { start: number; end: number; category: Category }
export interface CleanText { text: string; counts: Partial<Record<Category, number>> }
export type EntityScanner = (text: string) => Promise<Span[]>;
const MARKER = /\[(SECRET|EMAIL|PHONE|DOCUMENT|CARD|BANK_ACCOUNT|PERSON|ADDRESS)_(\d+)\]/g;
const CONTENT = new Set(["text", "title", "body", "reason", "intro", "prompt", "answer", "diff_hunk", "excerpt", "summary", "path", "gaps"]);
const METADATA = new Set(["id", "author", "actor", "created_by", "created_at", "updated_at", "chat_id", "reply_to", "decision", "source_messages", "from_chat", "supersedes", "superseded_by", "decided_by", "decided_at", "schema_version", "commit_sha", "head_sha", "message_id", "boundary_message_id", "origin_chat_id", "kind", "source", "state", "status", "action", "repo", "url", "branch"]);
const MODEL_NAMES = new Set(Object.values(MENTION_ALIASES).flat().map(normalizeMention));
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
export const privacyUnavailable = () => new HttpError(503, "privacy_unavailable", "Проверка защиты данных недоступна. Публикация приостановлена. / Data protection unavailable. Publication paused.");

export function privacyCounts(text: string): CleanText["counts"] {
  const counts: CleanText["counts"] = {};
  for (const match of text.matchAll(MARKER)) {
    const category = match[1] as Category;
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  return [...digits].reverse().reduce((sum, digit, index) => {
    let n = Number(digit) * (index % 2 ? 2 : 1);
    return sum + (n > 9 ? n - 9 : n);
  }, 0) % 10 === 0;
}

function iban(raw: string): boolean {
  const compact = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const digits = (compact.slice(4) + compact.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

function rules(text: string): Span[] {
  const spans: Span[] = [];
  const add = (re: RegExp, category: Category, group = 0, valid?: (s: string) => boolean) => {
    for (const m of text.matchAll(re)) {
      const value = m[group];
      if (!value || (valid && !valid(value))) continue;
      const start = m.index! + (group ? m[0].lastIndexOf(value) : 0);
      spans.push({ start, end: start + value.length, category });
    }
  };
  add(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, "SECRET");
  add(/\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,255}|sk-(?:proj-|ant-[\w-]+-)?[A-Za-z0-9_-]{20,255}|xox[baprs]-[\w-]{15,255}|whsec_[A-Za-z0-9]{16,255}|AKIA[A-Z0-9]{16}|AIza[\w-]{35})\b/g, "SECRET");
  add(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "SECRET");
  add(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s<>"'`]+/gi, "SECRET");
  add(/\bhttps?:\/\/([^\s/@]+:[^\s/@]+)@/gi, "SECRET", 1);
  const envName = String.raw`(?<![\p{L}\p{N}_])(?:[A-Z0-9_]{1,120}_)?(?:API_KEY|PASSWORD|PASSWD|TOKEN|SECRET_ACCESS_KEY|SECRET_KEY|CLIENT_SECRET|PRIVATE_KEY|AUTH_TOKEN|SECRET)(?:_[A-Z0-9]{1,32})?`;
  add(new RegExp(envName + String.raw`\s*["']?\s*[:=]\s*"([^"\n]{1,2000})"`, "giu"), "SECRET", 1);
  add(new RegExp(envName + String.raw`\s*["']?\s*[:=]\s*'([^'\n]{1,2000})'`, "giu"), "SECRET", 1);
  add(new RegExp(envName + String.raw`\s*["']?\s*[:=]\s*["']?([^\s"'\x60&,;<>}]+)`, "giu"), "SECRET", 1);
  add(/(?<![\p{L}\p{N}_])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token|пароль|токен|секрет)\s*["']?\s*[:=]\s*"([^"\n]{1,2000})"/giu, "SECRET", 1);
  add(/(?<![\p{L}\p{N}_])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token|пароль|токен|секрет)\s*["']?\s*[:=]\s*'([^'\n]{1,2000})'/giu, "SECRET", 1);
  add(/(?<![\p{L}\p{N}_])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|pwd|secret|token|пароль|токен|секрет|ключ[_ ]?api)\s*["']?\s*[:=]\s*["']?([^\s"'`&,;<>}]+)/giu, "SECRET", 1);
  add(/[?&](?:key|api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password|signature|sig|authorization)=([^\s&#"'`<>]+)/gi, "SECRET", 1);
  add(/\b(?:Bearer|Basic)\s+([A-Za-z0-9_+/=.-]{8,})/gi, "SECRET", 1);
  add(/(?<![\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-])[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]{1,254}@[\p{L}\p{N}](?:[\p{L}\p{N}.-]{0,251}[\p{L}\p{N}])?\.[\p{L}]{2,}/gu, "EMAIL");
  add(/(?<![\p{L}\p{N}])\+\d[\d ()-]{6,23}\d(?![\p{L}\p{N}])/gu, "PHONE", 0, (s) => { const n = s.replace(/\D/g, "").length; return n >= 8 && n <= 15; });
  add(/(?<![\p{L}\p{N}_])(?:телефон|тел\.?|phone|mobile|мобильный)\s*[:=]?\s*([\d(][\d ()-]{6,23}\d)/giu, "PHONE", 1);
  add(/(?<!\d)8\s*\(\d{3}\)\s*\d{3}[- ]\d{2}[- ]\d{2}(?!\d)/g, "PHONE");
  add(/(?<![\p{L}\p{N}_])(?:passport|паспорт|ssn|social security|document|документ|инн|снилс)\s*(?:number|номер|№|no\.?)?\s*[:=#-]?\s*([A-ZА-Я\d][A-ZА-Я\d -]{4,24}[A-ZА-Я\d])/giu, "DOCUMENT", 1, (s) => /\d/.test(s));
  add(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, "CARD", 0, luhn);
  add(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, "BANK_ACCOUNT", 0, iban);
  add(/(?<![\p{L}\p{N}_])(?:iban|bank account|account number|расч[её]тный сч[её]т|р\/с|бик)\s*[:=#]?\s*([A-ZА-Я\d][A-ZА-Я\d -]{5,34}[A-ZА-Я\d])/giu, "BANK_ACCOUNT", 1);
  return spans;
}

export class Privacy {
  private cache = new Map<string, CleanText>();
  private inflight = new Map<string, Promise<CleanText>>();
  private key = randomBytes(32);
  constructor(private entities: EntityScanner = new LocalEntities().scan) {}

  async scan(text: string): Promise<CleanText> {
    if (!text) return { text, counts: {} };
    if (text.length > 120_000) throw privacyUnavailable();
    const hash = createHmac("sha256", this.key).update(text).digest("hex");
    const cached = this.cache.get(hash);
    if (cached) return { text: cached.text, counts: { ...cached.counts } };
    // Вкладки, MCP и повторный опрос делят одну проверку до заполнения кеша.
    // Иначе одна длинная история многократно занимает очередь локальной модели.
    let pending = this.inflight.get(hash);
    if (!pending) {
      pending = this.scanFresh(text, hash).finally(() => { this.inflight.delete(hash); });
      this.inflight.set(hash, pending);
    }
    const result = await pending;
    return { text: result.text, counts: { ...result.counts } };
  }

  private async scanFresh(text: string, hash: string): Promise<CleanText> {
    // Сначала убираем секреты: локальная модель получает уже очищенную строку.
    const first = this.replace(text, rules(text));
    let entities: Span[];
    try { entities = await this.entities(first); } catch { throw privacyUnavailable(); }
    const safe = this.replace(first, entities);
    const result = { text: safe, counts: privacyCounts(safe) };
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(hash, result);
    return { text: result.text, counts: { ...result.counts } };
  }

  private replace(text: string, raw: Span[]): string {
    const markers = [...text.matchAll(MARKER)].map((m): Span => ({ start: m.index!, end: m.index! + m[0].length, category: m[1] as Category }));
    const mentions = [...text.matchAll(/(?<![\p{L}\p{N}])@{1,2}[\p{L}\p{N}_-]+/gu)].map((m): Span => ({ start: m.index!, end: m.index! + m[0].length, category: "PERSON" }));
    const priority = (s: Span) => s.category === "SECRET" ? 10 : ["PERSON", "ADDRESS"].includes(s.category) ? 0 : 5;
    const spans: Span[] = [];
    for (const s of [...raw].sort((a, b) => priority(b) - priority(a) || (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
      if (!CATEGORIES.includes(s.category) || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > text.length || s.end <= s.start) throw privacyUnavailable();
      if (priority(s) > 0 && markers.some((m) => s.start >= m.start && s.end <= m.end)) continue;
      if (s.category === "PERSON" && MODEL_NAMES.has(normalizeMention(text.slice(s.start, s.end)))) continue;
      let pieces = [{ ...s }];
      if (priority(s) === 0) {
        for (const excluded of [...markers, ...mentions]) pieces = pieces.flatMap((p) => {
          if (!overlaps(p, excluded)) return [p];
          return [
            ...(p.start < excluded.start ? [{ ...p, end: excluded.start }] : []),
            ...(p.end > excluded.end ? [{ ...p, start: excluded.end }] : []),
          ];
        });
      }
      for (let piece of pieces) {
        // Соседние окна NER могут увидеть разные части одной сущности.
        // Объединяем покрытие: отбрасывание второго окна раскрыло бы хвост.
        for (let i = 0; i < spans.length;) {
          const existing = spans[i]!;
          if (!overlaps(existing, piece)) { i++; continue; }
          piece = { start: Math.min(existing.start, piece.start), end: Math.max(existing.end, piece.end), category: priority(existing) >= priority(piece) ? existing.category : piece.category };
          spans.splice(i, 1);
          i = 0;
        }
        spans.push(piece);
      }
    }
    spans.sort((a, b) => a.start - b.start);
    const numbers = new Map<string, string>();
    const next: Partial<Record<Category, number>> = {};
    for (const m of text.matchAll(MARKER)) next[m[1] as Category] = Math.max(next[m[1] as Category] ?? 0, Number(m[2]));
    let out = "", from = 0;
    for (const s of spans) {
      const value = `${s.category}:${text.slice(s.start, s.end)}`;
      let replacement = numbers.get(value);
      if (!replacement) { const n = (next[s.category] ?? 0) + 1; next[s.category] = n; replacement = `[${s.category}_${n}]`; numbers.set(value, replacement); }
      out += text.slice(from, s.start) + replacement;
      from = s.end;
    }
    return out + text.slice(from);
  }

  protocol(text: string): string {
    // Служебные id не отдаём NER, но известные форматы секретов проверяем.
    return this.replace(text, rules(text));
  }

  async object<T>(value: T, scanUnknown = false, parentKey = ""): Promise<T> {
    if (typeof value === "string" && (CONTENT.has(parentKey) || (scanUnknown && !METADATA.has(parentKey)))) return (await this.scan(value)).text as T;
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await this.object(item, scanUnknown, parentKey));
      return out as T;
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = await this.object(item, scanUnknown, key);
      }
      return out as T;
    }
    return value;
  }
}
export const defaultPrivacy = new Privacy();
