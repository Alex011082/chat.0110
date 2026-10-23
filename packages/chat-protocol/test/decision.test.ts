import { describe, expect, test } from "bun:test";
import { foldDecisions, parseDecisionFile, serializeDecisionFile, type DecisionEvent } from "../src/decision.ts";
import { isDecisionPath } from "../src/ids.ts";
import { buildTimeline, type TimelineInput } from "../src/timeline.ts";

const CHAT = "20261023-k7q2";
const D1 = "20261023T110000Z-alex011082-d001";
const D2 = "20261024T090000Z-alex011082-d002";

function ev(over: Partial<DecisionEvent> & { id: string; action: DecisionEvent["action"] }): DecisionEvent {
  return { decision: over.id, author: "alex011082", created_at: "2026-10-23T11:00:00.000Z", source_messages: [], text: "", ...over };
}

describe("файл события решения", () => {
  test("предложение пишется и читается со всеми полями", () => {
    const e = ev({
      id: D2, action: "propose", created_at: "2026-10-24T09:00:00.000Z",
      title: "Перейти на выдвижной мост", source_messages: ["20261024T080000Z-codex-aaaa", "c77"],
      from_chat: "20261024-m2p9", supersedes: D1, text: "Мост даёт 11 коробок в минуту против 9.",
    });
    const name = `${D2}.md`;
    expect(parseDecisionFile(name, serializeDecisionFile(e))).toEqual(e);
  });

  test("id — из имени файла, у предложения decision совпадает с id", () => {
    const content = "---\ndecision: 20261023T000000Z-x-zzzz\naction: propose\ntitle: Т\n---\n";
    expect(parseDecisionFile(`${D1}.md`, content)).toMatchObject({ id: D1, decision: D1, action: "propose" });
  });

  test("неизвестное действие или чужое имя — не событие", () => {
    expect(parseDecisionFile(`${D1}.md`, "---\naction: delete\ndecision: x\n---\n")).toBeNull();
    expect(parseDecisionFile("readme.md", "---\naction: propose\n---\n")).toBeNull();
  });

  test("принятие без ссылки на решение — не событие", () => {
    expect(parseDecisionFile(`${D2}.md`, "---\naction: accept\n---\n")).toBeNull();
  });

  test("путь события решения узнаётся только в своей папке", () => {
    expect(isDecisionPath(CHAT, `chats/${CHAT}/decisions/${D1}.md`)).toBe(true);
    expect(isDecisionPath(CHAT, `chats/${CHAT}/messages/${D1}.md`)).toBe(false);
  });
});

