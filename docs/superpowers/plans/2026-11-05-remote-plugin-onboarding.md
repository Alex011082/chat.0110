# Общий удалённый плагин — план исправления

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution. Проверки только в CI.

**Goal:** Общий remote-first onboarding и технический кандидат публичного плагина.
**Architecture:** Общий remote endpoint остаётся прежним. Мастер явно разделяет
проверку существующего UUID, создание нового участника и advanced local. Пакет
объявляет только remote MCP, его фактический ZIP проверяется после сборки.
**Tech Stack:** React/TypeScript, Bun, Python stdlib ZIP.
**Spec:** docs/spec/2026-11-05-remote-plugin-onboarding.md.

## Ограничения и review focus
- Исходная remote identity/очередь/OAuth, Active и DNS не меняются.
- Не смешивать author ChatGPT/Codex, Refresh private и Rescan publisher.
- Не скрывать неоднозначность/ошибки чтения сессий созданием нового alias.
- Не обещать background/official/publication до фактической приёмки.
- Макеты/окна/локальные установки/сборки/тесты не запускать; CI.

### 1. Remote-first и сохранение сессии
- [ ] RED CI: default remote без команды; existing action=status с точным UUID;
  неизвестный/чужой автор — отказ; создание только explicit new; general launch
  без персонального plugin ID.
- [ ] mcp-setup.ts/agent-catalog.ts/auto-replies.ts: transport параметр с remote
  default, структурированный sessionSetupAction и производный текст задания.
- [ ] ConnectAgents.tsx: отдельный advanced local; выбор прежней/новой сессии
  перед копированием запроса, никаких скрытых побочных эффектов.

### 2. Кандидат 0.4.3 и досье
- [ ] Согласовать версии/manifest/skill, host author, 5+3 review cases, subtitle.
- [ ] После build распаковать ZIP и проверить реальные metadata/remote MCP,
  assets, версии и отсутствие local/hook/config/credentials.
- [ ] Перечислить остаток подачи отдельно от технической готовности; реальные
  privacy/terms/identity/reviewer inputs не выдумывать.
- [ ] Полный CI, независимый review consumer-сессией, PR без выпуска и readback отчёта.
