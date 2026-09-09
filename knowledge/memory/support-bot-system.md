---
name: support-bot-system
description: "Саппорт-бот @GymAK_Support_Bot ИИ-Тренера — приём обращений клиентов, классификация, суточный дайджест владельцу"
metadata: 
  node_type: memory
  type: project
  modified: 2026-08-15T18:24:05.856Z
  originSessionId: 12eb20e4-9ae3-4fb0-bb15-1b18a747985e
---

**★ 15.08.2026: саппорт-бот стал ЕДИНЫМ тех-каналом владельца.** По просьбе владельца («тех-шум мешает переписке») ВСЕ технические сообщения переведены на @GymAK_Support_Bot: сбои (ErrorNotify00001, включая тревоги-throw из main), голосовой алерт, дайджесты SupportDigest01/AccessDigest01/OwnerAnalytics01. Механика: n8n-credential `SupportTg0000001` (telegramApi, токен из таблицы support_bot, создан import:credentials), Telegram-узлы переключены с бота-тревог `372DoMw3VRfbXpFL` универсальным трансформом `schema/transform-tg-to-support.js` (меняет credentials.telegramApi.id). chatId владельца прежний 255171226. В OwnerAnalytics01 добавлена секция затрат за неделю (сообщения × `app_config.cost_per_msg_usd` + research × $0.52, топ-5).

Отдельный Telegram-бот **@GymAK_Support_Bot** (id 8706630110), НЕ трейнер: клиенты пишут ему жалобы/идеи/сбои, владелец раз в сутки получает дайджест. Построен 03.08.2026 (кнопка `/support` в трейнер-ботах ведёт сюда через inline-URL). Два своих workflow, вне главного трейнер-workflow.

**Приём — workflow `SupportBot01`** (webhook-триггер, отдельный от трейнера). Вебхук: `https://n8n.exlogist.com/webhook/support-intake-x7k9q2`, секрет в `support_bot.webhook_secret` (проверяется узлом Check Secret по заголовку `x-telegram-bot-api-secret-token`, как в главном). Telegram webhook ставится `setWebhook` вручную (`allowed_updates=["message"]`). Поток: `Webhook→Load Support`(SELECT токен+секрет из `support_bot`)`→Check Secret→Normalize`(достаёт из `$('Webhook').first().json.body.message`)`→ /start?`(да→приветствие) · `есть текст?`(нет→«напиши текстом») · да→`Классификатор: промпт`→`Классифицировать`(HTTP Anthropic **`claude-haiku-4-5-20251001`**, max_tokens 10, промпт-игнор инъекций)→`Разобрать категорию`(валидит в complaint/tech/suggestion/other, дефолт other)→`Сохранить`(INSERT в `feedback`)→`Спасибо`. sendMessage-узлы и Классифицировать — `onError=continueRegularOutput` (сбой не рушит запись); `errorWorkflow=ErrorNotify00001`.

**Дайджест — workflow `SupportDigest01`** (scheduleTrigger `0 9 * * *` = **09:00 МСК**, TZ Europe/Moscow — [[n8n-deploy-gotchas]] п.6). `Забрать`(SELECT json_agg всех `feedback WHERE digested_at IS NULL`)→`Формат`(Code: группирует по категориям 🔴Жалобы/⚙️Тех.сбои/💡Пожелания/💬Прочее, HTML, собирает ids; **пусто → return [] → дальше не идёт, дайджест НЕ шлётся** — нет ежедневного спама)→`Отправить владельцу`(узел `telegram` cred `372DoMw3VRfbXpFL` = **бот-тревог**, chatId 255171226, parse_mode HTML — проверенный канал, владельцу не нужно /start саппорт-бота)→`Пометить`(UPDATE `digested_at=now()` по ids, ПОСЛЕ отправки — при сбое отправки строки не теряются, попадут в следующий дайджест). Проверено живьём нудж-тестом: владелец получил дайджест с 3 примерами, строки помечены.

**Таблицы:** `feedback(id,from_id,username,first_name,text,category,created_at,digested_at)` (индекс `WHERE digested_at IS NULL`); `support_bot(bot_username PK,bot_token,webhook_secret,owner_chat_id)` — токен саппорт-бота хранится тут, НЕ в `clients` (чтобы не попал в per-client джобы вроде SuspendOverdue). Владелец `n8n_user`. Исходники `schema/SupportBot01.json`, `schema/SupportDigest01.json`.

**На будущее (по желанию владельца):** приём голоса/фото (сейчас только текст, иначе «напиши текстом»); дедуп/рейт-лимит спама; привязка обращения к конкретному трейнер-боту/клиенту (сейчас только from_id+username); настройка времени дайджеста (cron по МСК).

Связано: [[n8n-bot-workflow]] (кнопка /support, таблица `bot_content`), [[bot-distribution]], [[n8n-deploy-gotchas]].

**★ Команды владельца и меню (18.08.2026).** В саппорт-боте — и только в нём, личный консультант владелец трогать запретил — живут четыре команды, оформленные кнопками через `setMyCommands` со **scope=chat владельца** (клиенты меню не видят): `/diag` (диагностика, см. [[bot-self-diagnostics]]), `/dm` (написать конкретному клиенту), `/feedback` (последние 10 обращений по требованию), `/help`.

**`/dm`** — стейт-машина `dm_state`: `/dm` → формат → `<id> <текст>` → поиск бота клиента по `user_access`+`clients` → **превью** → `/dm_send` шлёт через токен ЕГО бота, `/dm_cancel` отменяет. Неудачная отправка сохраняет черновик для повтора. Повод: 18.08 понадобилось написать клиентке и выяснилось, что способа нет вообще — только рассылка на всех.

**Обязательное правило:** отправленное клиенту пишется в `n8n_chat_histories` его сессии (`{"type":"ai","content":...}`). Иначе бот-консультант не знает, что он это писал, и на ответ «да, присылаю» отвечает непонимающе.

**⚠️ Грабля, стоившая регресса в проде:** новый узел `Влад: маршрут` возвращал только `{route}` и срезал поля `Normalize` → клиентские обращения теряли `$json.text` и уходили в «напишите текстом» вместо записи. Тот же класс, что убил голосовую ветку 01.08 ([[n8n-dataflow-gotchas]]). Любой маршрутизатор перед общим потоком обязан прокидывать исходный item целиком (`Object.assign({}, n, {...})`), и регресс-тест клиентского пути делать в том же заходе.
