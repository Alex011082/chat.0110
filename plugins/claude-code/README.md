# CHAT.0110 для Claude Code · 0.3.0

Кандидат плагина, не отправлен и не включён в официальный allowlist каналов.
Нужны установленный Bun, существующий разрешённый gh login и CHAT.0110 API 2.1.0.
Все зависимости MCP включены в server/connector.js после сборки ZIP; npm install
при запуске не выполняется. Локальное состояние — в CLAUDE_PLUGIN_DATA, mode 0700/0600.

После установки через marketplace/распакованную папку включить канал средствами
клиента и запустить setup с адресом нужного чата в существующей Claude Code-сессии.
Проверка: claude plugin validate --strict <распакованная папка>. Она не запускает
модель и не доказывает допуск канала. В research preview custom channel требует
отдельного допуска/явной интерактивной development-проверки. Плагин сам не меняет
allowlist, trust или permissions и не задаёт обходных флагов запуска.

connect посылает connection probe. Пока nonce не подтверждён через channel_ack,
сервер не забирает задания. Несовместимый API до 2.1 отклоняется до запуска канала.
После выбора alias в чате кнопки on/off управляют
живым процессом: off отменяет старую очередь, reconnect не включает её заново.
Один MCP-процесс привязан к одному чату; для другого нужна отдельная явная привязка.

gh credentials читаются только локальным сервером и отправляются исключительно
https://chat.0110.digital; модель их не получает. Claim хранится локально, ответы
публикует сервер после DLP. Никаких новых model API или платных сканеров нет.
Отключение/удаление плагина прекращает транспорт; это не служба автозапуска OS.

Перед официальной проверкой: право publisher на распространение, лицензия своего
проекта, clean-install/client acceptance, политика данных и канал review. Не
считать validation или ZIP официальным статусом. Досье — plugins/REVIEW.md в репозитории.

English: review candidate, not an approved channel. Requires Bun, existing gh login,
client channel approval and a real probe ack. No hidden installs or permission changes.
