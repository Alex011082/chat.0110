# CHAT.0110 для ChatGPT и Codex · 0.4.4

Кандидат плагина для последующей проверки владельцем. Не официальный, не отправлен
и не опубликован в каталоге. Remote MCP: https://chat.0110.digital/mcp, минимум 2.1.0.
Это общий сервер с OAuth каждого пользователя. Локальная установка, Node/npx/Bun/gh
и отдельный платный API для этого пакета не нужны. ZIP — для ручного импорта
плагина и подачи издателем, а не установщик программы на компьютер.

Пакет содержит portable plugin.json/mcp.json, compatibility manifest и setup skill.
Hooks отсутствуют: пакет не включает скрытую службу, новый App Server или новые модели.
Установка: импортировать ZIP через интерфейс плагинов Codex/ChatGPT, разрешить OAuth
и выбрать прежнего участника в мастере /connect. Проверка прежней сессии вызывает
только status с её UUID, без нового connect/rebind/set_auto_reply. Создание нового
участника — отдельный явный выбор; при неизвестном ID или конфликте alias — остановка.
В Codex author=codex, в ChatGPT author=chatgpt. Модель не заменяет имя приложения.

Для старой личной связи нужен Refresh её metadata, publisher Rescan — другой
процесс для опубликованного плагина. Не переустанавливай связь и не отзывай OAuth
ради отсутствующих полей схемы. Нужны pending.session_id и reply.outcome.

Remote MCP даёт инструменты чтения, ответа и scoped status/control. Он сам не
пробуждает локальный Codex: нужен живой host-адаптер (описан в docs/codex-host-pilot.md
репозитория). Пакет не объявляет эту способность установленной. Пятьминутного
модельного опроса нет. MCP Events поддерживается только на документированных
поверхностях; не подменять author на chatgpt ради получения callback.

Для reviewer: READ/WRITE — только разрешённые чаты GitHub пользователя; scope chat:agent,
вход OAuth, secrets в пакете нет. Stop отменяет прежние цепочки; повтор требует тех
же text/outcome. Прямые GitHub-записи обходят CHAT.0110 DLP. История Git не стирается.

Перед submission нужны подтверждённые publisher/eligibility, согласованные владельцем
публичные privacy/terms URL, test account и чистая установка на настоящем клиенте.
Эти материалы не заменены заглушками. License optional для текущего шага подачи.
Имя/контакт предоставлены владельцем: Alex Davidov, alexdavidov127@gmail.com;
это не доказательство identity verification. Пять positive и три negative review
сценария включены, но ещё не пройдены в reviewer-аккаунте; CI их не заменяет.
Credentials вводятся только в защищённую форму портала. Полный остаток и проекты
политик: docs/publication/submission-readiness.md в исходном репозитории.
Источник/досье: https://github.com/Alex011082/chat.0110, plugins/REVIEW.md.

English: review candidate, not official. OAuth tools work only in permitted chats.
Local automatic wake requires a live host adapter; MCP installation alone is insufficient.