describe("статус решения", () => {
  test("предложено → принято человеком", () => {
    const [d] = foldDecisions([
      ev({ id: D1, action: "propose", title: "Вакуумные руки" }),
      ev({ id: "20261023T120000Z-alex011082-a001", decision: D1, action: "accept", created_at: "2026-10-23T12:00:00.000Z" }),
    ]);
    expect(d).toMatchObject({ id: D1, title: "Вакуумные руки", status: "accepted", decided_by: "alex011082", decided_at: "2026-10-23T12:00:00.000Z" });
    expect(d!.history.map((h) => h.action)).toEqual(["propose", "accept"]);
  });

  test("обсуждение, отклонение, повторное открытие", () => {
    const base = ev({ id: D1, action: "propose", title: "Т" });
    const at = (m: number) => `2026-10-23T12:0${m}:00.000Z`;
    const fold = (...more: DecisionEvent[]) => foldDecisions([base, ...more])[0]!.status;
    expect(fold(ev({ id: "20261023T120100Z-codex-x001", decision: D1, action: "discuss", author: "codex", created_at: at(1) }))).toBe("under_discussion");
    expect(fold(ev({ id: "20261023T120200Z-alex011082-x002", decision: D1, action: "reject", created_at: at(2) }))).toBe("rejected");
    expect(fold(
      ev({ id: "20261023T120200Z-alex011082-x002", decision: D1, action: "accept", created_at: at(2) }),
      ev({ id: "20261023T120300Z-alex011082-x003", decision: D1, action: "reopen", created_at: at(3) }),
    )).toBe("reopened");
  });

  test("принятое новое решение помечает заменённое, старое не исчезает", () => {
    const ds = foldDecisions([
      ev({ id: D1, action: "propose", title: "Вакуумные руки" }),
      ev({ id: "20261023T120000Z-alex011082-a001", decision: D1, action: "accept", created_at: "2026-10-23T12:00:00.000Z" }),
      ev({ id: D2, action: "propose", title: "Мост", supersedes: D1, from_chat: "20261024-m2p9", created_at: "2026-10-24T09:00:00.000Z" }),
      ev({ id: "20261024T100000Z-alex011082-a002", decision: D2, action: "accept", created_at: "2026-10-24T10:00:00.000Z" }),
    ]);
    expect(ds.map((d) => [d.id, d.status])).toEqual([[D1, "superseded"], [D2, "accepted"]]);
    expect(ds[0]).toMatchObject({ superseded_by: D2 });
    expect(ds[1]).toMatchObject({ supersedes: D1, from_chat: "20261024-m2p9" });
  });

  test("пока замена не принята, старое решение остаётся принятым", () => {
    const ds = foldDecisions([
      ev({ id: D1, action: "propose", title: "А" }),
      ev({ id: "20261023T120000Z-alex011082-a001", decision: D1, action: "accept", created_at: "2026-10-23T12:00:00.000Z" }),
      ev({ id: D2, action: "propose", title: "Б", supersedes: D1, created_at: "2026-10-24T09:00:00.000Z" }),
    ]);
    expect(ds.map((d) => d.status)).toEqual(["accepted", "proposed"]);
  });

  test("агент не может принять или отклонить — событие в истории, статус не меняется", () => {
    const [d] = foldDecisions([
      ev({ id: D1, action: "propose", title: "Т", author: "claude" }),
      ev({ id: "20261023T120000Z-claude-a001", decision: D1, action: "accept", author: "claude", created_at: "2026-10-23T12:00:00.000Z" }),
    ]);
    expect(d!.status).toBe("proposed");
    expect(d!.history[1]).toMatchObject({ action: "accept", ignored: true });
  });

  test("порядок событий — по времени, а не по порядку файлов", () => {
    const [d] = foldDecisions([
      ev({ id: "20261023T120000Z-alex011082-a001", decision: D1, action: "accept", created_at: "2026-10-23T12:00:00.000Z" }),
      ev({ id: D1, action: "propose", title: "Т" }),
    ]);
    expect(d!.status).toBe("accepted");
  });

  test("события чужого решения и повторное предложение игнорируются", () => {
    const ds = foldDecisions([
      ev({ id: D1, action: "propose", title: "Т" }),
      ev({ id: D1, action: "propose", title: "Дубль" }),
      ev({ id: "20261023T120000Z-alex011082-a001", decision: "20261023T000000Z-x-none", action: "accept", created_at: "2026-10-23T12:00:00.000Z" }),
    ]);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.title).toBe("Т");
  });
});

describe("решения в ленте", () => {
  const input: TimelineInput = {
    chatId: CHAT,
    files: [],
    commits: [
      { sha: "c1", message: "решение", login: "Alex011082", name: "A", date: "2026-10-23T11:00:01Z", added: [`chats/${CHAT}/decisions/${D1}.md`], url: "" },
    ],
    comments: [],
    reviews: [],
    reviewComments: [],
    agentPrs: [],
    decisions: [
      { name: `${D1}.md`, content: serializeDecisionFile(ev({ id: D1, action: "propose", title: "Вакуумные руки", text: "Почему так" })) },
      { name: "20261023T120000Z-alex011082-a001.md", content: serializeDecisionFile(ev({ id: "20261023T120000Z-alex011082-a001", decision: D1, action: "accept", created_at: "2026-10-23T12:00:00.000Z" })) },
    ],
  };

  test("предложение — карточка решения с текущим статусом, дальше — строки событий", () => {
    const items = buildTimeline(input);
    expect(items.map((i) => i.kind)).toEqual(["decision", "decision_event"]);
    expect(items[0]).toMatchObject({ id: D1, decision: { title: "Вакуумные руки", status: "accepted" } });
    expect(items[1]).toMatchObject({ decision_id: D1, action: "accept", title: "Вакуумные руки", author: "alex011082" });
  });

  test("коммит с одними решениями — не событие push", () => {
    expect(buildTimeline(input).some((i) => i.kind === "push")).toBe(false);
  });
});
