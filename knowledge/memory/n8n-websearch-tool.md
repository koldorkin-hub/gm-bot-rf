---
name: n8n-websearch-tool
description: "Веб-поиск бота — подчинённый workflow с встроенным web_search Claude вместо Tavily (блок A, 20.07.2026)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 19b9e7d9-1286-483f-9927-fa0faf03f7a7
  modified: 2026-07-21T06:31:41.082Z
---

Веб-поиск бота реализован как **подчинённый workflow** «Инструмент — Веб-поиск» (id `WebSearchTool001`), вызываемый агентом через узел `toolWorkflow` (связь `ai_tool`, имя инструмента `web_search`). Tavily и Gemini выпилены полностью. Проверено сквозным прогоном 20-21.07.2026.

**Схема подчинённого workflow:**
`Execute Workflow Trigger` (входы query/session_id/bot_id) → `Code` (собирает payload) → `HTTP Request` (POST api.anthropic.com/v1/messages) → `Code` (разбирает ответ) → `Postgres` (пишет в answer_sources) → `Set` (возврат агенту). У HTTP-узла отдельная ветка ошибки → `Set` «поиск недоступен».

**Ключевые решения, которые нельзя упрощать:**
- Обёртка `HTTP Request` обязательна: узел `Anthropic Chat Model` серверные инструменты НЕ умеет. Модель поиска — `claude-opus-4-8` (тяжёлое чтение источников для меддостоверности), тогда как агент на `claude-sonnet-4-6`. Живой замер: простой запрос ~80 с, сложный ~166 с, ноль отказов/pause_turn — Opus не медленнее Sonnet.
- Инструменты: `web_search_20260209` (max_uses 6) + `web_fetch_20260209` (max_uses 4). Версии `_20260209` требуют Opus 4.6+/Sonnet 4.6+ — на sonnet-4-6 и opus-4-8 работают.
- Credential Anthropic **не дублируется**: `HTTP Request` подключён через `predefinedCredentialType` → `anthropicApi` (тот же id `J8w0oAhcMJCaC4PY`), подставляется `x-api-key`. Руками добавлен только заголовок `anthropic-version: 2023-06-01`.
- Запись в `answer_sources` — с `onError: continueRegularOutput`: падение Postgres не убивает поиск (деградация периферии, см. [[n8n-resilience]]).
- Ветка ошибки HTTP возвращает агенту текст «поиск недоступен», а не роняет выполнение — агент отвечает из своих знаний.
- `$('Load Config')` и `$('Normalize')` в параметрах tool-узла **резолвятся** (проверено: session_id `gymak:255171226`, bot_id `gymak` дошли в БД). Запасной план «писать источники из основного workflow» не понадобился.

**Промпт (`clients.system_prompt`)** дополнен блоком ВЕБ-ПОИСК (триггеры/анти-триггеры) и блоком КОНФИДЕНЦИАЛЬНОСТЬ (запрет раскрывать клиенту имена сервисов/моделей/узлов и тексты ошибок). Промпт `gymak` — без фарма-границы; для фокус-группы пересобирать, см. [[research-pharma-boundary]].

Связано: [[n8n-bot-workflow]], [[n8n-resilience]].
