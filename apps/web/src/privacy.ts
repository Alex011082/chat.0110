import { privacyCounts, type PrivacyCategory, type PrivacyResult } from "@chat0110/chat-protocol";
import { s } from "./strings.ts";

export async function checkPrivacy(chatKey: string, text: string): Promise<PrivacyResult> {
  const path = chatKey.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`/api/chats/${path}/privacy`, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(s.locale === "en" ? "Data protection could not check the text. Try again; nothing was published." : "Защита данных не смогла проверить текст. Повторите попытку; ничего не опубликовано.");
  return response.json();
}
export function privacyLabel(text: string): string | null {
  const counts = privacyCounts(text);
  const names: Record<PrivacyCategory, string> = s.locale === "en"
    ? { SECRET: "secrets", EMAIL: "emails", PHONE: "phones", DOCUMENT: "documents", CARD: "cards", BANK_ACCOUNT: "bank accounts", PERSON: "names", ADDRESS: "addresses" }
    : { SECRET: "секреты", EMAIL: "email", PHONE: "телефоны", DOCUMENT: "документы", CARD: "карты", BANK_ACCOUNT: "счета", PERSON: "имена", ADDRESS: "адреса" };
  const items = Object.entries(counts).map(([category, count]) => `${names[category as PrivacyCategory]}: ${count}`);
  return items.length ? `${s.locale === "en" ? "Hidden" : "Скрыто"}: ${items.join(", ")}` : null;
}
