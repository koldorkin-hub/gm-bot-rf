-- Самодиагностика: журнал сбоёв + состояние сторожа.
-- Идемпотентно: можно прогонять повторно.
-- Прогон: sudo -u postgres psql -d n8n_memory -f diag-tables.sql

-- Журнал сбоёв. Исполнения n8n лежат в SQLite контейнера, из Postgres их не видно,
-- поэтому историю ошибок ведём сами — пишет ErrorNotify00001 при каждом падении.
CREATE TABLE IF NOT EXISTS ops_error (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  workflow_name text,
  node_name     text,
  message       text
);
CREATE INDEX IF NOT EXISTS ops_error_at_idx ON ops_error (at DESC);

-- Состояние сторожа: чтобы поймать переход «сломалось» → «починилось»
-- и не слать повторные тревоги об одном и том же.
CREATE TABLE IF NOT EXISTS diag_state (
  k          text PRIMARY KEY,
  status     text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  details    text
);

-- Владелец таблиц — роль бота (грабля: n8n ходит в базу под n8n_user,
-- таблицы, созданные под postgres, ему недоступны на запись).
ALTER TABLE ops_error  OWNER TO n8n_user;
ALTER TABLE diag_state OWNER TO n8n_user;

-- ops_alert (анти-спам тревог) уже существует с голосового алерта; создаём на случай чистой базы.
CREATE TABLE IF NOT EXISTS ops_alert (
  kind    text PRIMARY KEY,
  last_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ops_alert OWNER TO n8n_user;
