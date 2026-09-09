---
name: n8n-multitenancy
description: "Мультиарендная архитектура ИИ-Тренера — таблица clients, вход через Webhook, изоляция памяти по bot_id"
metadata: 
  node_type: memory
  type: project
  originSessionId: 52640038-09b4-432e-9afb-c8158670a305
  modified: 2026-07-23T11:50:12.771Z
---

Внедрено 18.07.2026 (пункт 2 роадмапа из [[ai-trainer-project]]). Модель: свой бот каждому клиенту, один общий workflow, изоляция по `bot_id`.

**Таблица `clients`** в базе `n8n_memory`, владелец `n8n_user`. Колонки (проверено 21.07.2026): `bot_id` (PK), `bot_token`, `bot_username`, `display_name`, `status` (active | trial | suspended), `plan`, `paid_until`, `system_prompt`, `notion_page_id` (мёртвая: Notion в проекте не используется, решение владельца 23.07.2026 — всё через Postgres; колонка оставлена инертной), `webhook_secret`, `created_at`, `updated_at`, `research_daily_limit` (=3), `owner_mode` (DEFAULT false). Токены ботов лежат открытым текстом — осознанное решение владельца, защита строится на периметре ([[ai-trainer-infra]]). Единственная строка: `bot_id='gymak'`, @GymAK_AI_Bot, `paid_until='2099-12-31'`, `owner_mode=true`.

Прочие прикладные таблицы той же базы: `n8n_chat_histories` (память агента, `session_id` вида `gymak:255171226`), `answer_sources`, `research_usage`, `research_attempts`, `research_config` — см. [[n8n-research-mode]]. Все принадлежат `n8n_user`, иначе бот получит `permission denied` ([[n8n-postgres-gotchas]]).

**Цепочка входа:** `Webhook (POST, trainer/:bot_id, respond immediately)` → `Load Config` → `Check Secret` → `Normalize` → `Access Gate` → `Switch`, а по false-выходу `Suspended Notice`. Формат URL нетривиален, см. [[n8n-dynamic-webhook-url]].

Решения, которые важно не «упростить» обратно:
- **Гейт считается в SQL**, а не выражением n8n: `SELECT *, (status IN ('active','trial') AND paid_until >= CURRENT_DATE) AS access_ok FROM clients WHERE bot_id = $1`. В n8n тип `DATE` сериализуется неоднозначно, а в SQL `NULL >= date` даёт NULL, то есть fail-closed. Access Gate лишь проверяет булево `access_ok`.
- **Запрос параметризован** через `options.queryReplacement` — `bot_id` приходит из URL, склейка строки была бы SQL-инъекцией.
- **Обрывы не требуют отдельных узлов**: при `responseMode: onReceived` Telegram получает 200 до всей логики, поэтому пустая выборка Load Config, ложь на Check Secret и ложь на Access Gate просто останавливают ветку — это и есть требуемое «200 и обрыв».
- Ключ памяти составной: `{{ bot_id }}:{{ message.from.id }}` — именно `from.id`, а не `chat.id`, иначе в групповом чате истории разных людей склеятся.

Суточная приостановка — отдельный workflow `SuspendOverdue01` «Клиенты — суточная приостановка», `ScheduleTrigger` в 03:15 по Москве: `UPDATE clients SET status='suspended', updated_at=now() WHERE status IN ('active','trial') AND paid_until < CURRENT_DATE RETURNING …`. Учесть: при `paid_until IS NULL` строка не обновится (NULL-сравнение), но гейт такого клиента всё равно не пропустит — расхождение безопасное, однако `paid_until` заполнять обязательно.

Заведение нового клиента = строка в `clients` со своим `webhook_secret` плюс вызов `setWebhook` с этим секретом на URL со своим `bot_id`. Правки workflow не требуются. **Но `system_prompt` копировать от `gymak` нельзя** — [[research-pharma-boundary]].
