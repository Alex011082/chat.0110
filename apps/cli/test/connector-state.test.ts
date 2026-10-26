import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorState, dropCancelled } from "../src/connector-state.ts";
test("перезапуск сохраняет identity и текущий claim, параллельный процесс отклоняется", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat0110-connector-"));
  try {
    const a = new ConnectorState(dir, "chat/claude");
    a.value.current = { task: { id: "turn", claim: "private" } };
    a.save();
    expect(() => new ConnectorState(dir, "chat/claude")).toThrow("running connector");
    const id = a.value.external;
    a.close();
    const b = new ConnectorState(dir, "chat/claude");
    expect(b.value.external).toBe(id);
    expect(b.value.current).toMatchObject({ task: { id: "turn", claim: "private" }, resumed: true });
    expect(statSync(b.path).mode & 0o777).toBe(0o600);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Stop освобождает только отменённый ход, поздний heartbeat не стирает новый", () => {
  const current = { task: { id: "turn", claim: "private" } };
  expect(dropCancelled(current, "turn", "dispatch_cancelled")).toBeNull();
  expect(dropCancelled(current, "old", "dispatch_cancelled")).toBe(current);
  expect(dropCancelled(current, "turn", "conflict")).toBe(current);
});
