---
name: n8n-bot-workflow
description: Устройство основного workflow бота @GymAK_AI_Bot — вход, ветвление, подчинённые workflow, подтверждённые паттерны
metadata: 
  node_type: memory
  type: project
  originSessionId: 52640038-09b4-432e-9afb-c8158670a305
  modified: 2026-08-03T18:36:37.561Z
---

Workflow «ИИ Тренер - Telegram Bot», id `lX4BzBhka5FZp05G`, **164 узла на 03.08.2026** (было 39 на 21.07 — разросся: память/данные, фото/Vision, документы, мультиязычность, кнопки). Бот @GymAK_AI_Bot (id 7873062097). Базовое ветвление ниже — верно, но узлов сильно больше.

**★ КНОПКИ/КОМАНДЫ Telegram (03.08.2026).** Меню — `setMyCommands` по API, по разу на бот (стоит на @TRD_Gymbot + @USER_GYMBOT, НЕ на owner-боте). Обработчики команд врезаны ПОСЛЕ `Пущен?[0]` (после гейта доступа), ДО `Язык: чек`: `Команда: about?` (IF startsWith `/about`) → `About: текст`(SELECT из `bot_content`)→`About: отправить`; иначе `Команда: support?` (`/support`)→`Support: отправить` (inline-кнопка-URL на `t.me/GymAK_Support_Bot`); иначе → `Язык: чек` (обычный поток). `/about` новому юзеру после языка: `Язык: сохранить`(+`RETURNING onboarding_done`)→`About: новый?`(IF onboarding_done===false)→`About: приветствие`→`Пачка: занят?`. Тексты — таблица `bot_content(key,lang,text)` (правится без редеплоя). Токен саппорт-бота — таблица `support_bot(bot_username,bot_token,owner_chat_id)`. Саппорт-бот @GymAK_Support_Bot пока ПУСТОЙ (накопление+дайджест строим отдельно). Урок: новые узлы клонировать из существующих того же типа (IF←`Пущен?`, HTTP-send←`Язык: вопрос`, PG←`Пачка: занят?`) — гарантия совместимости typeVersion. Исходник `schema/transform-main-buttons.js`.

Workflow «ИИ Тренер - Telegram Bot» (легаси-строка ниже, состав проверен экспортом 21.07.2026):

**Вход — узел `n8n-nodes-base.webhook`** (`POST trainer/:bot_id`, `responseMode: onReceived`), НЕ `telegramTrigger`: тот убран при переходе на мультиарендность, webhook в Telegram регистрируется вручную вызовом `setWebhook` при заведении клиента. Формат URL нетривиален — [[n8n-dynamic-webhook-url]]. Цепочка входа и гейт оплаты — [[n8n-multitenancy]].

**Ветвление `Switch`** (`allMatchingOutputs=false`, выигрывает первое совпадение): `[0]` research → `[1]` voice → `[2]` text. Порядок важен: правило `/research` обязано стоять первым, иначе команда уедет в текстовую ветку.
- research → списание лимита → `executeWorkflow` в `ResearchTool0001` → саммари + PDF ([[n8n-research-mode]]);
- voice → getFile → скачивание → Code (переименование в voice.ogg) → Groq Whisper → Edit Fields → AI Agent;
- text → AI Agent.
Ответы уходят `HTTP Request`'ом напрямую в Telegram API в формате form-data, `chat_id` без кавычек.

**AI Agent:** модель `claude-sonnet-4-6` (`lmChatAnthropic`), память `memoryPostgresChat` (таблица `n8n_chat_histories`), единственный инструмент — `toolWorkflow` с именем `web_search`, ведущий в `WebSearchTool001` ([[n8n-websearch-tool]]). Tavily, Gemini и serpapi выпилены полностью; узла Notion в workflow нет (колонка `clients.notion_page_id` осталась незадействованной).

Подтверждённые паттерны, которые нельзя «упрощать»:
- условие ветвления в Switch пишется как `$json.message.voice !== undefined`, а НЕ через оператор «exists»;
- межузловые ссылки только `.first()`, не `.item` — см. [[n8n-dataflow-gotchas]];
- повторов на `AI Agent` целиком НЕТ намеренно: повтор переиграл бы весь цикл с инструментами и оплатил токены дважды ([[n8n-resilience]]).

Узел памяти подвешен к AI Agent и потому общий для текстовой и голосовой веток — его падение роняет обе сразу и бот немеет полностью ([[n8n-postgres-memory-outage]]). Токены Telegram зашиты прямо в URL узлов HTTP Request, поэтому экспорт workflow нельзя показывать целиком без маскирования.

**Про `docker stop` — грабля стала исторической.** Пока входом был `telegramTrigger`, штатная остановка по SIGTERM (то есть обычный `docker stop`) заставляла инстанс вызвать у Telegram `deleteWebhook`, и дубль инстанса при выключении сносил боевой webhook. Сейчас `telegramTrigger` в workflow нет, регистрация ручная, так что этот механизм не сработает. Привычку гасить через `docker kill` всё равно оставляем: SIGTERM обрывает идущие выполнения, а research идёт до 11 минут. Гасить лишний инстанс: `docker update --restart=no <контейнер>` + `docker kill`, затем проверить `getWebhookInfo`.
