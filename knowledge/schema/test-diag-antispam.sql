-- Проверка анти-спама тревог сторожа. Всё внутри транзакции с ROLLBACK —
-- боевые ops_alert/diag_state не меняются.
BEGIN;

\echo '--- 1. Первая тревога: должна вернуть строку (слать можно) ---'
INSERT INTO ops_alert (kind, last_at) VALUES ('diag_red_test', now())
  ON CONFLICT (kind) DO UPDATE SET last_at = now()
  WHERE ops_alert.last_at < now() - interval '30 minutes'
  RETURNING kind;

\echo '--- 2. Повтор сразу: должно быть 0 строк (подавлено) ---'
INSERT INTO ops_alert (kind, last_at) VALUES ('diag_red_test', now())
  ON CONFLICT (kind) DO UPDATE SET last_at = now()
  WHERE ops_alert.last_at < now() - interval '30 minutes'
  RETURNING kind;

\echo '--- 3. Прошёл 31 минута: снова должна вернуть строку ---'
UPDATE ops_alert SET last_at = now() - interval '31 minutes' WHERE kind = 'diag_red_test';
INSERT INTO ops_alert (kind, last_at) VALUES ('diag_red_test', now())
  ON CONFLICT (kind) DO UPDATE SET last_at = now()
  WHERE ops_alert.last_at < now() - interval '30 minutes'
  RETURNING kind;

\echo '--- 4. Сброс окна при восстановлении: строка должна быть ВСЕГДА (иначе сообщение о починке не уйдёт) ---'
WITH d AS (DELETE FROM ops_alert WHERE kind = 'diag_red_test' RETURNING 1)
SELECT COALESCE((SELECT count(*) FROM d), 0) AS cleared;

\echo '--- 5. Сброс на пустом месте: тоже должна быть строка, cleared=0 ---'
WITH d AS (DELETE FROM ops_alert WHERE kind = 'diag_red_test' RETURNING 1)
SELECT COALESCE((SELECT count(*) FROM d), 0) AS cleared;

\echo '--- 6. Переход состояния: prev должен показать СТАРОЕ значение ---'
INSERT INTO diag_state (k, status, changed_at, details) VALUES ('test', 'red', now(), 'было красное')
  ON CONFLICT (k) DO UPDATE SET status = EXCLUDED.status;
WITH old AS (SELECT status FROM diag_state WHERE k = 'test'),
upd AS (
  INSERT INTO diag_state (k, status, changed_at, details) VALUES ('test', 'ok', now(), 'стало хорошо')
  ON CONFLICT (k) DO UPDATE SET status = EXCLUDED.status, details = EXCLUDED.details,
    changed_at = CASE WHEN diag_state.status <> EXCLUDED.status THEN now() ELSE diag_state.changed_at END
  RETURNING status
),
cl AS (DELETE FROM ops_error WHERE at < now() - interval '30 days' RETURNING 1)
SELECT COALESCE((SELECT status FROM old), 'none') AS prev,
       COALESCE((SELECT status FROM upd), 'ok') AS cur,
       (SELECT count(*) FROM cl) AS purged;

ROLLBACK;

\echo '--- После отката боевые данные должны быть нетронуты ---'
SELECT count(*) AS ops_alert_rows FROM ops_alert;
SELECT k, status FROM diag_state ORDER BY k;
