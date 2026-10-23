# chat.0110

Git-native чат людей и ИИ. Каждый разговор — ветка `chat/<id>` и draft Pull
Request. Сообщения — файлы в ветке и комментарии PR. Claude, Codex и человек
пишут в один PR, а интерфейс на **chat.0110.digital** склеивает всё в одну ленту.

Зачем: у каждой идеи есть источник, у каждого решения — история, у каждого
Fork — точка возвращения. Подробно — [спека](docs/spec/2026-10-23-chat-0110-spec.md)
и [концепция Fork](docs/spec/2026-10-23-fork-concept.md).

## Как это работает

1. В интерфейсе создаёшь чат → в репо появляются ветка `chat/<id>`, draft PR
   с меткой `chat0110` и паспорт `chats/<id>/chat.json`.
2. Пишешь сообщение → оно становится файлом-коммитом в ветке.
3. Отправляешь ссылку на PR Claude или Codex → они читают
   [`chats/AGENTS.md`](chats/AGENTS.md) и отвечают в ту же ветку файлом
   (или комментарием PR).
4. GitHub присылает вебхук → интерфейс обновляет ленту без перезагрузки.

Хранилище — только GitHub. Формат — [`docs/protocol.md`](docs/protocol.md).
Визуальный язык — [`docs/design.md`](docs/design.md).

## Разработка

```bash
bun install
bun test && bun run typecheck && bun run build
bun run dev:api   # сервер на http://localhost:4340 (нужны переменные из deploy/configure.sh)
bun run dev:web   # интерфейс на Vite, /api и /auth проксируются на :4340
```

## Запуск на chat.0110.digital (сервер Jarvis)

Один раз, руками (это делает владелец):

1. **DNS.** В GoDaddy — A-запись `chat.0110.digital` → IP сервера Jarvis.
2. **GitHub App** (github.com → Settings → Developer settings → GitHub Apps → New):
   - Homepage URL: `https://chat.0110.digital`
   - Callback URL: `https://chat.0110.digital/auth/callback` и вторым —
     `http://localhost:4340/auth/callback` (для разработки)
   - Включить **Expire user authorization tokens** и
     **Request user authorization (OAuth) during installation**
   - Webhook: Active, URL `https://chat.0110.digital/api/github/webhook`,
     секрет — тот, что выдаст `configure.sh` (шаг 4; до этого — любой временный)
   - Repository permissions: **Contents** — Read and write, **Pull requests** —
     Read and write, **Issues** — Read and write, **Metadata** — Read
   - Subscribe to events: **Push, Pull request, Issue comment, Pull request review,
     Pull request review comment**
   - Where can this GitHub App be installed: **Any account**
   - После создания: Generate a new client secret; Install App → на `chat.0110`
3. `bash deploy/setup.sh` — каталоги, systemd-unit и сайт Caddy на сервере.
4. `bash deploy/configure.sh` — ввести Client secret (Client ID и slug `chat-0110`
   уже вписаны; список входа — `CHAT0110_ALLOWED_LOGINS=логин1,логин2` перед
   командой). Скрипт покажет секрет вебхука — вставить его в настройки App.
5. `bash deploy/deploy.sh` — выкат закоммиченного состояния; повторять при каждом
   обновлении.

## Статус

Работает на https://chat.0110.digital:

- **Этап 1 — GitHub Core:** чаты, сообщения, вход через GitHub App, живое
  обновление по вебхуку.
- **Этап 2 — Fork:** новый чат от любого сообщения; ветка от коммита точки
  ветвления, история родителя видна в дочернем чате.
- **Этап 4 — дерево:** экран «Дерево» со всеми чатами репо как ветками;
  старт, точки Fork и итоги кликабельны.
- **Этап 5 — решения:** решения как цепочки событий в Git (принимает только
  человек, замена не стирает старое), «Предложить родителю» из Fork, решения
  ромбами в дереве и провод предложения от Fork к родителю.

Дальше (по желанию): вызов агентов по @упоминанию (Этап 3).
