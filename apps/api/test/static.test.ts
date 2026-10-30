import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStatic } from "../src/static.ts";

test("PWA раздаётся с правильным MIME и обновляемыми заголовками, без подмены отсутствующего SW на SPA", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat0110-static-"));
  try {
    await Promise.all(Object.entries({
      "index.html": "<main>app</main>",
      "sw.js": "/* public worker */",
      "manifest.webmanifest": '{"display":"standalone"}',
      "offline.html": "<main>Нет подключения</main>",
    }).map(([name, text]) => Bun.write(join(root, name), text)));
    const serve = createStatic(root);
    for (const [path, mime, cache] of [
      ["/sw.js", "text/javascript", "no-cache"],
      ["/manifest.webmanifest", "application/manifest+json", "no-cache"],
      ["/offline.html", "text/html", "no-store"],
    ]) {
      const response = await serve(new Request(`https://chat.0110.digital${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(mime!);
      expect(response.headers.get("cache-control")).toBe(cache!);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      if (path === "/offline.html") expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
    await rm(join(root, "sw.js"));
    expect((await serve(new Request("https://chat.0110.digital/sw.js"))).status).toBe(404);
    expect(await (await serve(new Request("https://chat.0110.digital/A/B/20261030-pp11"))).text()).toBe("<main>app</main>");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
