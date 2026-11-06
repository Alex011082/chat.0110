# Досье для проверки CHAT.0110

Версия пакетов 0.4.4, протокол MCP/API 2.1.0. Статус обоих — not-submitted.
Исходники: apps/cli/src/connector.ts, connector-state.ts и packages/chat-protocol;
сборка: bun run package:plugins. ZIP и SHA-256: apps/web/public/downloads.
Для упаковки нужны Bun 1.3.14 и Python 3 (только стандартная библиотека zipfile).
Генерируемые ZIP/server bundle не коммитятся: bun run build пересобирает их перед
Vite. После публичного выпуска любое изменение пакета требует новой версии.

## Матрица

| Пакет | Доступ | Автодоставка | Допуск |
|---|---|---|---|
| ChatGPT / Codex | Общий OAuth remote MCP, scope chat:agent | Возможности реального host; remote сам не будит idle | Нет local/hooks; review owner/portal отдельно |
| Claude Code | Локальный MCP, существующий gh login, только CHAT.0110 | Только разрешённый channel + probe ack | Клиентский allowlist/официальная проверка отдельно |

Плагин не запускает новые модели/сессии, не сканирует рабочие файлы целиком, не
правит client config/permissions и не самоподписывает trust. Авторизованный пользователь
выбирает чат и точную сессию. Исторический intent не включает произвольного нового
исполнителя. Stop/off/revoke не возобновляют старые задания. Максимум три хода/15 минут
контролирует кандидат серверного диспетчера; production-версия проверяется отдельно.

Данные: сообщения и ответы — в ветке/draft PR GitHub; очередь/claims — на сервере;
локальная recovery-state приватная. DLP до публикации; 100% распознавание не обещается.
Удаление плагина не удаляет Git-историю. Никаких платных API сканирования.

## Перед подачей владельцем

- Подтвердить publisher и соответствие требованиям портала. License optional,
  её отсутствие не обязательный блокер подачи по текущей документации.
- Утвердить реальные публичные privacy/terms/support URL и контакт поддержки.
- Предоставить reviewer test account с минимальными правами и инструкцией отзыва доступа.
- Совместимый remote MCP 2.1.0 выпущен с PR #28. ZIP 0.4.4 добавляет адреса
  утверждённых издателем privacy/terms, не меняя OAuth, очереди и инструменты.
- Проверить clean install, включение/выключение, client restart/revoke и настоящий
  channel/host на целевых приложениях. Validation не доказывает runtime.
- Codex hooks не включать в публичный review ZIP. Local MCP submission у OpenAI
  partner-gated; не выдавать локальный Claude bundle за допустимую OpenAI remote-подачу.
- Отдельно пройти channel approval Anthropic; упаковка сама не добавляет allowlist.

Для remote-пакета подготовлены пять positive и три negative review cases, release
notes и RU listing. Это ещё не пройденные reviewer-кейсы. Owner предоставил Alex
Davidov / alexdavidov127@gmail.com; Individual identity в портале Approved.
Тексты privacy/terms утверждены владельцем. Создан draft с ZIP 0.4.3;
новый ZIP 0.4.4 ещё требует загрузки в него. Reviewer account, видео,
реальная клиентская приёмка и domain verification остаются отдельными шагами.
Полное досье: docs/publication/submission-readiness.md в репозитории.

Reviewers могут собрать архивы из source, сравнить SHA-256, проверить manifests и
прогнать stdio fixtures без модели. В пакетах отсутствуют test credentials,
production cookies, ключи, локальные session/socket identifiers и пользовательские assets.

## Проверки кандидата

- bun test, bun run typecheck, bun run build.
- claude plugin validate --strict plugins/claude-code; повторить на чистой распаковке ZIP.
- Portable plugin.json и mcp.json сверить с указанными в них официальными JSON Schema.
- Проверить ZIP CRC, SHA-256 и воспроизводимость повторной сборки.
- Для stdio smoke распакованного bundle: задать CHAT0110_TEST_CONNECTOR абсолютным
  путём к server/connector.js и запустить bun test apps/cli/test/plugin-channel.test.ts.
  Тест подставляет свой gh и loopback API, не использует реальные credentials/модели.
- Отдельный headless стенд с искусственными данными: точный alias on/off,
  исторический intent без ложной готовности, отсутствие navigation/popup, RU/EN,
  desktop/mobile/keyboard, скачивание настоящего ZIP с MIME application/zip.

Источники: https://developers.openai.com/plugins/build/plugins,
https://developers.openai.com/plugins/deploy/submission,
https://developers.openai.com/plugins/deploy/desktop-only,
https://code.claude.com/docs/en/plugins-reference,
https://code.claude.com/docs/en/channels-reference.
