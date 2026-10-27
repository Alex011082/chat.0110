import { escapeHtml as e } from "./html.ts";

export type ConsentLocale = "ru" | "en";
export function consentPage(input: {
  application: string;
  login: string;
  callback: string;
  hidden: string;
  nonce: string;
  locale: ConsentLocale;
  languageUrl: (locale: ConsentLocale) => string;
}): string {
  const en = input.locale === "en";
  const text = en
    ? {
        title: `Connect ${input.application}`,
        intro: "Bring your AI into the conversation.",
        account: "GitHub account",
        access: "What you are allowing",
        read: "Read your chats",
        readHint: "Messages, repository context and decisions.",
        task: "Receive addressed tasks",
        taskHint: "Turns sent with @ and @@ mentions.",
        reply: "Publish AI replies",
        replyHint: "Within your existing GitHub permissions.",
        expiry: "Up to 30 days. You can revoke access at any time.",
        callback: "Connection details",
        allow: "Allow connection",
        cancel: "Cancel",
        footer: "GitHub tokens stay on the CHAT.0110 server.",
        help: "Connection guide",
        language: "Interface language",
      }
    : {
        title: `Подключить ${input.application}`,
        intro: "Пригласи свой ИИ в общий разговор.",
        account: "Аккаунт GitHub",
        access: "Что ты разрешаешь",
        read: "Читать твои чаты",
        readHint: "Сообщения, контекст репозитория и решения.",
        task: "Получать адресованные задания",
        taskHint: "Ходы, отправленные через обращения @ и @@.",
        reply: "Публиковать ответы ИИ",
        replyHint: "В пределах твоих существующих прав GitHub.",
        expiry: "До 30 дней. Доступ можно отозвать в любой момент.",
        callback: "Детали подключения",
        allow: "Разрешить подключение",
        cancel: "Отмена",
        footer: "Токены GitHub остаются на сервере CHAT.0110.",
        help: "Как подключить ИИ",
        language: "Язык интерфейса",
      };
  return `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${e(text.title)} — CHAT.0110</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/oauth-consent.css"></head><body>
  <main class="consent-layout"><header class="consent-header"><a class="brand" href="/" aria-label="CHAT.0110"><img src="/favicon.svg" width="66" height="42" alt="0110"><span>chat</span></a><nav class="languages" aria-label="${text.language}">${(["ru", "en"] as const).map((lang) => `<a href="${e(input.languageUrl(lang))}" lang="${lang}"${lang === input.locale ? ' aria-current="true"' : ""}>${lang.toUpperCase()}</a>`).join("")}</nav></header>
  <section class="consent-panel" aria-labelledby="consent-title"><div class="panel-top"><h1 id="consent-title">${e(text.title)}</h1><p class="intro">${text.intro}</p></div>
  <div class="account"><span class="pilot" aria-hidden="true"></span><div><span class="caption">${text.account}</span><strong>${e(input.login)}</strong></div></div>
  <div class="permissions"><h2>${text.access}</h2><ul>${[
    [text.read, text.readHint],
    [text.task, text.taskHint],
    [text.reply, text.replyHint],
  ]
    .map(
      ([title, hint]) =>
        `<li><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><div><strong>${title}</strong><span>${hint}</span></div></li>`,
    )
    .join("")}</ul></div>
  <p class="expiry">${text.expiry}</p><details><summary>${text.callback}</summary><code>${e(input.callback)}</code></details>
  <form method="post" action="/oauth/authorize">${input.hidden}<input type="hidden" name="lang" value="${input.locale}"><input type="hidden" name="consent_nonce" value="${e(input.nonce)}"><button class="key action" type="submit" name="decision" value="allow"><span aria-hidden="true"></span>${text.allow}</button><button class="key" type="submit" name="decision" value="deny">${text.cancel}</button></form>
  </section><footer><p>${text.footer}</p><a href="/connect">${text.help}</a></footer></main></body></html>`;
}
