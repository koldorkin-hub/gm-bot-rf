-- Миграция 11.09.2026: программа тренировок с версиями + автопропуск напоминаний.
--
-- Идемпотентна. Обратно совместима: действующие workflow эти объекты не используют,
-- поэтому накатывается ДО деплоя, без простоя.
--
-- Прогон:  sudo -u postgres psql -d n8n_memory -f program-reminder-migration.sql

BEGIN;

-- 1) Напоминание может закрываться делом, сделанным заранее (замер, приём пищи,
--    тренировка того же вида). По умолчанию — не закрывается ничем.
ALTER TABLE reminder ADD COLUMN IF NOT EXISTS done_when text NOT NULL DEFAULT 'none';

-- 2) Программа тренировок. Причина отдельной сущности: при переделке программы бот
--    обновлял не все поля профиля, и старые версии жили рядом с новой. Здесь версии
--    явные, а «действующая ровно одна» гарантирует индекс, а не память модели.
CREATE TABLE IF NOT EXISTS training_program (
  id          bigserial   PRIMARY KEY,
  bot_id      text        NOT NULL,
  user_id     bigint      NOT NULL,
  version     integer     NOT NULL,
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  title       text        NOT NULL,
  days        jsonb       NOT NULL CHECK (jsonb_typeof(days) = 'array' AND jsonb_array_length(days) > 0),
  started_on  date        NOT NULL,
  retired_on  date,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_program_one_active
  ON training_program (bot_id, user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS training_program_version
  ON training_program (bot_id, user_id, version);
-- Владелец — тот же, что у остальных таблиц бота, иначе n8n_user её не прочитает.
-- Смена владельца таблицы переносит и её последовательность.
ALTER TABLE training_program OWNER TO n8n_user;

-- 3) Смена программы одной функцией: снять действующую и завести новую ПОСЛЕДОВАТЕЛЬНО.
--    Одним запросом с CTE так нельзя: изменяющие CTE выполняются в неопределённом
--    порядке, и вставка может упереться в индекс «одна действующая» раньше, чем
--    снимется старая версия.
CREATE OR REPLACE FUNCTION set_training_program(
  p_bot text, p_user bigint, p_tz text, p_title text, p_days jsonb, p_note text)
RETURNS TABLE (new_version integer, started_on date, old_version integer, old_days jsonb, new_days jsonb)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE
  v_today    date := (now() AT TIME ZONE coalesce(nullif(p_tz, ''), 'Europe/Moscow'))::date;
  v_old_id   bigint;
  v_old_ver  integer;
  v_old_days jsonb;
  v_ver      integer;
BEGIN
  SELECT tp.id, tp.version, tp.days INTO v_old_id, v_old_ver, v_old_days
    FROM training_program tp
   WHERE tp.bot_id = p_bot AND tp.user_id = p_user AND tp.status = 'active'
   FOR UPDATE;
  IF v_old_id IS NOT NULL THEN
    UPDATE training_program SET status = 'retired', retired_on = v_today WHERE id = v_old_id;
  END IF;
  SELECT coalesce(max(tp.version), 0) + 1 INTO v_ver
    FROM training_program tp WHERE tp.bot_id = p_bot AND tp.user_id = p_user;
  INSERT INTO training_program (bot_id, user_id, version, status, title, days, started_on, note)
  VALUES (p_bot, p_user, v_ver, 'active', p_title, p_days, v_today, p_note);
  RETURN QUERY SELECT v_ver, v_today, v_old_ver, v_old_days, p_days;
END
$fn$;
ALTER FUNCTION set_training_program(text, bigint, text, text, jsonb, text) OWNER TO n8n_user;

COMMIT;
