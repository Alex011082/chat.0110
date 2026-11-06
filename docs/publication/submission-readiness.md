# Публичная подача CHAT.0110 — кандидат 0.4.3

Техническая подготовка по поручению владельца от 05.11.2026. Не submitted,
не official и не опубликовано. Общий remote-плагин для ChatGPT/Codex, не установка
программы на Mac. Другие MCP-клиенты требуют отдельной фактической приёмки.

## Подготовлено
- Общий HTTPS endpoint https://chat.0110.digital/mcp, OAuth собственного GitHub
  каждого пользователя, discovery, authorization code/PKCE S256, scope chat:agent.
- Remote manifests двух форматов, общий setup skill с фактическим host author,
  иконки, support URL, subtitle в лимите30, описание в лимите4000 и перевод RU.
- Версия0.4.3 согласована. Сборка отвергает рассогласованные версии. Распакованный
  ZIP отдельно проверяется: metadata, SHA/CRC, remote URL, assets, отсутствие
  local/hooks/credentials и импортируемые review cases.
- 5 positive и 3 negative сценария в extensions.com.openai.review.test_cases
  обоих manifests. Это проверяемые инструкции review, НЕ пройденная пользовательская
  приёмка. Секретов и reviewer credentials в пакете нет.
- Positive: account; явный новый участник на каждом host; status-only resume
  прежнего UUID/очереди; адресованный ход/@@/lost ack; Stop точного участника.
  Negative: чужой аккаунт/session_id; устаревшая схема session_id/outcome;
  инструкция в цитате, пытающаяся расширить права.
- Общий onboarding по умолчанию remote; local явно advanced. Проверка старого
  участника не переподключает его. Личный plugin ID владельца не используется
  как ссылка установки. Private metadata Refresh и publisher Rescan разделены.

## Издатель и контакт
Владелец предоставил **Alex Davidov** и публичный контакт
**alexdavidov127@gmail.com**. Website: https://chat.0110.digital.
Support URL: https://github.com/Alex011082/chat.0110/issues.
Это не доказательство publisher identity verification. По read-only проверке
выбранной Personal Organization в портале verification ещё не запускалась;
публичная карточка CHAT.0110 там не обнаружена. Это не аудит всех org аккаунта.

## Остаток перед Submit / Publish
1. Выбрать реальную org/project издателя, подтвердить право подачи и завершить
   individual или business verification выбранного имени.
2. Privacy/terms drafts в этой папке — конкретные проекты на утверждение,
   не действующие страницы. Владелец утверждает фактические retention/logs/
   backups/deletion правила и тексты. После отдельного разрешения опубликовать
   реальные HTTPS страницы и указать privacyPolicyURL/termsOfServiceURL в обоих
   manifests. Сейчас поля намеренно отсутствуют; SPA fallback HTTP200 не политика.
   License optional, её отсутствие не обязательный gate текущего шага.
3. Создать выделенный reviewer GitHub/account и тестовый repo/chat с минимальными
   правами, прежним участником/очередью и независимым чужим аккаунтом для отказов.
   Вход должен быть доступен reviewers по требованиям портала. Credentials и
   инструкции входа передаются только через защищённую форму портала, не в Git.
4. Реально пройти все 5+3 кейса в целевых ChatGPT/Codex клиентах, зафиксировать
   регистрацию и delivery отдельно. Подготовить доступное reviewer видеодемо;
   demo_recording_url пока не задан. Временных/вымышленных URL нет.
5. Загрузить финальный ZIP через With MCP, проверить импорт metadata/auth/scopes,
   пройти domain-verification challenge выбранной подачи. Точный token берётся
   из портала; домены/Caddy без отдельного разрешения не менять.
6. Выполнить Scan/Rescan Tools и сверить все8схем: pending.session_id,
   status/set_auto_reply.session_id, reply(task_id,claim,text,outcome). Не ослаблять
   API изоляцию ради старой клиентской обёртки.
7. Устранить findings, принять требуемые attestations владельцем, Submit for review.
   После approval — отдельный Publish. Зелёный CI, сервер или private connection
   не означают официальный опубликованный плагин.

Страны публикации не выбирались за владельца. Public directory не обещает
автоматического пробуждения любого приложения. Claude/Grok используют совместимый
remote MCP/OAuth; доступность в реальном клиенте проверяется отдельно.

## Официальные источники
- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata
- https://developers.openai.com/plugins/deploy/app-review

Прочитаны 05.11.2026. Подготовка PR не разрешает submission/publication, новый
deploy, изменение OAuth/identity/очереди, DNS или продуктового Active.
