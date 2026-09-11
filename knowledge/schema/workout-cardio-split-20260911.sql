-- Журнал тренировок: кардио — отдельной тренировкой, не внутри силовой. Все боты и клиенты.
--
-- Повод (владелец, 11.09.2026): эллипс и велотренажёр оказывались внутри силовой тренировки
-- («Жим Арнольда → Эллипс → Разводка → Велотренажёр…»). Бот и сборка программы брали такую
-- запись за состав силового дня. Причина — LogWorkoutTool переиспользовал ЛЮБУЮ сессию за дату,
-- не глядя на вид (правка записи — transform-logworkout-cardio-split.js).
--
-- Что делает: из каждой СИЛОВОЙ сессии (session_type='strength') строки kind='cardio' переезжают
-- в кардио-сессию той же даты (существующую или новую). Сессии 'mixed' намеренно не трогаем: это
-- круговые занятия клиентов, записанные ботом как смешанные, и в них kind='cardio' стоит и у «ЛФК»,
-- и у «шагов в полуприсяде с резинкой» — разнос по видам исказил бы историю. Новые записи
-- разделяет уже сам LogWorkoutTool. Строки не удаляются и не копируются — меняется только session_id,
-- поэтому калории, рекорды и итоги дней не меняются. Каждый перенос пишется в журнал отката.
--
-- Идемпотентно: повторный прогон ничего не находит. Откат (если понадобится):
--   UPDATE workout_entry e SET session_id = l.old_session_id FROM workout_cardio_split_log l WHERE e.id = l.entry_id;
--   DELETE FROM workout_session s WHERE s.id IN (SELECT new_session_id FROM workout_cardio_split_log WHERE session_created)
--     AND NOT EXISTS (SELECT 1 FROM workout_entry e WHERE e.session_id = s.id);
--   DELETE FROM workout_cardio_split_log;

CREATE TABLE IF NOT EXISTS workout_cardio_split_log (
  entry_id        bigint PRIMARY KEY,
  old_session_id  bigint NOT NULL,
  new_session_id  bigint NOT NULL,
  session_created boolean NOT NULL,
  moved_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workout_cardio_split_log OWNER TO n8n_user;

DO $do$
DECLARE
  r record; cid bigint; created boolean; k int;
  n_sess int := 0; n_new int := 0; n_moved int := 0;
  cnt_before bigint; kcal_before numeric; cnt_after bigint; kcal_after numeric;
  day_kcal_before jsonb; day_kcal_after jsonb; left_mixed int;
BEGIN
  SELECT count(*), coalesce(sum(kcal), 0) INTO cnt_before, kcal_before FROM workout_entry;
  SELECT coalesce(jsonb_object_agg(key, v), '{}') INTO day_kcal_before FROM (
    SELECT s.bot_id || ':' || s.user_id || ':' || s.performed_on AS key, round(coalesce(sum(e.kcal), 0), 2) AS v
      FROM workout_session s JOIN workout_entry e ON e.session_id = s.id GROUP BY 1) t;

  FOR r IN
    SELECT s.id, s.bot_id, s.user_id, s.performed_on, s.source, sum(coalesce(e.duration_s, 0)) AS dur_s
      FROM workout_session s JOIN workout_entry e ON e.session_id = s.id
     WHERE s.session_type = 'strength' AND e.kind = 'cardio'
     GROUP BY s.id, s.bot_id, s.user_id, s.performed_on, s.source
     ORDER BY s.id
  LOOP
    n_sess := n_sess + 1;
    SELECT id INTO cid FROM workout_session
     WHERE bot_id = r.bot_id AND user_id = r.user_id AND performed_on = r.performed_on AND session_type = 'cardio'
     ORDER BY id DESC LIMIT 1;
    created := cid IS NULL;
    IF created THEN
      INSERT INTO workout_session (bot_id, user_id, performed_on, session_type, duration_min, note, source)
      VALUES (r.bot_id, r.user_id, r.performed_on, 'cardio', NULLIF(round(r.dur_s / 60.0), 0),
              'Кардио — отделено от силовой тренировки #' || r.id || ' (11.09.2026)', r.source)
      RETURNING id INTO cid;
      n_new := n_new + 1;
    ELSIF r.dur_s > 0 THEN
      UPDATE workout_session SET duration_min = coalesce(duration_min, 0) + round(r.dur_s / 60.0) WHERE id = cid;
    END IF;

    INSERT INTO workout_cardio_split_log (entry_id, old_session_id, new_session_id, session_created)
    SELECT e.id, r.id, cid, created FROM workout_entry e WHERE e.session_id = r.id AND e.kind = 'cardio'
    ON CONFLICT (entry_id) DO NOTHING;

    UPDATE workout_entry SET session_id = cid WHERE session_id = r.id AND kind = 'cardio';
    GET DIAGNOSTICS k = ROW_COUNT;
    n_moved := n_moved + k;
  END LOOP;

  -- Проверка фактом: ничего не потеряно, калории по дням те же, смешанных сессий не осталось.
  SELECT count(*), coalesce(sum(kcal), 0) INTO cnt_after, kcal_after FROM workout_entry;
  IF cnt_after <> cnt_before OR kcal_after <> kcal_before THEN
    RAISE EXCEPTION 'журнал: число строк или калории изменились (% → %, % → %) — откат', cnt_before, cnt_after, kcal_before, kcal_after;
  END IF;
  SELECT coalesce(jsonb_object_agg(key, v), '{}') INTO day_kcal_after FROM (
    SELECT s.bot_id || ':' || s.user_id || ':' || s.performed_on AS key, round(coalesce(sum(e.kcal), 0), 2) AS v
      FROM workout_session s JOIN workout_entry e ON e.session_id = s.id GROUP BY 1) t;
  IF day_kcal_after <> day_kcal_before THEN
    RAISE EXCEPTION 'журнал: расход калорий по дням изменился — откат';
  END IF;
  SELECT count(DISTINCT s.id) INTO left_mixed FROM workout_session s JOIN workout_entry e ON e.session_id = s.id
   WHERE s.session_type = 'strength' AND e.kind = 'cardio';
  IF left_mixed <> 0 THEN RAISE EXCEPTION 'журнал: осталось силовых сессий с кардио внутри: % — откат', left_mixed; END IF;

  RAISE NOTICE 'журнал: разобрано смешанных сессий %, перенесено кардио-строк %, новых кардио-сессий % (строк и калорий не потеряно)', n_sess, n_moved, n_new;
END $do$;
