---
name: n8n-postgres-gotchas
description: Грабли Postgres в проекте — владелец таблиц, COPY TO ломает переносы строк, перенос scram-пароля между серверами
metadata: 
  node_type: memory
  type: reference
  originSessionId: 52640038-09b4-432e-9afb-c8158670a305
  modified: 2026-09-11T13:28:02.839Z
---

База `n8n_memory` на боевом сервере, роль приложения `n8n_user` (см. [[ai-trainer-infra]]).

**1. Таблицы, созданные от `postgres`, недоступны боту.** n8n ходит в БД как `n8n_user`; новая таблица, созданная в сессии `postgres`, принадлежит `postgres` и даёт `permission denied for table X`. Ловится плохо: узел с `onError: continueRegularOutput` проглатывает отказ, а узел с фолбэком (как чтение `research_config`) молча уходит на дефолты и выглядит работающим. Все прикладные таблицы принадлежат `n8n_user`, новые приводить к тому же: `ALTER TABLE x OWNER TO n8n_user`. Проверять не кодом возврата, а чтением из-под n8n.

**2. `COPY ... TO` экранирует переводы строк в литерал `\n`.** При бэкапе или правке многострочного `system_prompt` через `psql`: `COPY TO` даёт файл с `\n` вместо реальных переносов — промпт поедет. Использовать `psql -tA -c "select ..."` (сохраняет переносы) и обновлять через `psql -f file.sql` с `\set p \`cat file\``, а не вложенными кавычками в ssh.

**3. Перенос пароля роли между серверами — только через base64.** `ALTER ROLE ... PASSWORD '<верификатор>'` записывает готовый scram-верификатор дословно, и это правильный способ перенести пароль, не зная plaintext. Но верификатор имеет вид `SCRAM-SHA-256$4096:соль$ключ`, и если гнать его через `ssh host "..."` в двойных кавычках, удалённый шелл съест `$4096` как подстановку — Postgres молча примет огрызок за обычный пароль и перехеширует его. Критерий успеха: `rolpassword` на обоих серверах ПОБАЙТОВО одинаков (сравнить sha256). Обратное неверно: несовпадение хешей само по себе ничего не доказывает, пока пароль задавался обычным способом — scram солится случайно.

**4. Безопасная проверка отказа базы.** Строка `reject` в `/etc/postgresql/14/main/pg_hba.conf` ВЫШЕ разрешающих правил + `systemctl reload postgresql` + закрытие сессий через `pg_terminate_backend`. Сервер не останавливается, данные не трогаются. Откат — вернуть файл и перечитать конфиг; в скрипте обязателен `trap` на восстановление.

**5. `psql -f /root/файл.sql` от postgres даёт `Permission denied`.** Роль `postgres` (и её `su - postgres`) не может обойти права каталога `/root` (`drwx------`), поэтому применить SQL-файл, лежащий в `/root`, напрямую нельзя — psql рапортует `Permission denied` на самом файле, не на SQL. Лечение без копий по диску: подать через stdin — `cat /root/x.sql | su - postgres -c "psql -d n8n_memory -v ON_ERROR_STOP=1 -f -"` (cat читает от root, psql от postgres). `ON_ERROR_STOP=1` обязателен, иначе psql глотает ошибки и рапортует успех. Идемпотентный DDL-файл (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE OWNER TO n8n_user` + `INSERT ... ON CONFLICT DO NOTHING`) можно гонять повторно — проверено на схеме блока памяти.

**6. НЕ биндить Postgres на docker-gateway IP (`listen_addresses`) — ломается при ребуте.** Соблазн по defense-in-depth: сузить `listen_addresses` с `*` на `127.0.0.1,172.18.0.1` (шлюз сети `n8n_default`, через него бот из контейнера ходит в БД). Работает до первой перезагрузки: **при загрузке Postgres стартует РАНЬШЕ, чем docker создаёт бридж `n8n_default`**, адреса `172.18.0.1` ещё нет → PG биндит только `127.0.0.1`, а бот (`172.18.0.2 → 172.18.0.1:5432`) теряет БД (n8n health=200, но Load Config и все запросы падают). Симптом после ребута: `ss -tlnp | grep 5432` показывает только `127.0.0.1`. Правильно: `listen_addresses='*'` (устойчиво к порядку загрузки), а защиту 5432 держать на **ufw (ALLOW только из `172.18.0.0/16`) + pg_hba (та же подсеть) + scram-пароли** — это и есть реальный слой, бинд на все интерфейсы за фаерволом безопасен. pg_hba сузить до `172.18.0.0/16` можно и нужно (переживает ребут, от адресов не зависит). Проверено 03.08.2026 (P2-харденинг). Смежное: [[ai-trainer-infra]] (периметр), [[data-encryption-posture]].

**5-bis. Тот же отказ под `sudo -u postgres psql -f /root/…` выглядит как `No such file or directory`** (не Permission denied) — не искать опечатку в пути, подавать `-f - < файл`.

**7. `client_profile.goal_targets` — JSONB, не text** (у владельца там jsonb-строка). `goal_targets ~ '…'` падает «operator does not exist: jsonb ~ unknown». Читать `goal_targets #>> '{}'`, писать `to_jsonb('…'::text)`, в условии `jsonb_typeof(goal_targets)='string'`. Прежде чем править поле профиля — смотреть тип в information_schema. Остальные текстовые поля плана (`active_plan`, `plan_week`) — text.

**8. Изменяющие CTE (`WITH a AS (UPDATE…), b AS (INSERT…)`) выполняются в неопределённом порядке и видят один снимок.** «Снять старую версию и вставить новую» одним запросом нарушает частичный уникальный индекс непредсказуемо. Такое — функцией plpgsql (`#variable_conflict use_column`, владелец n8n_user), см. [[training-program]]. Цепочка «UPDATE skipped → INSERT следующий повтор → SELECT … NOT IN skipped» в тикере работает, потому что шаги не конфликтуют по ключам.

**9. На `source` стоят CHECK:** `measurement.source` ∈ (client, extracted, device); `workout_session.source`, `food_log.source` ∈ (client, extracted). Тестовые фикстуры с `'test'` база отвергает — брать значение из существующих строк. На `reminder.status` ограничения нет (`skipped_done` добавлен без миграции).

**10. Проверочные SELECT по `clients` — никогда `*` и никогда `bot_token`/`webhook_secret` в выводе.** 11.09.2026 в диагностике тикера утёк токен бота users в вывод. Перечислять колонки явно.

**11. psql `\gset` СНИМАЕТ переменную, если значение NULL.** Проверка вида `SELECT CASE WHEN :'x_id' = '' …` после `\gset x_` падает «syntax error at or near ":"» — переменной нет, подстановка не происходит. Отдавать id строкой `coalesce(id::text,'')`. Запрос с изменяющими CTE нельзя обернуть в `SELECT … FROM (…)` — править только финальную проекцию.

**12. `CREATE OR REPLACE FUNCTION` не меняет RETURNS TABLE** — нужен `DROP FUNCTION` по старой сигнатуре. Новый аргумент с `DEFAULT` сохраняет старые вызовы с меньшим числом аргументов — так миграция идёт до деплоя без простоя (set_training_program, 11.09.2026).

Смежные грабли: [[n8n-alerting-gotchas]], [[n8n-deploy-gotchas]], [[n8n-dataflow-gotchas]].
