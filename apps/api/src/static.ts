// Раздача собранного интерфейса (apps/web/dist). Всё, что не /api и не /auth,
// — это маршруты SPA вроде /Alex011082/chat.0110/20261023-k7q2: на них
// отдаётся index.html, а дальше маршрутизирует сам React.
import { resolve, sep } from "node:path";
import { htmlHeaders, htmlPage } from "./html.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";

export function createStatic(distDir: string) {
  const root = resolve(distDir);

  // Путь из адреса не должен выйти за пределы сборки: %2e%2e%2f и прочее.
  function inside(relative: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const full = resolve(root, "." + "/" + decoded);
    return full.startsWith(root + sep) ? full : null;
  }

  async function fileIfExists(path: string | null) {
    if (!path) return null;
    const f = Bun.file(path);
    try {
      // exists() истинно и для каталогов; size у каталога неинтересен — проверяем stat.
      const st = await f.stat();
      return st.isFile() ? f : null;
    } catch {
      return null;
    }
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Метод не поддерживается", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const pathname = new URL(req.url).pathname;
    if (["/sw.js", "/manifest.webmanifest", "/offline.html"].includes(pathname)) {
      const file=await fileIfExists(inside(pathname.slice(1)));
      if (!file) return new Response("Не найдено",{status:404});
      const headers=pathname==="/offline.html" ? htmlHeaders({"Cache-Control":"no-store"}) : new Headers({"Cache-Control":"no-cache","X-Content-Type-Options":"nosniff","Content-Type":pathname==="/sw.js"?"text/javascript; charset=utf-8":"application/manifest+json"});
      return new Response(file,{headers});
    }

    if (pathname.startsWith("/assets/")) {
      const f = await fileIfExists(inside(pathname.slice(1)));
      if (!f) return new Response("Не найдено", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
      // Vite кладёт в имя хеш содержимого: файл по этому адресу не меняется никогда.
      return new Response(f, { headers: { "Cache-Control": IMMUTABLE, "X-Content-Type-Options": "nosniff" } });
    }

    // Файлы из public/ (favicon и т.п.) лежат в корне сборки.
    if (pathname !== "/" && !pathname.slice(1).includes("/")) {
      const f = await fileIfExists(inside(pathname.slice(1)));
      if (f && !f.name?.endsWith(".html")) {
        return new Response(f, { headers: { "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
      }
    }

    const index = await fileIfExists(resolve(root, "index.html"));
    if (!index) {
      return htmlPage(503, "Интерфейс не собран", "Сервер работает, но сборки apps/web нет. Запустите bun run build и перезапустите сервис.");
    }
    // index.html — без кеша: после деплоя браузер должен сразу взять новые ассеты.
    return new Response(index, { headers: htmlHeaders({ "Cache-Control": "no-cache" }) });
  };
}
