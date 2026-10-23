/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Decision, DecisionEventItem, DecisionItem, MessageItem, TimelineItem } from "@chat0110/chat-protocol";
import {
  acceptedDecisions,
  awaitsHuman,
  decisionActions,
  decisionEventText,
  decisionLamp,
  decisionRequest,
  decisionTitle,
  defaultEvidence,
  forkMessages,
  proposalOutline,
  proposeRequest,
  quietDecisionEvents,
  sourceCandidates,
  statusLabel,
} from "../src/lib/decision.ts";

function msg(id: string, over: Partial<MessageItem> = {}): MessageItem {
  return {
    kind: "message",
    id,
    author: "alex011082",
    display: "alex011082",
    source: "file",
    text: "текст",
    created_at: "2026-10-23T10:00:00Z",
    pending: false,
    ...over,
  };
}

function dec(id: string, over: Partial<Decision> = {}): Decision {
  return {
    id,
    title: `Решение ${id}`,
    status: "proposed",
    created_at: "2026-10-23T10:00:00Z",
    created_by: "alex011082",
    source_messages: [],
    text: "",
    history: [],
    ...over,
  };
}

function ev(over: Partial<DecisionEventItem> = {}): DecisionEventItem {
  return {
    kind: "decision_event",
    id: "20261023T101000Z-alex011082-ev01",
    decision_id: "20261023T100000Z-alex011082-d001",
    action: "accept",
    title: "Вакуумные руки",
    author: "alex011082",
    display: "alex011082",
    text: "",
    created_at: "2026-10-23T10:10:00Z",
    ...over,
  };
}

describe("лампа и клавиши по статусу", () => {
  test("зелёная — принято, оранжевая — ждёт человека, серая — отклонено или заменено", () => {
    expect(decisionLamp("accepted")).toBe("live");
    expect(decisionLamp("proposed")).toBe("act");
    expect(decisionLamp("under_discussion")).toBe("act");
    expect(decisionLamp("reopened")).toBe("act");
    expect(decisionLamp("rejected")).toBe("off");
    expect(decisionLamp("superseded")).toBe("off");
  });

  test("ждёт человека — предложено, обсуждается, открыто заново", () => {
    expect(["proposed", "under_discussion", "reopened"].every((st) => awaitsHuman(st as Decision["status"]))).toBe(true);
    expect(["accepted", "rejected", "superseded"].some((st) => awaitsHuman(st as Decision["status"]))).toBe(false);
  });

  // Как разрешает сервер: принять отклонённое или отклонить принятое — только через «Открыть заново».
  test("ждёт — Принять, Отклонить, Обсудить; решено — Открыть заново и Обсудить; заменено — только Открыть заново", () => {
    expect(decisionActions("proposed", true)).toEqual(["accept", "reject", "discuss"]);
    expect(decisionActions("under_discussion", true)).toEqual(["accept", "reject", "discuss"]);
    expect(decisionActions("reopened", true)).toEqual(["accept", "reject", "discuss"]);
    expect(decisionActions("accepted", true)).toEqual(["reopen", "discuss"]);
    expect(decisionActions("rejected", true)).toEqual(["reopen", "discuss"]);
    expect(decisionActions("superseded", true)).toEqual(["reopen"]);
    expect(decisionActions("proposed", false)).toEqual([]);
  });
});

describe("statusLabel — подпись статуса на карточке", () => {
  const opts = {
    titleOf: (id: string) => (id === "new" ? "Выдвижной мост" : null),
    when: (iso: string) => iso.slice(11, 16),
  };
  test("простые статусы", () => {
    expect(statusLabel(dec("a"), opts)).toBe("предложено");
    expect(statusLabel(dec("a", { status: "under_discussion" }), opts)).toBe("обсуждается");
    expect(statusLabel(dec("a", { status: "rejected" }), opts)).toBe("отклонено");
    expect(statusLabel(dec("a", { status: "reopened" }), opts)).toBe("открыто заново");
  });
  test("принято · кто когда", () => {
    const d = dec("a", { status: "accepted", decided_by: "alex011082", decided_at: "2026-10-23T10:12:00Z" });
    expect(statusLabel(d, opts)).toBe("принято · alex011082 10:12");
    expect(statusLabel(dec("a", { status: "accepted" }), opts)).toBe("принято");
  });
  test("заменено → новое решение; новое неизвестно — просто «заменено»", () => {
    expect(statusLabel(dec("a", { status: "superseded", superseded_by: "new" }), opts)).toBe("заменено → Выдвижной мост");
    expect(statusLabel(dec("a", { status: "superseded", superseded_by: "gone" }), opts)).toBe("заменено");
  });
});

