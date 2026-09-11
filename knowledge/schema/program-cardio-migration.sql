-- Миграция 11.09.2026 (вечер): кардио — отдельной частью программы тренировок.
--
-- Повод (владелец): «Эллипс и велотренажёр я делаю отдельно, не в дни тренировок… Зачем он их
-- смешал с тренировкой? Пусть хранится отдельно от силовой». В версии 1 программы эллипс стоял
-- первым упражнением Дня 4 — сборка программы взяла его из журнала, где кардио лежало внутри силовой.
--
-- Что меняется:
--  1. training_program.cardio — JSON-массив кардио клиента [{name, duration_min, when}], отдельно от days.
--  2. set_training_program получает седьмой аргумент p_cardio. NULL = оставить кардио прежней версии:
--     модель, пересохраняя программу из-за одного упражнения, не должна случайно стереть кардио.
--     Старый вызов с шестью аргументами продолжает работать (DEFAULT), поэтому миграция идёт ДО деплоя.
--
-- Идемпотентна.

BEGIN;

ALTER TABLE training_program ADD COLUMN IF NOT EXISTS cardio jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_program_cardio_check') THEN
    ALTER TABLE training_program ADD CONSTRAINT training_program_cardio_check CHECK (jsonb_typeof(cardio) = 'array');
  END IF;
END $do$;

-- Меняется список возвращаемых колонок, а CREATE OR REPLACE этого не позволяет — поэтому DROP.
DROP FUNCTION IF EXISTS set_training_program(text, bigint, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION set_training_program(
  p_bot text, p_user bigint, p_tz text, p_title text, p_days jsonb, p_note text, p_cardio jsonb DEFAULT NULL)
RETURNS TABLE (new_version integer, started_on date, old_version integer, old_days jsonb, new_days jsonb,
               old_cardio jsonb, new_cardio jsonb)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE
  v_today      date := (now() AT TIME ZONE coalesce(nullif(p_tz, ''), 'Europe/Moscow'))::date;
  v_old_id     bigint;
  v_old_ver    integer;
  v_old_days   jsonb;
  v_old_cardio jsonb;
  v_cardio     jsonb;
  v_ver        integer;
BEGIN
  SELECT tp.id, tp.version, tp.days, tp.cardio INTO v_old_id, v_old_ver, v_old_days, v_old_cardio
    FROM training_program tp
   WHERE tp.bot_id = p_bot AND tp.user_id = p_user AND tp.status = 'active'
   FOR UPDATE;
  v_cardio := coalesce(p_cardio, v_old_cardio, '[]'::jsonb);
  IF v_old_id IS NOT NULL THEN
    UPDATE training_program SET status = 'retired', retired_on = v_today WHERE id = v_old_id;
  END IF;
  SELECT coalesce(max(tp.version), 0) + 1 INTO v_ver
    FROM training_program tp WHERE tp.bot_id = p_bot AND tp.user_id = p_user;
  INSERT INTO training_program (bot_id, user_id, version, status, title, days, cardio, started_on, note)
  VALUES (p_bot, p_user, v_ver, 'active', p_title, p_days, v_cardio, v_today, p_note);
  RETURN QUERY SELECT v_ver, v_today, v_old_ver, v_old_days, p_days, v_old_cardio, v_cardio;
END
$fn$;
ALTER FUNCTION set_training_program(text, bigint, text, text, jsonb, text, jsonb) OWNER TO n8n_user;

COMMIT;
