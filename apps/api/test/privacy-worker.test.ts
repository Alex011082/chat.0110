import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalEntities } from "../src/privacy-worker.ts";

test("таймаут процесса закрывает запрос, следующий запрос запускает новый процесс", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat0110-privacy-worker-"));
  const script = join(dir, "fixture.js");
  writeFileSync(script, `import {createInterface} from "node:readline";\nconsole.log(JSON.stringify({ready:true}));\ncreateInterface({input:process.stdin}).on("line",line=>{if(JSON.parse(line).text!=="SLOW")console.log(JSON.stringify({spans:[]}))});`);
  const worker = new LocalEntities({ python: process.execPath, script, timeoutMs: 40, startupTimeoutMs: 2000 });
  try {
    await expect(worker.scan("SLOW")).rejects.toThrow();
    expect(await worker.scan("SAFE")).toEqual([]);
  } finally { worker.stop(); rmSync(dir, { recursive: true, force: true }); }
});
