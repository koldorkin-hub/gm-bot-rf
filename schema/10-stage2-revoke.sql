-- ============================================================================
-- РФ-сервер, переход на ЭТАП 2. Применяется ПЕРЕД тем, как на сервер попадут данные
-- первого человека, кроме владельца — включая участника фокус-группы.
--     su - postgres -c "psql -v ON_ERROR_STOP=1 -d gm_memory -f 10-stage2-revoke.sql"
--
-- Этот файл написан заранее, на этапе 1, ровно ради того, чтобы переход занимал пять минут
-- и не требовал решений в спешке. Пункт первый в ГОТОВНОСТЬ-К-ПРОДАЖАМ.md.
--
-- Принцип: логи доказывают слабо, права доказывают сильно. После этого скрипта утверждение
-- «учётная запись разработки не могла читать персональные данные» проверяется одним
-- запросом к системному каталогу и не зависит от доверия к нам.
-- ============================================================================

\set ON_ERROR_STOP on

-- Таблицы с персональными данными, включая специальную категорию «здоровье».
-- Список ведётся здесь: появилась таблица с ПДн — строка добавляется сюда же.
CREATE TABLE IF NOT EXISTS pd_tables (
  table_name text PRIMARY KEY,
  reason     text NOT NULL
);
INSERT INTO pd_tables (table_name, reason) VALUES
  ('client_profile',      'имя, дата рождения, антропометрия, цели'),
  ('measurement',         'вес, обхваты, показатели анализов'),
  ('food_log',            'пищевой дневник'),
  ('workout_session',     'тренировки'),
  ('workout_entry',       'тренировки, детально'),
  ('food_preference',     'пищевые предпочтения'),
  ('exclusion',           'ограничения, выведенные из здоровья'),
  ('recipe',              'персональная библиотека'),
  ('recipe_ingredient',   'персональная библиотека'),
  ('research_report',     'персональные разборы'),
  ('plan',                'персональные планы'),
  ('client_summary',      'производная выжимка о человеке'),
  ('dialog_summary',      'производная выжимка о человеке'),
  ('chat_history_archive','переписка'),
  ('n8n_chat_histories',  'переписка'),
  ('clients',             'идентификаторы и настройки клиентов'),
  ('user_access',         'идентификаторы пользователей')
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;

-- ── Контур здоровья целиком: сначала он, он же самый дорогой ──
-- Схема sens (04-sensitive-contour.sql) содержит только специальную категорию. Поэтому
-- закрывается не по таблицам, а целиком: отзыв USAGE на схему доказывается одной строкой
-- системного каталога и не зависит от того, не забыли ли мы новую таблицу.
REVOKE ALL ON ALL TABLES IN SCHEMA sens FROM gm_dev;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sens FROM gm_dev;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sens FROM gm_dev;
REVOKE USAGE ON SCHEMA sens FROM gm_dev;
ALTER DEFAULT PRIVILEGES FOR ROLE gm_app IN SCHEMA sens REVOKE ALL ON TABLES FROM gm_dev;

-- ── Отзыв прав у роли разработки в открытом контуре ──
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT p.table_name FROM pd_tables p
            JOIN information_schema.tables i
              ON i.table_name = p.table_name AND i.table_schema = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM gm_dev', t.table_name);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE gm_app IN SCHEMA public REVOKE ALL ON TABLES FROM gm_dev;
REVOKE CREATE ON SCHEMA public FROM gm_dev;

-- Структура остаётся видна: разработке нужны схемы, а не строки.
GRANT USAGE ON SCHEMA public TO gm_dev;

-- ── Проверка фактом: не «скрипт отработал», а «прав действительно нет» ──
DO $$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(DISTINCT g.table_name || ' (' || g.privilege_type || ')', ', ')
    INTO leftovers
    FROM information_schema.table_privileges g
    JOIN pd_tables p ON p.table_name = g.table_name
   WHERE g.grantee = 'gm_dev' AND g.table_schema = 'public';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'у роли gm_dev остались права на таблицы с ПДн: %', leftovers;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name IN (SELECT table_name FROM pd_tables)
                AND has_table_privilege('gm_dev', 'public.' || table_name, 'SELECT')) THEN
    RAISE EXCEPTION 'has_table_privilege всё ещё разрешает gm_dev читать таблицы с ПДн';
  END IF;

  IF has_schema_privilege('gm_dev', 'sens', 'USAGE') THEN
    RAISE EXCEPTION 'у роли gm_dev осталось право USAGE на схему sens — контур здоровья не закрыт';
  END IF;

  RAISE NOTICE 'Этап 2 включён: gm_dev не имеет прав ни на схему sens, ни на таблицы с ПДн в public.';
  RAISE NOTICE 'Проверить в любой момент: SELECT * FROM information_schema.table_privileges WHERE grantee=''gm_dev'';';
END $$;
