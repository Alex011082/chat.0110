import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStatic } from "../src/static.ts";

test("ZIP плагина раздаётся файлом с MIME и checksum; неверный путь не становится SPA",async()=>{
 const root=await mkdtemp(join(tmpdir(),"chat0110-downloads-"));
 try{
  await Bun.write(join(root,"index.html"),"SPA");
  await Bun.write(join(root,"downloads/plugins.json"),'{"plugins":[]}');
  await Bun.write(join(root,"downloads/chat0110-codex-0.3.0.zip"),new Uint8Array([80,75,3,4]));
  await Bun.write(join(root,"downloads/chat0110-codex-0.3.0.zip.sha256"),"fixture digest");
  const serve=createStatic(root);
  const zip=await serve(new Request("https://chat.0110.digital/downloads/chat0110-codex-0.3.0.zip"));
  expect(zip.status).toBe(200);expect(zip.headers.get("content-type")).toBe("application/zip");expect(zip.headers.get("content-disposition")).toContain("attachment;");expect(zip.headers.get("x-content-type-options")).toBe("nosniff");expect([...new Uint8Array(await zip.arrayBuffer())]).toEqual([80,75,3,4]);
  const index=await serve(new Request("https://chat.0110.digital/downloads/plugins.json"));expect(index.headers.get("cache-control")).toBe("no-cache");expect(await index.json()).toEqual({plugins:[]});
  const sha=await serve(new Request("https://chat.0110.digital/downloads/chat0110-codex-0.3.0.zip.sha256"));expect(await sha.text()).toBe("fixture digest");
  for(const path of ["chat0110-codex-99.0.0.zip","private.env","%2e%2e%2findex.html","chat0110-codex-0.3.0.zip.js"]){expect((await serve(new Request(`https://chat.0110.digital/downloads/${path}`))).status).toBe(404);}
 }finally{await rm(root,{recursive:true,force:true});}
});

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
