-- ============================================================================
-- РФ-сервер, шаг 1: роли и базы. Применяется ОДИН раз при развёртывании, от postgres:
--     su - postgres -c "psql -v ON_ERROR_STOP=1 -f /opt/gm-bot-rf/schema/01-roles.sql"
--
-- Смысл (ДОСТУП-И-ДОКАЗУЕМОСТЬ.md): структуру разделения доступа закладываем СРАЗУ,
-- а права на этапе 1 раздаём широко. Тогда включение защиты перед приходом первого
-- клиента — это несколько REVOKE (10-stage2-revoke.sql), а не пересборка сервера,
-- и история коммитов показывает, с какой даты действуют ограничения.
--
-- ЭТАП 1 (сейчас): роль dev имеет полный доступ к боевой базе. На сервере только данные
-- владельца, защищать нечего, ограничения мешали бы разработке. Решение владельца 09.09.2026.
--
-- Пароли: НЕ в этом файле и НЕ в репозитории. Задаются переменными psql:
--     psql -v app_password="'…'" -v dev_password="'…'" -f 01-roles.sql
-- Идемпотентно: повторный прогон обновляет пароли и права, ничего не ломая.
-- ============================================================================

\set ON_ERROR_STOP on

-- Значения по умолчанию, чтобы файл не падал при прогоне без переменных: пароль
-- обязателен, поэтому вместо тихой заглушки — явная ошибка.
\if :{?app_password}
\else
\echo 'ОШИБКА: не задан -v app_password'
\quit 1
\endif
\if :{?dev_password}
\else
\echo 'ОШИБКА: не задан -v dev_password'
\quit 1
\endif

-- ── Роли ──
-- app — под ней работает бот. Пароль знает только боевой сервис.
-- dev — под ней идёт разработка. На этапе 2 у неё отберут SELECT на таблицы с ПДн.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gm_app') THEN
    CREATE ROLE gm_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gm_dev') THEN
    CREATE ROLE gm_dev LOGIN;
  END IF;
END $$;

ALTER ROLE gm_app WITH PASSWORD :app_password;
ALTER ROLE gm_dev WITH PASSWORD :dev_password;
ALTER ROLE gm_app NOSUPERUSER NOCREATEROLE NOCREATEDB;
ALTER ROLE gm_dev NOSUPERUSER NOCREATEROLE NOCREATEDB;

-- ── Базы ──
-- gm_memory  — боевая: профили, журналы, здоровье, переписка.
-- gm_dev     — синтетика: по умолчанию разработка ведётся здесь, просто потому что удобнее.
SELECT 'CREATE DATABASE gm_memory OWNER gm_app'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'gm_memory') \gexec
SELECT 'CREATE DATABASE gm_dev OWNER gm_dev'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'gm_dev') \gexec

-- ── Права ЭТАПА 1: широко ──
GRANT CONNECT ON DATABASE gm_memory TO gm_app, gm_dev;
GRANT CONNECT ON DATABASE gm_dev    TO gm_app, gm_dev;

\connect gm_memory
GRANT USAGE, CREATE ON SCHEMA public TO gm_app, gm_dev;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO gm_app, gm_dev;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gm_app, gm_dev;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gm_app, gm_dev;
-- Таблицы, которые появятся позже, тоже должны быть доступны обеим ролям.
ALTER DEFAULT PRIVILEGES FOR ROLE gm_app IN SCHEMA public
  GRANT ALL ON TABLES TO gm_dev;
ALTER DEFAULT PRIVILEGES FOR ROLE gm_app IN SCHEMA public
  GRANT ALL ON SEQUENCES TO gm_dev;

-- Журналирование запросов роли разработки. На этапе 1 это не ограничение, а привычка:
-- к этапу 2 объём журнала уже известен и не станет сюрпризом.
ALTER ROLE gm_dev SET log_statement = 'all';

\connect gm_dev
GRANT USAGE, CREATE ON SCHEMA public TO gm_app, gm_dev;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO gm_app, gm_dev;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gm_app, gm_dev;

-- ── Проверка фактом, а не кодом возврата ──
\connect postgres
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO missing FROM (
    SELECT 'роль ' || x AS r FROM unnest(ARRAY['gm_app','gm_dev']) x
     WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x)
    UNION ALL
    SELECT 'база ' || x FROM unnest(ARRAY['gm_memory','gm_dev']) x
     WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = x)
    UNION ALL
    SELECT 'у роли gm_app остались права суперпользователя'
     WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gm_app' AND rolsuper)
    UNION ALL
    SELECT 'у роли gm_dev остались права суперпользователя'
     WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gm_dev' AND rolsuper)
  ) t;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'шаг 1 не выполнен: %', missing;
  END IF;
  RAISE NOTICE 'Шаг 1 выполнен: роли gm_app и gm_dev созданы, базы gm_memory и gm_dev на месте.';
  RAISE NOTICE 'Этап 1: права у gm_dev полные. Перед первым клиентом — 10-stage2-revoke.sql.';
END $$;
