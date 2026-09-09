-- ============================================================================
-- Блок ПАМЯТЬ И ДАННЫЕ — Фаза 2, подэтап 1 (Фундамент). Волна 1.
-- Идемпотентно: CREATE TABLE IF NOT EXISTS + ALTER OWNER + CREATE INDEX IF NOT EXISTS.
-- Применять: su - postgres -c "psql -d n8n_memory -f /root/memory-block/memory-wave1.sql"
-- ВАЖНО: файл применяется от postgres, поэтому у КАЖДОЙ таблицы явный
--        ALTER TABLE ... OWNER TO n8n_user — иначе бот получит permission denied.
-- Схема утверждена: ПАМЯТЬ-схема-v1.md. Ключ везде (bot_id, user_id).
-- Волна 2 (personal_record, coaching_note, food_reference) здесь НЕ создаётся намеренно.
-- ============================================================================

BEGIN;

-- ---------- СПРАВОЧНИКИ (общие, без bot_id) --------------------------------

CREATE TABLE IF NOT EXISTS activity_library (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('strength','cardio','sport','mobility')),
  load_tags text[] NOT NULL DEFAULT '{}',
  equipment text[],
  aliases text[],
  note text
);
ALTER TABLE activity_library OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS activity_library_tags ON activity_library USING gin (load_tags);

CREATE TABLE IF NOT EXISTS freshness_policy (
  metric text PRIMARY KEY,
  max_age_days int NOT NULL,
  note text
);
ALTER TABLE freshness_policy OWNER TO n8n_user;

-- ---------- ХРАНИЛИЩЕ 1 — ПРОФИЛЬ ------------------------------------------

