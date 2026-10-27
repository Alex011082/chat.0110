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
