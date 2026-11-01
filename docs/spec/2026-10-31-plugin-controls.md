# Плагины и управление автоответами в чате

Поручение владельца: кнопки участников управляют автоответами без перехода
на /connect; видимые пакеты Codex/Claude Code для будущей проверки; обновлённый MCP.

## Поведение

- Включение/выключение — POST в текущем чате, без window.open/navigation.
- Если сессии нет, сохраняется запрос для автора. Новая сессия остаётся выключенной
  до явного выбора её имени/alias в чате; intent не разрешает произвольного исполнителя.
  UI показывает ожидание плагина, не готовность модели. История не равна установке.
- Первичная установка/разрешения клиента явные и однократные. Закрытый клиент
  не считается работающим. Настройка/скачивание доступны рядом с кнопкой.
- /plugins: версии, пакеты, ограничения доставки, RU/EN. Owner off сохраняется
  при reconnect, отменяет старые цепочки; включение не оживляет отменённые задания.

## MCP и пакеты

- Scoped status/control сессии, версия/capabilities, pending строго session_id.
- Codex: portable/compatibility manifests, remote HTTPS MCP и skill, без hooks.
  MCP не обещает native wake; B2 host пока отдельная интеграция, не постоянная служба.
- Claude Code: plugin, bundled stdio MCP/channel, skill и явная настройка.
  Custom channels требуют допуска клиента; validation не доказывает allowlist.
- ZIP + SHA-256, исходники и dossier. Не придумывать официальный статус или
  юридические условия. Не отключать клиентские проверки безопасности.
- Установка в клиент, отправка на review, merge и production отдельно не выполняются.

## План и проверка

1. TDD intent до подключения, off/reconnect, API права/CSRF и изоляция чатов.
2. Кнопки без навигации, inline setup/status, /plugins, RU/EN/mobile/keyboard.
3. Remote/local MCP status/control и channel on/off fixture без моделей.
4. Два пакета, manifest/пути/чистая распаковка, Claude validator, MCP stdio smoke.
5. Tests/typecheck/build, текущий draft PR13/CI, AI Memory chat.0110 и PR12.

Источники: https://developers.openai.com/plugins/build/plugins,
https://developers.openai.com/plugins/deploy/submission,
https://developers.openai.com/plugins/deploy/desktop-only,
https://developers.openai.com/plugins/build/mcp-events,
https://code.claude.com/docs/en/channels-reference,
https://code.claude.com/docs/en/plugins-reference.
