/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { ago, agoShort, clock, dateTimeShort, dayKey, dayLabel, groupByDay, isFresh } from "../src/lib/time.ts";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const UTC = "UTC";

describe("ago — «2 мин назад»", () => {
  test("меньше минуты и будущее — «только что»", () => {
    expect(ago("2026-10-23T11:59:30Z", NOW, UTC)).toBe("только что");
    expect(ago("2026-10-23T12:00:20Z", NOW, UTC)).toBe("только что");
  });
  test("минуты", () => {
    expect(ago("2026-10-23T11:58:00Z", NOW, UTC)).toBe("2 мин назад");
    expect(ago("2026-10-23T11:01:00Z", NOW, UTC)).toBe("59 мин назад");
  });
  test("часы в тот же день", () => {
    expect(ago("2026-10-23T09:00:00Z", NOW, UTC)).toBe("3 ч назад");
    expect(ago("2026-10-23T00:10:00Z", NOW, UTC)).toBe("11 ч назад");
  });
  test("вчера по календарю", () => {
    expect(ago("2026-10-22T20:00:00Z", NOW, UTC)).toBe("вчера");
    expect(ago("2026-10-22T00:00:01Z", NOW, UTC)).toBe("вчера");
  });
  test("около полуночи считаются минуты, а не «вчера»", () => {
    const justAfterMidnight = Date.parse("2026-10-23T00:10:00Z");
    expect(ago("2026-10-22T23:50:00Z", justAfterMidnight, UTC)).toBe("20 мин назад");
  });
  test("раньше — дата, в другом году — с годом", () => {
    expect(ago("2026-10-20T08:00:00Z", NOW, UTC)).toBe("20 окт.");
    expect(ago("2025-10-20T08:00:00Z", NOW, UTC)).toBe("20 окт. 2025 г.");
  });
  test("календарь считается в часовом поясе человека", () => {
    // 22:30 UTC 22-го — это уже 23-е в Иерусалиме (UTC+3)
    expect(ago("2026-10-22T22:30:00Z", NOW, "Asia/Jerusalem")).toBe("13 ч назад");
    expect(ago("2026-10-22T22:30:00Z", NOW, UTC)).toBe("вчера");
  });
});

describe("agoShort — для строк списка", () => {
  test("без «назад»", () => {
    expect(agoShort("2026-10-23T11:58:00Z", NOW, UTC)).toBe("2 мин");
    expect(agoShort("2026-10-23T11:00:00Z", NOW, UTC)).toBe("1 ч");
    expect(agoShort("2026-10-22T11:00:00Z", NOW, UTC)).toBe("вчера");
    expect(agoShort("2026-10-23T11:59:59Z", NOW, UTC)).toBe("только что");
    expect(agoShort("2026-10-01T11:00:00Z", NOW, UTC)).toBe("1 окт.");
  });
});

describe("isFresh — лампа «живо» 15 минут", () => {
  test("граница", () => {
    expect(isFresh("2026-10-23T11:46:00Z", NOW)).toBe(true);
    expect(isFresh("2026-10-23T11:44:00Z", NOW)).toBe(false);
    expect(isFresh("2026-10-23T12:05:00Z", NOW)).toBe(true);
  });
  test("мусор — не живо", () => {
    expect(isFresh("не дата", NOW)).toBe(false);
  });
});

describe("clock и даты", () => {
  test("часы:минуты, 24 часа", () => {
    expect(clock("2026-10-23T10:03:00Z", UTC)).toBe("10:03");
    expect(clock("2026-10-23T10:03:00Z", "Asia/Jerusalem")).toBe("13:03");
    expect(clock("2026-10-23T00:05:00Z", UTC)).toBe("00:05");
  });
  test("ключ дня в поясе", () => {
    expect(dayKey("2026-10-22T22:30:00Z", "Asia/Jerusalem")).toBe("2026-10-23");
    expect(dayKey("2026-10-22T22:30:00Z", UTC)).toBe("2026-10-22");
  });
  test("короткая дата со временем", () => {
    expect(dateTimeShort("2026-10-23T10:02:00Z", UTC)).toBe("23 окт., 10:02");
  });
});

describe("dayLabel — разделители ленты", () => {
  test("сегодня, вчера, раньше, прошлый год", () => {
    expect(dayLabel("2026-10-23", NOW, UTC)).toBe("Сегодня, 23 октября");
    expect(dayLabel("2026-10-22", NOW, UTC)).toBe("Вчера, 22 октября");
    expect(dayLabel("2026-10-21", NOW, UTC)).toBe("21 октября");
    expect(dayLabel("2025-12-31", NOW, UTC)).toBe("31 декабря 2025");
  });
  test("вчера через границу месяца", () => {
    expect(dayLabel("2026-10-31", Date.parse("2026-11-01T09:00:00Z"), UTC)).toBe("Вчера, 31 октября");
  });
});

describe("groupByDay", () => {
  test("подряд идущие элементы одного дня — одна группа, порядок сохраняется", () => {
    const items = [
      { id: "a", at: "2026-10-22T09:00:00Z" },
      { id: "b", at: "2026-10-22T18:00:00Z" },
      { id: "c", at: "2026-10-23T08:00:00Z" },
      { id: "d", at: "2026-10-23T11:00:00Z" },
    ];
    const groups = groupByDay(items, (i) => i.at, NOW, UTC);
    expect(groups.map((g) => g.key)).toEqual(["2026-10-22", "2026-10-23"]);
    expect(groups.map((g) => g.label)).toEqual(["Вчера, 22 октября", "Сегодня, 23 октября"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["c", "d"]);
  });
  test("пусто — пусто", () => {
    expect(groupByDay([], (i: { at: string }) => i.at, NOW, UTC)).toEqual([]);
  });
});