CREATE TABLE IF NOT EXISTS client_profile (
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  display_name text,
  birth_date date,
  sex text CHECK (sex IN ('male','female','other')),
  height_cm numeric,
  timezone text,
  units text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric','imperial')),
  main_goal text,
  goal_targets jsonb,
  goal_deadline date,
  motivation text,
  disciplines jsonb NOT NULL DEFAULT '[]',
  experience_level text,
  equipment jsonb,
  days_per_week int,
  session_minutes int,
  diet_type text,
  target_kcal int,
  target_protein_g int,
  target_fat_g int,
  target_carb_g int,
  cooking_time_pref text,
  cooking_skill text,
  current_weight_kg numeric,
  current_weight_on date,
  sensitive boolean NOT NULL DEFAULT true,
  onboarding_done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
ALTER TABLE client_profile OWNER TO n8n_user;

-- ---------- ХРАНИЛИЩЕ 2 — ИЗМЕРЕНИЯ (универсальный ряд) --------------------

CREATE TABLE IF NOT EXISTS measurement (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  measured_on date NOT NULL,
  metric text NOT NULL,
  value numeric NOT NULL,
  unit text,
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client','extracted','device')),
  sensitive boolean NOT NULL DEFAULT false,
  note text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE measurement OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS measurement_lookup ON measurement (bot_id, user_id, metric, measured_on DESC);

-- ---------- ХРАНИЛИЩЕ 3 — ЖУРНАЛЫ -----------------------------------------

CREATE TABLE IF NOT EXISTS workout_session (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  performed_on date NOT NULL,
  session_type text,
  duration_min int,
  perceived_effort numeric,
  note text,
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client','extracted')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workout_session OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS workout_session_lookup ON workout_session (bot_id, user_id, performed_on DESC);

-- Мультиформат: kind разводит формы. Силовые — построчно (set_no/reps/weight_kg/rpe),
-- кардио — своими полями (duration_s/distance_m/pace_s_per_km/hr_avg). Одно не ломает другое.
CREATE TABLE IF NOT EXISTS workout_entry (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  activity_id int REFERENCES activity_library(id),
  activity_name text,
  entry_order int,
  kind text NOT NULL CHECK (kind IN ('strength','cardio','other')),
  set_no int,
  reps int,
  weight_kg numeric,
  rpe numeric,
  duration_s int,
  distance_m numeric,
  pace_s_per_km numeric,
  hr_avg int,
  extra jsonb
);
ALTER TABLE workout_entry OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS workout_entry_session ON workout_entry (session_id);

-- ---------- ХРАНИЛИЩЕ 5 — РЕЦЕПТЫ (создаём до food_log: FK) ----------------

CREATE TABLE IF NOT EXISTS recipe (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  title text NOT NULL,
  title_norm text NOT NULL,
  servings int,
  kcal_per_serving numeric,
  protein_g_per_serving numeric,
  fat_g_per_serving numeric,
  carb_g_per_serving numeric,
  prep_minutes int,
  tags jsonb,
  source text NOT NULL CHECK (source IN ('bot','client','found')),
  status text NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','favorite')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recipe OWNER TO n8n_user;
CREATE UNIQUE INDEX IF NOT EXISTS recipe_dedup ON recipe (bot_id, user_id, title_norm);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipe_id bigint NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  item text NOT NULL,
  amount numeric,
  unit text,
  note text
);
ALTER TABLE recipe_ingredient OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS recipe_ingredient_recipe ON recipe_ingredient (recipe_id);

CREATE TABLE IF NOT EXISTS food_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  eaten_on date NOT NULL,
  meal_type text,
  description text,
  kcal numeric,
  protein_g numeric,
  fat_g numeric,
  carb_g numeric,
  recipe_id bigint REFERENCES recipe(id),
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client','extracted')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE food_log OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS food_log_lookup ON food_log (bot_id, user_id, eaten_on DESC);

-- ---------- ХРАНИЛИЩЕ 4 — КОЛЛЕКЦИИ ---------------------------------------

CREATE TABLE IF NOT EXISTS allergen (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  substance text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('allergy','intolerance')),
  confirmed boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE allergen OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS allergen_client ON allergen (bot_id, user_id);

CREATE TABLE IF NOT EXISTS food_preference (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  item text NOT NULL,
  stance text NOT NULL CHECK (stance IN ('like','dislike')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE food_preference OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS food_preference_client ON food_preference (bot_id, user_id);

CREATE TABLE IF NOT EXISTS medication (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  name text NOT NULL,
  dose text,
  schedule text,
  reason text,
  started_on date,
  ended_on date,
  active boolean NOT NULL DEFAULT true,
  confirmed boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE medication OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS medication_client ON medication (bot_id, user_id) WHERE active;

CREATE TABLE IF NOT EXISTS condition (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  name text NOT NULL,
  since date,
  active boolean NOT NULL DEFAULT true,
  confirmed boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE condition OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS condition_client ON condition (bot_id, user_id) WHERE active;

CREATE TABLE IF NOT EXISTS injury (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  area text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','rehab','resolved')),
  since date,
  resolved_on date,
  confirmed boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE injury OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS injury_client ON injury (bot_id, user_id) WHERE status <> 'resolved';

-- Таблица исключений — главная для безопасности, проверяется кодом перед выдачей.
CREATE TABLE IF NOT EXISTS exclusion (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  scope text NOT NULL CHECK (scope IN ('load_tag','activity','ingredient','other')),
  value text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN
        ('injury','condition','medication','client_request','research','coach')),
  source_ref bigint,
  confirmed boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  since date,
  until date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE exclusion OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS exclusion_active ON exclusion (bot_id, user_id) WHERE active;

-- ---------- ХРАНИЛИЩЕ 5 — ОСТАЛЬНЫЕ АРТЕФАКТЫ -----------------------------

CREATE TABLE IF NOT EXISTS research_report (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  execution_id text REFERENCES research_attempts(execution_id),
  topic text NOT NULL,
  summary text,
  report_text text,
  pdf bytea,
  sources jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE research_report OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS research_report_client ON research_report (bot_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plan (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('training','nutrition')),
  title text,
  content jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE plan OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS plan_client ON plan (bot_id, user_id, kind) WHERE active;

-- ---------- ХРАНИЛИЩЕ 6 — ПРОИЗВОДНАЯ ПАМЯТЬ ------------------------------

CREATE TABLE IF NOT EXISTS client_summary (
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  summary_text text,
  covers_through timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
ALTER TABLE client_summary OWNER TO n8n_user;

CREATE TABLE IF NOT EXISTS extraction_state (
  bot_id text NOT NULL REFERENCES clients(bot_id),
  user_id bigint NOT NULL,
  last_message_id int,
  last_extracted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
ALTER TABLE extraction_state OWNER TO n8n_user;

CREATE TABLE IF NOT EXISTS chat_history_archive (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id text NOT NULL,
  user_id bigint NOT NULL,
  orig_id int,
  session_id text,
  message jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chat_history_archive OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS chat_archive_client ON chat_history_archive (bot_id, user_id, orig_id);

-- ---------- СИД: freshness_policy -----------------------------------------
-- Порог свежести в днях. Метрики без записи здесь Code трактует по дефолту (30 дней).
INSERT INTO freshness_policy (metric, max_age_days, note) VALUES
  ('weight', 7,   'вес — дни'),
  ('waist', 30,   'обхваты — недели'),
  ('hip', 30,     'обхваты — недели'),
  ('chest', 30,   'обхваты — недели'),
  ('body_fat_pct', 30, 'состав тела — недели'),
  ('systolic', 30,  'давление'),
  ('diastolic', 30, 'давление'),
  ('resting_hr', 14, 'пульс покоя'),
  ('sleep_hours', 3, 'сон — свежий'),
  ('water_ml', 1,    'вода — за день'),
  ('mood', 3,        'настроение'),
  ('ldl', 180,   'анализы — месяцы'),
  ('hdl', 180,   'анализы — месяцы'),
  ('glucose', 180, 'анализы — месяцы'),
  ('testosterone', 180, 'анализы — месяцы')
ON CONFLICT (metric) DO NOTHING;

-- ---------- СИД: activity_library под виды спорта фокус-группы -------------
-- Стартовый набор. Расширяется по мере надобности. Теги нагрузки — основа исключений.
INSERT INTO activity_library (name, category, load_tags, equipment, aliases) VALUES
  -- виды спорта / кардио фокус-группы
  ('Падл-теннис',       'sport',  '{impact,lateral,rotational,shoulder_load,knee_dominant}', '{ракетка}', '{падел,padel}'),
  ('Плавание',          'cardio', '{shoulder_load,low_impact}', '{бассейн}', '{swimming}'),
  ('Беговая дорожка',   'cardio', '{impact,knee_dominant}', '{дорожка}', '{treadmill}'),
  ('Бег',               'cardio', '{impact,knee_dominant}', NULL, '{running,бег на улице}'),
  ('Гребной тренажёр',  'cardio', '{hip_hinge,spinal_flexion,shoulder_load,knee_dominant}', '{гребной}', '{rower,гребля}'),
  ('Велосипед',         'cardio', '{knee_dominant,low_impact}', '{велосипед}', '{cycling,вело}'),
  ('Велотренажёр',      'cardio', '{knee_dominant,low_impact}', '{велотренажёр}', '{stationary bike}'),
  ('Ходьба',            'cardio', '{low_impact}', NULL, '{walking,прогулка}'),
  ('Футбол',            'sport',  '{impact,knee_dominant,lateral,rotational,sprint}', '{мяч}', '{football,soccer}'),
  ('Эндуро/мото',       'sport',  '{grip,axial,impact}', '{мотоцикл}', '{enduro,мотокросс}'),
  -- силовой фитнес: базовые движения с тегами нагрузки
  ('Присед со штангой',        'strength', '{axial,knee_dominant}', '{штанга,стойки}', '{back squat,приседания}'),
  ('Фронтальный присед',       'strength', '{axial,knee_dominant}', '{штанга}', '{front squat}'),
  ('Становая тяга',            'strength', '{axial,hip_hinge,spinal_flexion,grip}', '{штанга}', '{deadlift}'),
  ('Румынская тяга',           'strength', '{hip_hinge,axial,grip}', '{штанга}', '{rdl,romanian deadlift}'),
  ('Жим лёжа',                 'strength', '{shoulder_load}', '{штанга,скамья}', '{bench press}'),
  ('Жим стоя',                 'strength', '{overhead,shoulder_load,axial}', '{штанга}', '{ohp,military press}'),
  ('Тяга штанги в наклоне',    'strength', '{hip_hinge,spinal_flexion,grip,shoulder_load}', '{штанга}', '{barbell row}'),
  ('Подтягивания',             'strength', '{overhead,shoulder_load,grip}', '{турник}', '{pull-up}'),
  ('Тяга верхнего блока',      'strength', '{shoulder_load,grip}', '{блок}', '{lat pulldown}'),
  ('Выпады',                   'strength', '{knee_dominant}', '{гантели}', '{lunge}'),
  ('Жим ногами',               'strength', '{knee_dominant}', '{тренажёр}', '{leg press}'),
  ('Ягодичный мост',           'strength', '{hip_hinge}', '{штанга}', '{hip thrust}'),
  ('Планка',                   'mobility', '{}', NULL, '{plank}'),
  ('Растяжка/мобилити',        'mobility', '{}', NULL, '{stretching,mobility}')
ON CONFLICT (name) DO NOTHING;

COMMIT;
