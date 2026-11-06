# Публичная подача CHAT.0110 — кандидат 0.4.4

Обновлено 6 ноября 2026 года. Техническая подготовка по поручению владельца. Не submitted,
не official и не опубликовано. Общий remote-плагин для ChatGPT/Codex, не установка
программы на Mac. Другие MCP-клиенты требуют отдельной фактической приёмки.

## Подготовлено
- Общий HTTPS endpoint https://chat.0110.digital/mcp, OAuth собственного GitHub
  каждого пользователя, discovery, authorization code/PKCE S256, scope chat:agent.
- Remote manifests двух форматов, общий setup skill с фактическим host author,
  иконки, support URL, subtitle в лимите30, описание в лимите4000 и перевод RU.
- Кандидат 0.4.4 добавляет утверждённые действующие privacy/terms URL в оба
  формата manifest. Сборка отвергает рассогласованные версии. Распакованный
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
Individual identity в выбранной Personal Organization подтверждена: Approved.
Портал принял ZIP 0.4.3 и создал plugin
`plugin_asdk_app_6aeca0c4d2a88191a16cd57ec285b74f`, draft
`appsub_6aeca0c4d2d881918e7737012f9e4dc8`. Это черновик, не Submit/approval/Publish.

Владелец отдельно утвердил тексты и выпуск PR #29. Merge
`9f774fe80c516338cbefaeb7c479518282f947c4` выпущен штатным deploy-скриптом.
Сессия выпуска прочитала публичные https://chat.0110.digital/privacy и
https://chat.0110.digital/terms: 200, HTML, no-cache; тела совпадают с утверждёнными
файлами. Plaintext challenge доступен, но успешный Verify Domain ещё не подтверждён.
Состояние прежнего codex/очереди сохранено; Active off и DNS не менялись.

## Остаток перед Submit / Publish
1. Загрузить новый ZIP 0.4.4 в существующий draft и сверить импорт обоих legal URL.
   Не создавать дубликат заявки. Privacy/terms в public/ — утверждённый источник;
   файлы *-draft.md в этой папке сохранены как исторические проекты.
   License optional, её отсутствие не обязательный gate текущего шага.
3. Создать выделенный reviewer GitHub/account и тестовый repo/chat с минимальными
   правами, прежним участником/очередью и независимым чужим аккаунтом для отказов.
   Вход должен быть доступен reviewers по требованиям портала. Credentials и
   инструкции входа передаются только через защищённую форму портала, не в Git.
4. Реально пройти все 5+3 кейса в целевых ChatGPT/Codex клиентах, зафиксировать
   регистрацию и delivery отдельно. Подготовить доступное reviewer видеодемо;
   demo_recording_url пока не задан. Временных/вымышленных URL нет.
5. После загрузки финального ZIP проверить импорт metadata/auth/scopes,
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

Прочитаны 05.11.2026. Подготовка 0.4.4 не является отправкой или новым выпуском.
Порталом и выпуском управляет одна авторизованная сессия; OAuth/identity/очередь,
DNS и продуктовый Active этим metadata diff не изменяются.
