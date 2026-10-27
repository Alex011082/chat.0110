import { privacyCounts, type PrivacyCategory, type PrivacyResult } from "@chat0110/chat-protocol";
import { s } from "./strings.ts";
import { plural } from "./lib/text.ts";

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
  const names: Record<PrivacyCategory, [string, string, string]> = s.locale === "en"
    ? { SECRET: ["secret", "secrets", "secrets"], EMAIL: ["email", "emails", "emails"], PHONE: ["phone", "phones", "phones"], DOCUMENT: ["document", "documents", "documents"], CARD: ["card", "cards", "cards"], BANK_ACCOUNT: ["bank account", "bank accounts", "bank accounts"], PERSON: ["name", "names", "names"], ADDRESS: ["address", "addresses", "addresses"] }
    : { SECRET: ["секрет", "секрета", "секретов"], EMAIL: ["email", "email", "email"], PHONE: ["телефон", "телефона", "телефонов"], DOCUMENT: ["документ", "документа", "документов"], CARD: ["карта", "карты", "карт"], BANK_ACCOUNT: ["счёт", "счёта", "счетов"], PERSON: ["имя", "имени", "имён"], ADDRESS: ["адрес", "адреса", "адресов"] };
  const items = Object.entries(counts).map(([category, count]) => plural(count, names[category as PrivacyCategory]));
  return items.length ? `${s.locale === "en" ? "Hidden" : "Скрыто"}: ${items.join(", ")}` : null;
}
