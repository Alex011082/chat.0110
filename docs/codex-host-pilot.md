# Codex → Claude → итог: ограниченный живой пилот

31.10.2026 (Израиль), существующие Codex Desktop и Claude Code внутри Claude
Desktop, YTNG PR522. Новые модели, App Server, окна и платные сервисы не создавались.

## Транспорт и его граница

Внешний штатный MCP launcher по-прежнему закрывает pipe до tools/list. Адаптер
использует доступный executor-инструмент приложения send_message_to_thread с
точным UUID ранее выбранной существующей сессии, без приватного RPC.

В приватной binding native-desktop.ts поддерживается второй транспорт:

```json
{
  "transport": "codex-app-tools",
  "target": {"threadId": "<UUID существующей сессии>"},
  "repo": "Alex011082/Y-TNG",
  "chat_id": "20261030-pp11",
  "alias": "codex-desktop-native",
  "name": "Codex Desktop"
}
```

Host проверяет exact target через read_thread и запускает один runner со stdio.
Runner выдаёт JSONL-конверт type=chat0110.codex.deliver с id/thread_id/text, host
сверяет target/лимит, вызывает send_message_to_thread и пишет в stdin квитанцию
с type=chat0110.codex.receipt, тем же id и status=sent_unconfirmed. Это подтверждение
передачи, не выполнения модели: до регистрации нужен её самостоятельный ack.
Ошибка/потеря ответа после вызова инструмента — uncertain, без слепого повтора.
Повтор известного id получает прежнюю квитанцию без нового вызова инструмента.
SQLite сохраняет identity/fingerprint/attempts. Окончание публикации — событие
chat0110.native.completed с id, без claim или текста ответа.

Живой host был программным циклом текущего executor: stdio → штатный инструмент
→ квитанция. Модель не вызывалась для опроса. Ограничение пилота — 15 минут и два
задания Codex (первый/итог); после них собственный runner остановлен. Это не
постоянная служба: сохранение host/tools после завершения задачи, restart клиента
или компьютера не гарантировано. Без живого host транспорт не готов. Постоянная
установка и автозапуск не выполнены и не входят в доказательство B2.

## Context/reply без сетевых прав модели

Первый запрос пришёл Codex, но его sandbox не мог вызвать gh/HTTP. Права не
расширялись. native-mailbox.ts перенёс HTTP в уже разрешённый listener: helper
пишет локальный запрос, listener принимает только id текущего claim и возвращает
очищенный контекст. Claim/session_id больше не печатаются в контекст модели.
Reply сохраняет неизменяемый ответ и ждёт done; complete и восстановление
потерянной квитанции выполняет listener без повторного вызова модели.

Помимо watch программа сверяет только локальные файлы: FSEvents может объединять
rename. Это не опрос PR или модели. Тест запускает helper без gh в PATH и проверяет
context/reply, исключение claim и восстановление потерянного complete.

## Доказательства B2

Один искусственный запрос отправлен штатным HTTP-маршрутом веб-чата. Следующие
ходы выбрал диспетчер; управляющая сессия не пересылала ответы вручную.

| Ход | Время UTC 30.10 | Файл |
|---|---|---|
| Запрос | 22:21:02 | [Исходное сообщение](https://github.com/Alex011082/Y-TNG/blob/chat/20261030-pp11/Chat/conversations/20261030-pp11/messages/20261030T222102Z-alex011082-f124.md) |
| Codex | 22:21:04 | [B2_CODEX_FIRST](https://github.com/Alex011082/Y-TNG/blob/chat/20261030-pp11/Chat/conversations/20261030-pp11/messages/20261030T222104Z-codex-b850.md) |
| Claude | 22:21:38 | [B2_CLAUDE_CHECK](https://github.com/Alex011082/Y-TNG/blob/chat/20261030-pp11/Chat/conversations/20261030-pp11/messages/20261030T222138Z-claude-33db.md) |
| Codex итог | 22:22:06 | [B2_CODEX_FINAL](https://github.com/Alex011082/Y-TNG/blob/chat/20261030-pp11/Chat/conversations/20261030-pp11/messages/20261030T222206Z-codex-cc7f.md) |

Результат 23×29=667; reply_to связывает запрос → первый → проверку → итог.
Read-only production dispatch: chain done, step 3, route_length 3; ровно три tasks
done, authors codex/claude/codex, answer_id совпадают с файлами. Первый тест B1
остановлен (cancelled) после отказа контекста. B2 — отдельный запрос после fix.

Окна не использовались. Автопроверка отклонила подготовку production-cookie для
headless просмотра; этот путь не выполнен и не обходился. DOM/SSE-прогон и
физический клик в интерфейсе здесь не доказаны.

Сервер остался на 4ee2daf216e2; этот PR не выкладывался. Новые deadline/outcome/
readiness свойства проверены локально/CI отдельно от B2. Живая приёмка Stop,
reconnect, revoke, expiry, постоянного host и OS restart остаётся открытой.

## Исправление прежнего отчёта

Файл A2 от 30.10 доказывал публикацию, но не самостоятельный helper Claude:
Claude сообщил, что команды тогда запускал владелец вручную. Прежняя формулировка
«автоматический helper A2 прошёл» была слишком сильной. В B2 владелец дал разрешение
непосредственно исходной Claude-сессии; её штатные tool results ack/context/reply
теперь подтверждены без ошибок. Разрешения не подменялись чужим сообщением или
отключением классификатора.
