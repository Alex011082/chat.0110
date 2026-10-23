// Общие заголовки и маленькие страницы сервера (ошибки входа, 503 без сборки).
// Основной интерфейс — SPA из apps/web/dist; здесь только то, что нужно до неё.

export const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  // Форма входа уходит на github.com — без этого браузер её не отправит.
  "form-action 'self' https://github.com",
].join("; ");

export function htmlHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    ...extra,
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function htmlPage(status: number, title: string, text: string, link?: { href: string; label: string }): Response {
  const a = link ? `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>` : "";
  const body = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — chat.0110</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 16px;color:#1a1a1a;background:#fafaf7}
@media (prefers-color-scheme:dark){body{color:#eee;background:#141414}a{color:#7cc49a}}a{color:#2f9a55}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${a}</body></html>`;
  return new Response(body, { status, headers: htmlHeaders({ "Cache-Control": "no-store" }) });
}
