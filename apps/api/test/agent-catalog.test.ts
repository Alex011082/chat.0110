import { expect, test } from "bun:test";
import {
  agentCards,
  participationTask,
  connectionInstructions,
} from "../../web/src/lib/agent-catalog.ts";

test("инструкции карточек сохраняют точный alias и session_id даже без адреса чата", () => {
  for (const en of [false, true]) {
    const cards = agentCards(en);
    const copied = connectionInstructions(cards[1]!, en, null);
    expect(copied).toContain("\n\n");
    expect(copied).not.toContain("\\n");
    expect(new Set(cards.map((card) => card.id)).size).toBe(8);
    for (const card of cards.filter(
      (card) => !["chatgpt", "other-ai"].includes(card.id),
    )) {
      for (const context of [
        null,
        { repo: "Alex011082/terminal0110", chat_id: "20261026-oxo7" },
      ]) {
        const task = participationTask(card, en, context);
        expect(task).toContain(`"alias":"${card.id}"`);
        expect(task).toContain(`"author":"${card.role}"`);
        expect(task).toContain("session_id");
        expect(task).toContain("chat0110_reply");
        if (context) expect(task).toContain('"repo":"Alex011082/terminal0110"');
      }
    }
    const manual = participationTask(
      cards.find((card) => card.id === "other-ai")!,
      en,
      null,
    );
    expect(manual).toContain("GitHub");
    expect(manual).not.toContain("chat0110_connect");
    expect(participationTask(cards[0]!, en, null)).toContain(
      "chat0110.turn.ready",
    );
  }
});

test("запуск автоответов открывает Work с готовым заданием вместо копирования", async () => {
  const { autoReplyLaunchUrl, sessionsForAuthor } = await import("../../web/src/lib/auto-replies.ts");
  const url = new URL(autoReplyLaunchUrl("Alex011082/terminal0110", "20261026-oxo7", "чатжпт", false));
  expect(url.origin).toBe("https://chatgpt.com");
  expect(url.searchParams.get("surface")).toBe("work");
  expect(url.searchParams.get("prompt")).toContain("chat0110.turn.ready");
  expect(url.searchParams.get("prompt")).toContain("20261026-oxo7");
  expect(sessionsForAuthor([{ id:"a", alias:"claude-code", author:"claude", name:"Claude Code", model:"sonnet", online:false }], "Клоду")).toHaveLength(1);
});

test("новый ИИ виден до первого ответа и не дублируется с историей", async () => {
  const { mergeAgentParticipants } = await import("../../web/src/lib/auto-replies.ts");
  const session = { id:"cloud", alias:"chatgpt-cloud", author:"chatgpt", name:"ChatGPT", model:"", online:false, auto_enabled:false };
  expect(mergeAgentParticipants([], [session])).toMatchObject([{ author:"chatgpt", count:0 }]);
  const existing = { author:"chatgpt", display:"ChatGPT", is_agent:true, last_at:"2026-10-27T00:00:00Z", count:1 };
  expect(mergeAgentParticipants([existing], [session])).toEqual([existing]);
});

test("копируемый JSON ожидания явно содержит session_id для всех обычных клиентов на RU/EN", () => {
  for (const en of [false, true]) {
    for (const card of agentCards(en).filter(card => !["chatgpt", "other-ai"].includes(card.id))) {
      for (const context of [null, { repo: "Alex011082/Y-TNG", chat_id: "20261030-pp11" }]) {
        const task = participationTask(card, en, context);
        const example = task.match(/chat0110_pending (\{[^}]+\})/);
        expect(example).not.toBeNull();
        expect(JSON.parse(example![1]!).session_id).toBe("<session_id>");
      }
    }
  }
});
