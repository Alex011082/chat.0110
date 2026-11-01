import { afterEach, expect, test } from "bun:test";
import { s, forms, setLocale, chooseLocale } from "../src/strings.ts";
import { ago, dayLabel } from "../src/lib/time.ts";
import { plural } from "../src/lib/text.ts";
afterEach(() => setLocale("ru"));
test("смена языка обновляет подписи, даты и множественное число", () => {
  setLocale("en");
  expect(s.composer.send).toBe("Send");
  expect(ago("2026-10-26T10:00:00Z", Date.parse("2026-10-26T10:02:00Z"), "UTC")).toBe("2 min ago");
  expect(dayLabel("2026-10-26", Date.parse("2026-10-26T12:00:00Z"), "UTC")).toContain("Today");
  expect(plural(2, forms.messages)).toBe("2 messages");
  setLocale("ru");
  expect(plural(2, forms.messages)).toBe("2 сообщения");
});
test("сохранённый выбор имеет приоритет, неизвестный язык безопасен", () => {
  expect(chooseLocale("ru", "en-US")).toBe("ru");
  expect(chooseLocale(null, "en-US")).toBe("en");
  expect(chooseLocale("xx", "ru-RU")).toBe("ru");
});
