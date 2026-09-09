-- ============================================================================
-- РФ-сервер, шаг 3: синтетические клиенты в базе разработки gm_dev.
--     su - postgres -c "psql -v ON_ERROR_STOP=1 -d gm_dev -f 03-synthetic.sql"
-- Перед этим в gm_dev должна быть применена схема:  ./02-apply-core.sh --db gm_dev --owner gm_dev
--
-- Зачем. Разработка по умолчанию ведётся на синтетике — не потому, что этап 2 уже наступил,
-- а потому что так удобнее: данные предсказуемые, их можно ломать и пересоздавать, и они
-- не зависят от того, что владелец ел вчера. К моменту прихода первого клиента привычка
-- уже сложилась, и переключать ничего не нужно (ДОСТУП-И-ДОКАЗУЕМОСТЬ.md).
--
-- Люди вымышлены. Идентификаторы взяты из диапазона 999xxx — он же используется на боевом
-- для изолированных тестов, поэтому синтетику невозможно спутать с настоящим клиентом.
-- Идемпотентно: повторный прогон пересоздаёт данные, не плодя дублей.
--
-- Пять профилей ровно те же, что в стенде проверки качества (eval/profiles), — чтобы
-- сценарий, отлаженный на стенде, воспроизводился на живом боте один в один.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Отказ работать на боевой базе: перепутать -d легко, последствия неприятные.
DO $$
BEGIN
  IF current_database() <> 'gm_dev' THEN
    RAISE EXCEPTION 'синтетика ставится только в базу gm_dev, а сейчас %', current_database();
  END IF;
END $$;

-- Чистим прошлую синтетику: только свой диапазон идентификаторов.
DELETE FROM workout_entry WHERE session_id IN (SELECT id FROM workout_session WHERE user_id BETWEEN 999000 AND 999999);
DELETE FROM workout_session WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM food_log        WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM measurement     WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM allergen        WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM condition       WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM injury          WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM exclusion       WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM client_summary  WHERE user_id BETWEEN 999000 AND 999999;
DELETE FROM client_profile  WHERE user_id BETWEEN 999000 AND 999999;

-- ── Профили ──
INSERT INTO client_profile
  (bot_id, user_id, display_name, birth_date, sex, height_cm, timezone, main_goal,
   disciplines, experience_level, days_per_week, diet_type, target_kcal,
   current_weight_kg, current_weight_on, onboarding_done)
VALUES
  ('devbot', 999001, 'Ирина', DATE '1990-04-12', 'female', 168, 'Europe/Moscow',
   'снизить вес до 66 кг и укрепить спину',
   '[{"discipline":"зал","goal":"тонус и спина","priority":1},
     {"discipline":"ходьба","goal":"10 000 шагов","priority":2}]'::jsonb,
   'новичок после перерыва', 3, 'обычное питание', 1750, 72.4, CURRENT_DATE - 1, true),
  ('devbot', 999002, 'Марина', DATE '1988-11-03', 'female', 165, 'Europe/Moscow',
   'поддерживать форму, набрать силу',
   '[{"discipline":"зал","goal":"силовые","priority":1}]'::jsonb,
   'средний', 3, 'обычное питание', NULL, 61.0, CURRENT_DATE - 2, true),
  ('devbot', 999003, 'Сергей', DATE '1985-02-20', 'male', 181, 'Asia/Yekaterinburg',
   'вернуться к тренировкам после травмы',
   '[{"discipline":"зал","goal":"восстановление","priority":1}]'::jsonb,
   'опытный', 2, 'обычное питание', NULL, 88.6, CURRENT_DATE - 3, true),
  ('devbot', 999004, 'Катя', DATE '2002-06-30', 'female', 170, 'Europe/Moscow',
   'похудеть',
   '[{"discipline":"кардио","goal":"жечь калории","priority":1}]'::jsonb,
   'новичок', 6, 'жёсткие ограничения', NULL, 51.2, CURRENT_DATE, true),
  ('devbot', 999005, 'Тестовый Владелец', DATE '1984-08-14', 'male', 180, 'Europe/Moscow',
   'до 100 кг и видимый пресс',
   '[{"discipline":"зал","goal":"FullBody","priority":1}]'::jsonb,
   '20 лет опыта', 2, 'обычное питание', NULL, 103.0, CURRENT_DATE - 1, true);

-- ── Здоровье ──
INSERT INTO allergen (bot_id, user_id, substance, severity, confirmed) VALUES
  ('devbot', 999002, 'орехи',   'allergy',      true),
  ('devbot', 999002, 'лактоза', 'intolerance',  true);

INSERT INTO injury (bot_id, user_id, area, status, since, confirmed) VALUES
  ('devbot', 999003, 'правое колено', 'rehab', CURRENT_DATE - 58, true);

