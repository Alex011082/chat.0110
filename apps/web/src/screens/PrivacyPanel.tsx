import { Key } from "../ui/kit.tsx";
import { useRef, useState } from "react";
import type { PrivacyResult } from "@chat0110/chat-protocol";
import { checkPrivacy, privacyLabel } from "../privacy.ts";
import { s } from "../strings.ts";

export function PrivacyNotice({ text }: { text: string }) {
  const label = privacyLabel(text);
  return label ? <p className="m-0 text-cap text-ink-2">{label}</p> : null;
}

export function PrivacyPanel({ chatKey, text, onApply }: { chatKey: string; text: string; onApply: (value: string) => void }) {
  const [result, setResult] = useState<{ version: number; value: PrivacyResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({ text, version: 0 });
  if (current.current.text !== text) current.current = { text, version: current.current.version + 1 };
  const en = s.locale === "en";
  const preview = async () => {
    setBusy(true); setError(""); setResult(null);
    const source = text;
    const version = current.current.version;
    try {
      const value = await checkPrivacy(chatKey, source);
      if (current.current.version === version) setResult({ version, value });
    } catch (e) { setError(e instanceof Error ? e.message : en ? "Check unavailable" : "Проверка недоступна"); }
    finally { setBusy(false); }
  };
  const shown = result?.version === current.current.version ? result.value : null;
  return (
    <details className="border-t border-line pt-2 text-cap text-ink-2">
      <summary className="min-h-9 cursor-pointer py-2">{en ? "Data protection · on" : "Защита данных · включена"}</summary>
      <div className="flex max-h-[min(24svh,200px)] flex-col gap-3 overflow-y-auto overscroll-contain py-2 pr-1">
        <p className="m-0 max-w-[65ch]">{en ? "Secrets, emails, phones, documents, bank details, names and addresses are replaced before publication and delivery to AI. Originals are not saved." : "Ключи, пароли, email, телефоны, документы, реквизиты, имена и адреса заменяются до публикации и передачи ИИ. Оригиналы не сохраняются."}</p>
        <p className="m-0 max-w-[65ch]">{en ? "Names and addresses are recognized locally in Russian and English; recognition can make mistakes. Images, attachments and earlier Git history are outside this protection." : "Имена и адреса распознаются локально на русском и английском; возможны ошибки распознавания. Защита не охватывает изображения, вложения и прежнюю историю Git."}</p>
        <Key disabled={busy || !text.trim()} onClick={() => void preview()} className="self-start">{busy ? (en ? "Checking…" : "Проверяем…") : (en ? "Check before sending" : "Проверить перед отправкой")}</Key>
        {error ? <p role="alert" className="m-0 text-action-ink">{error}</p> : null}
        {shown ? <div role="status" ref={(node) => node?.scrollIntoView({ block: "nearest" })} className="flex flex-col gap-2">
          <p className="m-0">{privacyLabel(shown.text) ?? (en ? "No sensitive data found. Recognition may miss some data." : "Чувствительные данные не обнаружены. Возможны пропуски распознавания.")}</p>
          <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-slot bg-slot p-3 font-sans text-copy text-ink">{shown.text}</pre>
          {shown.text !== text ? <button type="button" onClick={() => { onApply(shown.text); setResult(null); }} className="min-h-10 self-start border-0 bg-transparent text-action-ink">{en ? "Use cleaned text" : "Применить очищенный текст"}</button> : null}
        </div> : null}
      </div>
    </details>
  );
}
