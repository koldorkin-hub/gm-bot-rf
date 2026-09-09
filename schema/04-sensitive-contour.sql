-- ============================================================================
-- РФ-сервер, шаг 4: контур здоровья. Отделение специальной категории ПДн.
--     su - postgres -c "psql -v ON_ERROR_STOP=1 -d gm_memory -f 04-sensitive-contour.sql"
-- Применять ПОСЛЕ 02-apply-core.sh.
--
-- Отвечает на требования 1, 3, 5, 7 и частично 8 из marketing/ДАННЫЕ-О-ЗДОРОВЬЕ.md
-- (раздел «Что из этого — задача разработки»).
--
-- Смысл в одном абзаце. Спецкатегорию образуют девять сущностей, и пока они лежат вперемешку
-- с обычными данными, нельзя ни отдельно зашифровать, ни отдельно удалить, ни доказать, что
-- разработка их не читала. Здесь они собираются в отдельную схему sens: своя схема — свои
-- права, свой срок хранения, своё удаление одной командой. Открытый контур при этом остаётся
-- полноценным: стандартный тариф обязан работать без единой записи в sens (ст.16 ЗоЗПП).
--
-- Что этот скрипт НЕ делает и не может: свободный текст переписки и выжимки остаётся
-- смешанным по своей природе. Он режется сроком жизни и проверкой выжимки кодом
-- (backstops/summary_filter.js), а не разделением таблиц.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── 1. Схема контура здоровья ──
CREATE SCHEMA IF NOT EXISTS sens AUTHORIZATION gm_app;
COMMENT ON SCHEMA sens IS
  'Специальная категория ПДн (ст.10 ФЗ-152): здоровье. Значения шифруются приложением, ключ вне базы.';

-- ── 2. Переезд группы А в схему sens ──
-- Таблицы создаются 02-apply-core.sh в public; переносим их целиком, вместе с данными.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['allergen','medication','condition','injury'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t)
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'sens' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA sens', t);
      RAISE NOTICE 'перенесена в контур здоровья: %', t;
    END IF;
  END LOOP;
END $$;

-- ── 3. Показатели: открытый ряд и закрытый ряд ──
-- Белый список открытых метрик. Он же продублирован в backstops/metric_contour.js —
-- решает КОД, а не модель; тест сверяет оба списка между собой.
CREATE TABLE IF NOT EXISTS public.metric_whitelist (
  metric text PRIMARY KEY,
  title_ru text NOT NULL
);
ALTER TABLE public.metric_whitelist OWNER TO gm_app;
INSERT INTO public.metric_whitelist (metric, title_ru) VALUES
  ('weight','вес'), ('waist','талия'), ('hip','бёдра'), ('chest','грудь'),
  ('thigh','бедро'), ('arm','рука'), ('calf','голень'), ('neck','шея'),
  ('shoulders','плечи'), ('water_ml','вода'), ('sleep_hours','сон'), ('steps','шаги')
ON CONFLICT (metric) DO UPDATE SET title_ru = EXCLUDED.title_ru;

-- Закрытый ряд: та же структура, другая схема. Значение хранится шифротекстом.
CREATE TABLE IF NOT EXISTS sens.measurement (
  id           bigserial PRIMARY KEY,
  bot_id       text   NOT NULL,
  user_id      bigint NOT NULL,
  measured_on  date   NOT NULL,
  metric       text   NOT NULL,
  value_enc    text   NOT NULL,          -- v1:iv:tag:ct, ключ в окружении сервиса
  unit         text,
  source       text   NOT NULL DEFAULT 'manual',
  note_enc     text,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sens.measurement OWNER TO gm_app;
CREATE INDEX IF NOT EXISTS sens_measurement_key ON sens.measurement (bot_id, user_id, metric, measured_on);

-- Открытый ряд принимает только метрики из белого списка. Это не рекомендация модели,
-- а отказ базы: первая же запись «сахар 6,8» в открытый контур не приземлится.
CREATE OR REPLACE FUNCTION public.fn_metric_whitelist_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.metric_whitelist w WHERE w.metric = NEW.metric) THEN
    RAISE EXCEPTION 'показатель «%» не в белом списке открытого контура: писать в sens.measurement', NEW.metric
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS metric_whitelist_guard ON public.measurement;
CREATE TRIGGER metric_whitelist_guard
  BEFORE INSERT OR UPDATE ON public.measurement
  FOR EACH ROW EXECUTE FUNCTION public.fn_metric_whitelist_guard();