INSERT INTO exclusion (bot_id, user_id, scope, value, source_type, confirmed, active) VALUES
  ('devbot', 999003, 'load_tag', 'knee_dominant', 'injury', true, true),
  ('devbot', 999003, 'load_tag', 'impact',        'injury', true, true);

INSERT INTO condition (bot_id, user_id, name, confirmed, active) VALUES
  ('devbot', 999005, 'РЧА май 2025, пульс не выше 150 уд/мин в пике', true, true),
  ('devbot', 999005, 'Эндопротез правого ТБС: запрещены сведения ног в тренажёре, глубокий присед с осевой нагрузкой, приведение бедра, скрестный шаг, ротации бедра', true, true);

INSERT INTO client_summary (bot_id, user_id, summary_text, covers_through) VALUES
  ('devbot', 999001, 'Работает в офисе, вечерами устаёт. Не любит бег. Готовит сама, обедает вне дома.', CURRENT_DATE),
  ('devbot', 999004, 'Тренируется каждый день, часто пишет, что «отработала» съеденное. Взвешивается по нескольку раз в день, о еде говорит с виной.', CURRENT_DATE);

-- ── История: 30 дней веса, еды и тренировок у первого профиля ──
-- Нужна, чтобы отчёты и графики было на чём проверять: пустая база их не показывает.
INSERT INTO measurement (bot_id, user_id, measured_on, metric, value, unit, source)
SELECT 'devbot', 999001, CURRENT_DATE - d, 'weight',
       round((74.2 - d * 0.06 + sin(d) * 0.15)::numeric, 1), 'кг', 'manual'
  FROM generate_series(0, 29) d;

INSERT INTO measurement (bot_id, user_id, measured_on, metric, value, unit, source)
SELECT 'devbot', 999001, CURRENT_DATE - d, 'steps', 6000 + (d * 137) % 5000, 'шаг', 'manual'
  FROM generate_series(0, 29) d;

INSERT INTO food_log (bot_id, user_id, eaten_on, meal_type, description, kcal, protein_g, fat_g, carb_g, source)
SELECT 'devbot', 999001, CURRENT_DATE - d, m.meal, m.descr, m.kcal, m.p, m.f, m.c, 'bot'
  FROM generate_series(0, 21) d,
       (VALUES ('breakfast','овсянка на воде 250 г', 220, 7.5, 4.3, 37.5),
               ('lunch','куриная грудка 180 г с рисом 150 г', 420, 59.5, 4.0, 37.5),
               ('dinner','творог 200 г', 242, 34.4, 10.0, 3.6)) AS m(meal, descr, kcal, p, f, c);

WITH s AS (
  INSERT INTO workout_session (bot_id, user_id, performed_on, session_type, duration_min, source)
  SELECT 'devbot', 999001, CURRENT_DATE - d, 'strength', 62, 'bot'
    FROM generate_series(0, 27, 3) d
  RETURNING id
)
INSERT INTO workout_entry (session_id, activity_name, entry_order, kind, set_no, reps, weight_kg)
SELECT s.id, e.name, e.ord, 'strength', g.set_no, 8, e.w
  FROM s,
       (VALUES ('жим лёжа', 1, 45.0), ('тяга верхнего блока', 2, 40.0)) AS e(name, ord, w),
       generate_series(1, 4) AS g(set_no);

-- ── Проверка фактом ──
DO $$
DECLARE
  n_profiles int; n_food int; n_meas int; n_sets int; n_alien int;
BEGIN
  SELECT count(*) INTO n_profiles FROM client_profile WHERE user_id BETWEEN 999000 AND 999999;
  SELECT count(*) INTO n_food     FROM food_log       WHERE user_id BETWEEN 999000 AND 999999;
  SELECT count(*) INTO n_meas     FROM measurement    WHERE user_id BETWEEN 999000 AND 999999;
  SELECT count(*) INTO n_sets     FROM workout_entry  we
    JOIN workout_session ws ON ws.id = we.session_id WHERE ws.user_id BETWEEN 999000 AND 999999;
  SELECT count(*) INTO n_alien    FROM client_profile WHERE user_id NOT BETWEEN 999000 AND 999999;

  IF n_profiles <> 5 THEN RAISE EXCEPTION 'профилей %, ожидалось 5', n_profiles; END IF;
  IF n_food < 60   THEN RAISE EXCEPTION 'записей еды %, ожидалось не меньше 60', n_food; END IF;
  IF n_meas < 55   THEN RAISE EXCEPTION 'замеров %, ожидалось не меньше 55', n_meas; END IF;
  IF n_sets < 60   THEN RAISE EXCEPTION 'подходов %, ожидалось не меньше 60', n_sets; END IF;
  IF n_alien > 0   THEN RAISE EXCEPTION 'в базе разработки % профилей вне синтетического диапазона', n_alien; END IF;

  RAISE NOTICE 'Синтетика готова: профилей %, записей еды %, замеров %, подходов %.',
    n_profiles, n_food, n_meas, n_sets;
END $$;

COMMIT;
