# CHAT.0110 для Codex · 0.3.0

Кандидат плагина для последующей проверки владельцем. Не официальный, не отправлен
и не опубликован в каталоге. Remote MCP: https://chat.0110.digital/mcp, минимум 2.1.0.

Пакет содержит portable plugin.json/mcp.json, compatibility manifest и setup skill.
Hooks отсутствуют: пакет не включает скрытую службу, новый App Server или новые модели.
Установка: импортировать ZIP через интерфейс плагинов Codex/ChatGPT, разрешить OAuth
и запустить setup в нужной существующей сессии с адресом чата. Кнопка в чате управляет
выбранным alias; новая сессия после исторического intent требует отдельного выбора.

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
Эти материалы не заменены заглушками. Лицензию своего проекта выбирает владелец.
Источник/досье: https://github.com/Alex011082/chat.0110, plugins/REVIEW.md.

English: review candidate, not official. OAuth tools work only in permitted chats.
Local automatic wake requires a live host adapter; MCP installation alone is insufficient.