-- Уже лежащие в открытом ряду чувствительные показатели переезжают в закрытый.
-- Значения при переносе НЕ шифруются: ключа у базы нет и быть не должно. Их перешифровывает
-- отдельный прогон приложения, а до тех пор строки помечены source='migrated-plain'.
INSERT INTO sens.measurement (bot_id, user_id, measured_on, metric, value_enc, unit, source, recorded_at)
SELECT m.bot_id, m.user_id, m.measured_on, m.metric, m.value::text, m.unit, 'migrated-plain', m.recorded_at
  FROM public.measurement m
 WHERE NOT EXISTS (SELECT 1 FROM public.metric_whitelist w WHERE w.metric = m.metric);
DELETE FROM public.measurement m
 WHERE NOT EXISTS (SELECT 1 FROM public.metric_whitelist w WHERE w.metric = m.metric);

-- ── 4. Ограничение вместо диагноза ──
-- Главный приём: продукту не нужен диагноз, нужен запрет. Поэтому в открытом контуре
-- у ограничения не остаётся ни ссылки на первоисточник, ни его типа.
UPDATE public.exclusion
   SET source_type = 'client_request', source_ref = NULL,
       note = COALESCE(note, 'ограничение подтверждено пользователем')
 WHERE source_type IN ('injury','condition','medication') OR source_ref IS NOT NULL;

ALTER TABLE public.exclusion DROP CONSTRAINT IF EXISTS exclusion_no_medical_link;
ALTER TABLE public.exclusion ADD CONSTRAINT exclusion_no_medical_link
  CHECK (source_ref IS NULL AND source_type NOT IN ('injury','condition','medication'));

