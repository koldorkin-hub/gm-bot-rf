---
name: broadcast-tool
description: "Рассылка сервисных уведомлений владельцем: /broadcast → Broadcast01 (Haiku-полировка, превью+подтверждение, фан-аут, локализация, троттлинг)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3499e7e7-2449-4d53-93e0-6f915c17c294
  modified: 2026-08-06T20:26:46.412Z
---

Построено 06.08.2026 (чат 6). Владелец рассылает объявления/новости/поздравления клиентам из owner-бота. Бан-риск низкий: шлём ТОЛЬКО своим (кто запускал бота), троттлинг, уважаем отписку. Разбор бан-риска — было в чате: Telegram разрешает писать своим пользователям; риск только при массовом флуде (лимит ~30/сек) и если многие блокируют/жалуются.

**Триггер:** команда `/broadcast` в owner-боте @GymAK_AI_Bot (в меню: research/progress/**broadcast**). Гейт в main `Команда: broadcast?` — `bot_type=='owner'` И текст startsWith `/broadcast` (ветка: `Команда: quiet?`[нет]→broadcast?→[да]`Broadcast: вызов` executeWorkflow / [нет]`Язык: чек`). Исходник `transform-main-broadcast-command.js`.

**Подворкфлоу `Broadcast01`** (published, 24 узла, собран `schema/build-broadcast.js`). Вход: command_text, owner_bot_id, owner_bot_token, owner_chat_id. Узел «Режим» парсит: `/broadcast_send`→send, `/broadcast_cancel`→cancel, иначе draft (текст после команды). Switch «Маршрут»:
- **draft:** есть текст? → Haiku полирует черновик в аккуратное HTML-объявление (`claude-haiku-4-5-20251001`, cred J8w0oAhcMJCaC4PY, тот же паттерн, что «Перевести» в [[multilang]]) → `broadcast_pending(bot_id,owner_id,text_html)` upsert → **превью владельцу** (как увидят клиенты) + счётчик получателей + «/broadcast_send или /broadcast_cancel». Пустой текст → подсказка.
- **send:** загрузить черновик → аудитория (SELECT users+bot_token+text_html) → **Локализация** (executeWorkflow LocalizeText01 per item, русский passthrough) → **Отправка** (sendMessage через токен ЕГО бота, `$('Аудитория').item` для chat_id/bot_token — paired-item; batching batchSize 20/batchInterval 1500 = троттлинг; onError continue) → Лог proactive_log kind='broadcast' → Итог (счёт ok/fail по `$('Отправка').all()`, ok = json.ok===true) → отчёт владельцу → очистить черновик. Нет черновика → подсказка.
- **cancel:** удалить черновик.

**Аудитория:** `client_profile cp JOIN clients c` WHERE `c.bot_type IN ('client','trusted') AND cp.onboarding_done AND cp.proactive_enabled=true (=уважает /quiet, /quiet переключает proactive_enabled) AND NOT (cp.user_id>=999000 AND cp.user_id<1000000)`. Каждому — через токен его бота.

**★ ГРАБЛЯ (критично, поймана фактической проверкой):** тестовый диапазон user_id = **999000–999999**; реальные Telegram-id ОГРОМНЫЕ (сотни млн, напр. 255171226). Исключать тест = `NOT (user_id>=999000 AND user_id<1000000)`, а НЕ `user_id<999000` (последнее исключает ВСЕХ реальных → пустая аудитория). Всегда проверять аудиторию SELECT-ом перед реальной рассылкой.

**Тест безопасно:** реальная аудитория непустая (были 3 живых) → на время теста их `proactive_enabled=false`, тест-получатель = owner как users:255171226, после теста ВЕРНУТЬ 3 (proactive_enabled=true) и удалить тест-клиента. Проверено вживую: превью+доставка+отчёт. Таблица `broadcast_pending`. Опц. на будущее: awaiting-state (тап кнопки → следующий текст = черновик, без повторного набора команды); плановые поздравления с ДР/НГ (реюз fan-out [[proactive-retention]]). Связано: [[proactive-retention]], [[multilang]] (LocalizeText01), [[bot-distribution]], [[n8n-deploy-gotchas]].