describe("decisionTitle — название из первой строки сообщения", () => {
  test("первая непустая строка без Markdown", () => {
    expect(decisionTitle("\n\nПредлагаю **вакуумные руки**: четыре присоски\n\nРиск: пыль")).toBe(
      "Предлагаю вакуумные руки: четыре присоски",
    );
  });
  test("длинная — обрезана по слову с «…», не длиннее лимита", () => {
    const t = decisionTitle("слово ".repeat(60), 40);
    expect(Array.from(t).length).toBeLessThanOrEqual(40);
    expect(t.endsWith("…")).toBe(true);
  });
  test("пусто — пустая строка", () => {
    expect(decisionTitle("   \n ")).toBe("");
  });
});

describe("запросы", () => {
  test("decisionRequest — обрезает поля, пустое не шлёт", () => {
    expect(
      decisionRequest({ title: "  Мост  ", text: "  ", sources: ["a", "b"], supersedes: "", accept: true }),
    ).toEqual({ title: "Мост", source_messages: ["a", "b"], accept: true });
    expect(
      decisionRequest({ title: "Мост", text: " быстрее ", sources: [], supersedes: "old", accept: false }),
    ).toEqual({ title: "Мост", text: "быстрее", source_messages: [], supersedes: "old", accept: false });
  });

  test("proposeRequest — текст обязателен по контракту, замена — если выбрана", () => {
    expect(proposeRequest({ title: " Мост ", text: " суть ", sources: ["m1"], supersedes: "" })).toEqual({
      title: "Мост",
      text: "суть",
      source_messages: ["m1"],
    });
    expect(proposeRequest({ title: "Мост", text: "", sources: [], supersedes: "d1" })).toEqual({
      title: "Мост",
      text: "",
      source_messages: [],
      supersedes: "d1",
    });
  });
});

