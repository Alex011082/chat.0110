import { describe, expect, test } from "bun:test";
import { Privacy } from "../src/privacy.ts";
import { cleanConversationFile } from "../src/privacy-files.ts";

const rules = new Privacy(async () => []);
const key = "ghp_" + "Ab3dE7gH9jK2mN4pQ6rS8tU0vW1xY5zA";
describe("защита данных", () => {
  test("секреты, кодовые блоки, URL и контакты заменяются до записи", async () => {
    const text = `@чатжпт @@Клод\n\`\`\`env\nAPI_KEY=${key}\nPASSWORD=very-private-value\n\`\`\`\nhttps://example.org/?access_token=private-value-123\nanna@example.org +7 (999) 123-45-67`;
    const result = await rules.scan(text);
    expect(result.text).toContain("@чатжпт @@Клод");
    for (const raw of [key, "very-private-value", "private-value-123", "anna@example.org", "999"]) expect(result.text).not.toContain(raw);
    expect(result.counts.EMAIL).toBe(1);
    expect(result.counts.PHONE).toBe(1);
    expect(result.text).toContain("https://example.org/?access_token=[SECRET_");
    expect(await rules.scan(result.text)).toEqual(result);
  });
  test("имена и адреса, unicode offsets и повторяющиеся значения", async () => {
    const text = "👋 Иван Петров: Иван Петров, улица Ленина 12. @Клод";
    const privacy = new Privacy(async () => [
      { start: text.indexOf("Иван"), end: text.indexOf(":"), category: "PERSON" },
      { start: text.indexOf("Иван", 8), end: text.indexOf(","), category: "PERSON" },
      { start: text.indexOf("улица"), end: text.indexOf(". @"), category: "ADDRESS" },
      { start: text.indexOf("Клод"), end: text.length, category: "PERSON" },
    ]);
    const result = await privacy.scan(text);
    expect(result.text).toBe("👋 [PERSON_1]: [PERSON_1], [ADDRESS_1]. @Клод");
    expect(result.counts).toEqual({ PERSON: 2, ADDRESS: 1 });
  });
  test("сбой распознавания закрывает публикацию, текст ошибки не раскрывается", async () => {
    const privacy = new Privacy(async () => { throw new Error(key); });
    try { await privacy.scan("Привет"); throw new Error("не отклонено"); }
    catch (error: any) { expect(error.code).toBe("privacy_unavailable"); expect(error.message).not.toContain(key); }
  });
  test("безопасные числа, SHA, версии и placeholder не маскируются", async () => {
    const text = "19 × 23 = 437; Node 22; 2026-10-27; commit " + "a1".repeat(20) + "; [PERSON_1] @sol @@astra";
    expect((await rules.scan(text)).text).toBe(text);
  });
  test("приватный ключ и строка подключения скрываются целиком", async () => {
    const pem = ["-----BEGIN PRIVATE KEY-----", "example-only", "-----END PRIVATE KEY-----"].join("\n");
    const result = await rules.scan(`${pem}\npostgres://admin:secret@db.example.org/private`);
    expect(result.text).toBe("[SECRET_1]\n[SECRET_2]");
  });
  test("сканирование объекта очищает содержимое, но сохраняет протокол", async () => {
    const result = await rules.object({ text: key, title: "anna@example.org", author: "claude", reply_to: "m1", prompt: key, nested: [{ diff_hunk: key }], gaps: [key] });
    expect(result.author).toBe("claude");
    expect(result.reply_to).toBe("m1");
    expect(JSON.stringify(result)).not.toContain(key);
  });
  test("реквизиты проверяются, маскируются IBAN и карты с контрольной суммой", async () => {
    const result = await rules.scan("IBAN DE89 3704 0044 0532 0130 00; карта 4111 1111 1111 1111; паспорт 45 12 345678");
    expect(result.text).toContain("[BANK_ACCOUNT_1]");
    expect(result.text).toContain("[CARD_1]");
    expect(result.text).toContain("[DOCUMENT_1]");
  });
  test("русские пароли и значения с пробелами скрываются целиком", async () => {
    const result = await rules.scan('пароль: "длинный секрет с пробелами"\npassword="long private phrase"\ntoken=[PERSON_1]private-suffix');
    for (const raw of ["длинный", "пробелами", "long", "phrase", "private-suffix"]) expect(result.text).not.toContain(raw);
    expect(result.text).toBe('пароль: "[SECRET_1]"\npassword="[SECRET_2]"\ntoken=[SECRET_3]');
    expect((await rules.scan(result.text)).text).toBe(result.text);
  });
  test("названия моделей сохраняются, похожие имена людей очищаются", async () => {
    const privacy = new Privacy(async (text) => [
      { start: 0, end: 6, category: "PERSON" },
      { start: text.indexOf("John"), end: text.length, category: "PERSON" },
    ]);
    expect((await privacy.scan("Claude и John Smith")).text).toBe("Claude и [PERSON_1]");
  });
  test("длинный текст проверяется без квадратичного поиска email", async () => {
    const text = "я".repeat(59_000) + " @chatgpt";
    const at = performance.now();
    expect((await rules.scan(text)).text).toBe(text);
    expect(performance.now() - at).toBeLessThan(2000);
  });
  test("переменные окружения с префиксом очищаются, включая значения в кавычках", async () => {
    const result = await rules.scan('DATABASE_PASSWORD=private-db-value\nXAI_API_KEY="private xai value"\nAWS_SECRET_ACCESS_KEY=private-aws-value\nGITHUB_TOKEN=private-github-value\nGITHUB_WEBHOOK_SECRET=private-webhook-value');
    expect(result.text).toBe('DATABASE_PASSWORD=[SECRET_1]\nXAI_API_KEY="[SECRET_2]"\nAWS_SECRET_ACCESS_KEY=[SECRET_3]\nGITHUB_TOKEN=[SECRET_4]\nGITHUB_WEBHOOK_SECRET=[SECRET_5]');
  });
  test("пересекающиеся PERSON охватывают всё найденное имя", async () => {
    const privacy = new Privacy(async () => [{ start: 0, end: 10, category: "PERSON" }, { start: 5, end: 19, category: "PERSON" }]);
    expect((await privacy.scan("John Smith Williams")).text).toBe("[PERSON_1]");
  });
  test("неизвестное поле frontmatter не переносит секрет в Git", async () => {
    const content = "---\nid: 20261027T060000Z-codex-abcd\nauthor: codex\npassword: private-example-value\n---\nБезопасный текст";
    await expect(cleanConversationFile(rules, "chats/20261027-abcd/messages/20261027T060000Z-codex-abcd.md", content)).rejects.toMatchObject({ code: "forbidden" });
  });
  test("неизвестные поля JSON тоже очищаются при копировании", async () => {
    const raw = JSON.stringify({ schema_version: 1, chat_id: "20261027-abcd", internal_note: "private@example.org", DATABASE_PASSWORD: "private-value" });
    const safe = await cleanConversationFile(rules, "Chat/conversations/20261027-abcd/chat.json", raw);
    expect(safe).not.toContain("private@example.org");
    expect(safe).not.toContain("private-value");
    expect(JSON.parse(safe).chat_id).toBe("20261027-abcd");
  });
});