-- Связь «ограничение ← первоисточник» живёт в контуре здоровья и только под согласием.
CREATE TABLE IF NOT EXISTS sens.exclusion_source (
  exclusion_id bigint PRIMARY KEY,
  bot_id       text   NOT NULL,
  user_id      bigint NOT NULL,
  source_type  text   NOT NULL CHECK (source_type IN ('injury','condition','medication')),
  source_ref   bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sens.exclusion_source OWNER TO gm_app;

-- ── 5. Разборы: библиотека без пользователя ──
-- Персональные данные создаёт не текст разбора, а связка «этот человек читал про метформин».
CREATE TABLE IF NOT EXISTS public.research_library (
  id          bigserial PRIMARY KEY,
  topic       text NOT NULL,
  topic_key   text NOT NULL UNIQUE,
  report_text text,
  pdf         bytea,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.research_library OWNER TO gm_app;

CREATE TABLE IF NOT EXISTS sens.research_access (
  bot_id     text   NOT NULL,
  user_id    bigint NOT NULL,
  report_id  bigint NOT NULL REFERENCES public.research_library(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  PRIMARY KEY (bot_id, user_id, report_id)
);
ALTER TABLE sens.research_access OWNER TO gm_app;

-- ── 6. Согласие на контур здоровья ──
-- Отдельное согласие, отдельная команда, отдельное удаление — и НИКОГДА не условие оплаты
-- и не условие онбординга (ст.16 ЗоЗПП, блокер Б12 юридического плана).
ALTER TABLE public.client_profile
  ADD COLUMN IF NOT EXISTS health_consent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS health_consent_scope text,
  ADD COLUMN IF NOT EXISTS health_consent_doc   text;

COMMENT ON COLUMN public.client_profile.health_consent_at IS
  'Момент согласия на обработку спецкатегории. NULL — запись в схему sens запрещена.';

-- Удаление контура здоровья одной командой, не трогая подписку и остальные данные.
CREATE OR REPLACE FUNCTION sens.fn_forget_health(p_bot text, p_uid bigint)
RETURNS text AS $$
DECLARE
  n_all int; n_med int; n_con int; n_inj int; n_mea int; n_acc int; n_exs int;
BEGIN
  DELETE FROM sens.allergen         WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_all = ROW_COUNT;
  DELETE FROM sens.medication       WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_med = ROW_COUNT;
  DELETE FROM sens.condition        WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_con = ROW_COUNT;
  DELETE FROM sens.injury           WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_inj = ROW_COUNT;
  DELETE FROM sens.measurement      WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_mea = ROW_COUNT;
  DELETE FROM sens.research_access  WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_acc = ROW_COUNT;
  DELETE FROM sens.exclusion_source WHERE bot_id = p_bot AND user_id = p_uid;  GET DIAGNOSTICS n_exs = ROW_COUNT;
  UPDATE public.client_profile SET health_consent_at = NULL, health_consent_scope = NULL
   WHERE bot_id = p_bot AND user_id = p_uid;
  RETURN format('Удалено из контура здоровья: аллергии %s, препараты %s, состояния %s, травмы %s, показатели %s, доступы к разборам %s, связи ограничений %s. Согласие отозвано. Ограничения в тренировках сохранены.',
                n_all, n_med, n_con, n_inj, n_mea, n_acc, n_exs);
END $$ LANGUAGE plpgsql;
ALTER FUNCTION sens.fn_forget_health(text, bigint) OWNER TO gm_app;

-- ── 7. Права ЭТАПА 1: широко, как решил владелец 09.09.2026 ──
-- Схема заложена, ограничения включаются 10-stage2-revoke.sql перед первым клиентом.
GRANT USAGE ON SCHEMA sens TO gm_app, gm_dev;
GRANT ALL ON ALL TABLES IN SCHEMA sens TO gm_app, gm_dev;
GRANT ALL ON ALL SEQUENCES IN SCHEMA sens TO gm_app, gm_dev;
ALTER DEFAULT PRIVILEGES FOR ROLE gm_app IN SCHEMA sens GRANT ALL ON TABLES TO gm_dev;

COMMIT;

-- ── Проверка фактом ──
DO $$
DECLARE
  missing text;
  bad_open int;
  linked int;
BEGIN
  SELECT string_agg(t, ', ') INTO missing FROM unnest(ARRAY['allergen','medication','condition',
    'injury','measurement','exclusion_source','research_access']) t
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'sens' AND table_name = t);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'в контуре здоровья нет таблиц: %', missing; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name IN ('allergen','medication','condition','injury')) THEN
    RAISE EXCEPTION 'таблицы группы А остались в открытом контуре';
  END IF;

  SELECT count(*) INTO bad_open FROM public.measurement m
   WHERE NOT EXISTS (SELECT 1 FROM public.metric_whitelist w WHERE w.metric = m.metric);
  IF bad_open > 0 THEN RAISE EXCEPTION 'в открытом ряду осталось % чувствительных показателей', bad_open; END IF;

  SELECT count(*) INTO linked FROM public.exclusion
   WHERE source_ref IS NOT NULL OR source_type IN ('injury','condition','medication');
  IF linked > 0 THEN RAISE EXCEPTION 'у % ограничений осталась ссылка на медицинский первоисточник', linked; END IF;

  -- Ограждение открытого ряда должно ОТКАЗЫВАТЬ, а не молча пропускать: проверяем ветку ошибки.
  BEGIN
    INSERT INTO public.measurement (bot_id, user_id, measured_on, metric, value, unit, source)
    VALUES ('__guardtest__', 1, CURRENT_DATE, 'glucose', 6.8, 'ммоль/л', 'test');
    RAISE EXCEPTION 'ограждение белого списка не сработало: чувствительный показатель принят в открытый контур';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- так и должно быть
  END;
  DELETE FROM public.measurement WHERE bot_id = '__guardtest__';

  RAISE NOTICE 'Контур здоровья создан: схема sens, белый список показателей, ограничения без ссылок на диагнозы.';
  RAISE NOTICE 'Права этапа 1 у gm_dev полные. Перед первым клиентом — 10-stage2-revoke.sql.';
END $$;