describe("сообщения для выбора оснований", () => {
  const items: TimelineItem[] = [
    { kind: "created", id: "s", actor: "alex011082", created_at: "2026-10-23T09:00:00Z", url: "u" },
    msg("m1", { created_at: "2026-10-23T10:01:00Z" }),
    msg("m2", { author: "claude", display: "Claude", created_at: "2026-10-23T10:02:00Z" }),
    msg("m3", { author: "codex", display: "Codex", created_at: "2026-10-23T10:03:00Z" }),
    msg("p1", { author: "claude", display: "Claude", pending: true, created_at: "2026-10-23T10:04:00Z" }),
    msg("m4", { created_at: "2026-10-23T10:05:00Z" }),
  ];

  test("forkMessages — только свои влитые сообщения, по времени", () => {
    expect(forkMessages(items).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  test("sourceCandidates — свежие первыми, выбранное всегда в списке", () => {
    expect(sourceCandidates(items, "m3", 2).map((m) => m.id)).toEqual(["m4", "m3"]);
    expect(sourceCandidates(items, "m1", 2).map((m) => m.id)).toEqual(["m4", "m3", "m1"]);
    expect(sourceCandidates(items, "nope", 10).map((m) => m.id)).toEqual(["m4", "m3", "m2", "m1"]);
  });

  test("defaultEvidence — три последних не-человеческих сообщения", () => {
    const more = [...items, msg("m5", { author: "claude", display: "Claude", created_at: "2026-10-23T10:06:00Z" }), msg("m6", { author: "codex", display: "Codex", created_at: "2026-10-23T10:07:00Z" })];
    expect(defaultEvidence(forkMessages(more))).toEqual(["m3", "m5", "m6"]);
    expect(defaultEvidence(forkMessages(items))).toEqual(["m2", "m3"]);
  });
});

describe("proposalOutline — заготовка «Суть и аргументы»", () => {
  test("зачем Fork, его принятые решения и главное из сообщений", () => {
    const text = proposalOutline({
      reason: "Разобрать мост отдельно",
      decisions: [
        dec("d1", { title: "Стыковка штырями", status: "accepted" }),
        dec("d2", { title: "Отклонённое", status: "rejected" }),
      ],
      messages: [msg("m1", { author: "codex", display: "Codex", text: "Мост держит **11 коробок** в минуту.\n\nУзкое место — стык." })],
    });
    expect(text).toBe(
      [
        "Разобрать мост отдельно",
        "",
        "Решения в Fork:",
        "- Стыковка штырями",
        "",
        "Главное из Fork:",
        "- Codex: Мост держит 11 коробок в минуту. Узкое место — стык.",
      ].join("\n"),
    );
  });

  test("ничего нет — пустая строка; длинные сообщения — коротко", () => {
    expect(proposalOutline({ reason: "", decisions: [], messages: [] })).toBe("");
    const long = proposalOutline({ reason: "", decisions: [], messages: [msg("m", { text: "очень ".repeat(80) })] });
    expect(long.startsWith("Главное из Fork:\n- alex011082: очень")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("решения для «Заменяет»", () => {
  test("acceptedDecisions — только принятые, свежие первыми", () => {
    const list = [
      dec("a", { status: "accepted", created_at: "2026-10-23T10:00:00Z" }),
      dec("b", { status: "proposed" }),
      dec("c", { status: "accepted", created_at: "2026-10-23T11:00:00Z" }),
      dec("d", { status: "superseded" }),
    ];
    expect(acceptedDecisions(list).map((d) => d.id)).toEqual(["c", "a"]);
  });
});

describe("decisionEventText — тихие строки событий", () => {
  test("человек", () => {
    expect(decisionEventText(ev())).toBe("alex011082 принял решение «Вакуумные руки»");
    expect(decisionEventText(ev({ action: "reject" }))).toBe("alex011082 отклонил решение «Вакуумные руки»");
    expect(decisionEventText(ev({ action: "reopen" }))).toBe("alex011082 открыл заново решение «Вакуумные руки»");
    expect(decisionEventText(ev({ action: "discuss" }))).toBe("alex011082 вынес на обсуждение решение «Вакуумные руки»");
  });
  test("агент без права решать — «решает человек»", () => {
    expect(decisionEventText(ev({ author: "claude", display: "Claude", ignored: true }))).toBe(
      "Claude предложил принять «Вакуумные руки» — решает человек",
    );
    expect(decisionEventText(ev({ author: "codex", display: "Codex", action: "reject", ignored: true }))).toBe(
      "Codex предложил отклонить «Вакуумные руки» — решает человек",
    );
  });
});

describe("quietDecisionEvents — «Сразу принять» не дублирует карточку строкой", () => {
  const card = (d: Decision): DecisionItem => ({
    kind: "decision",
    id: d.id,
    author: d.created_by,
    display: d.created_by,
    decision: d,
    created_at: d.created_at,
  });
  const D = "20261023T100000Z-alex011082-d001";

  test("принятие автором в ту же минуту — тихо; позже или другим человеком — строкой", () => {
    const items: TimelineItem[] = [
      card(dec(D, { status: "accepted" })),
      ev({ id: "e1", decision_id: D, created_at: "2026-10-23T10:00:00Z" }),
      ev({ id: "e2", decision_id: D, action: "reopen", created_at: "2026-10-23T10:00:20Z" }),
      ev({ id: "e3", decision_id: D, created_at: "2026-10-23T11:00:00Z" }),
      ev({ id: "e4", decision_id: D, author: "bob", display: "bob", created_at: "2026-10-23T10:00:10Z" }),
      ev({ id: "e5", decision_id: D, author: "claude", display: "Claude", ignored: true, created_at: "2026-10-23T10:00:05Z" }),
    ];
    expect([...quietDecisionEvents(items)]).toEqual(["e1"]);
  });
});
