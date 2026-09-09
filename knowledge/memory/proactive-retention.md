---
name: proactive-retention
description: "Проактивность/удержание ИИ-Тренера — бот сам выходит на связь: недельная сводка клиенту, отчёт владельцу, тихий режим"
metadata: 
  node_type: memory
  type: project
  modified: 2026-08-05T11:09:34.976Z
  originSessionId: 12eb20e4-9ae3-4fb0-bb15-1b18a747985e
---

Проактив = бот пишет ПЕРВЫМ (удержание). Фаза 1 роадмапа п.1.2. Строится 03.08.2026. Главный пробел против рынка был — реактивность (бот только отвечал); теперь сам выходит на связь.

**Фундамент:** `client_profile.proactive_enabled boolean DEFAULT true` (отписка); `proactive_log(bot_id,user_id,kind,sent_at)` — анти-спам (не слать один kind чаще периода, паттерн как `ops_alert`). **Тихий режим — кнопка меню `/quiet`** (НЕ команда набором — по требованию владельца в меню, как /about/support): обработчик в main врезан `Команда: support?[1]→Команда: quiet?→Тихий: переключить→Тихий: ответ`; `Тихий: переключить` = upsert toggle `proactive_enabled = NOT COALESCE(...,true) RETURNING`, ответ по новому состоянию. Исходник `schema/transform-main-quiet.js`.

**Недельная сводка клиенту — workflow `ProactiveWeekly01`** (scheduleTrigger `0 11 * * 1` = Пн 11:00 МСК). Кандидаты: SELECT клиентов с `proactive_enabled` + `onboarding_done` + активность за 7д + анти-спам 6д, `bot_type IN ('client','trusted','owner')` (владелец тоже — чтоб видеть клиентский опыт), с посчитанной 7-дн статистикой (тренировки, силовой объём Σ`reps*weight_kg` из `workout_entry`, объём прошлой недели для %, кардио-км, дни/ккал/белок из `food_log`, вес now/prev из `measurement` metric IN ('вес','weight')). Fan-out по юзерам (Формат all-items + pairedItem, лог через `$('Формат').item` за HTTP — как в [[memory-data-schema]] 6a). **Шаблон, НЕ LLM** (надёжнее/дешевле/детерминированно). **РПП-безопасно:** вес нейтрально (динамика без «молодец что похудел»), поддержка за ПОСТОЯНСТВО не за снижение. Пустая фича → строка опускается (малоактивный юзер видит только вес). Исходник `schema/ProactiveWeekly01.json`.

**Отчёт по пользователям владельцу — workflow `OwnerAnalytics01`** (`30 9 * * 1` = Пн 09:30 МСК, только владельцу 255171226 через бот-тревог cred `372DoMw3VRfbXpFL`, HTML). Один агрегат-запрос (json_build_object): зарегистрировано + пол (`client_profile.sex` male/female/NULL), новых за 7д (`created_at`), онбординг, активны за 7д (СРЕДИ зарегистрированных — EXISTS по `n8n_chat_histories.created_at` human), фичи (кол-во юзеров с workout/food/measurement/research/recipe за 7д). bot_type client/trusted (владелец исключён из «пользователей»). Исходник `schema/OwnerAnalytics01.json`.

**Грабли/уроки (важно):**
1. **Тест проактива задел РЕАЛЬНЫХ клиентов.** Нудж-cron-тест `ProactiveWeekly01` сработал на ВСЕХ подходящих (не только тест-юзер) → 3 реальных клиента получили сводку off-cycle. Урок: проактивные воркфлоу тестировать ТОЛЬКО с кандидат-запросом, ограниченным тест-user_id (999xxx), ИЛИ owner-only. Реальных клиентов тест задевать не должен.
2. **Метрика «активные» без scope к зарегистрированным → 117%** (сессии с сообщением, но без `client_profile`). Правильно: `act` только среди `reg` (EXISTS). Active всегда ≤ registered.
3. Демо владельцу — можно нудж-тестить (уходит только ему), клиентам — нельзя.

**Возврат при тишине — workflow `SilenceReengage01`** (`0 12 * * *` = ежедневно 12:00 МСК). Кандидаты: `proactive_enabled`+онбординг+client/trusted, последнее human-сообщение (max `n8n_chat_histories.created_at`) в окне [now-30д, now-5д], анти-спам kind='silence' 14д. Тёплый чек-ин без давления (РПП-безопасно). Fan-out как у weekly. Исходник `schema/SilenceReengage01.json`. Проверено: только тест-молчун, реальные (активные <5д) не задеты.

**Трекинг модальностей — `usage_event(bot_id,user_id,feature,at)`** + узел `Usage: событие` в main (клон PG, висит ПАРАЛЛЕЛЬНО на `Пущен?[0]` — второй выход, основной поток не тронут, onError continue). Пишет feature voice/photo/document по структуре сообщения (`message.voice`/`.photo`/`.document` mime; image-документ→photo; **text НЕ логируется** — `INSERT ... SELECT ... WHERE $3<>'text'`). Модальность определяется ДО обработки (на Пущен?[0]), поэтому логируется даже если media-обработка упадёт. Отчёт владельцу считает distinct-юзеров по voice/photo/document за 7д. Исходник `schema/transform-main-usage-event.js`. Проверено синтетикой (фейковые voice/photo/doc поля → верные feature; text → ноль).

**Блок проактивности ЗАКРЫТ (03.08.2026):** /quiet · недельная сводка · возврат при тишине · отчёт владельцу (с модальностями). Опц. на будущее: TZ-per-user (сейчас всё МСК), локализация сводок, LLM-обогащение текста, owner в возврат-при-тишине (сейчас только client/trusted).

Связано: [[memory-data-schema]], [[n8n-bot-workflow]], [[support-bot-system]], [[n8n-deploy-gotchas]] (cron МСК).
