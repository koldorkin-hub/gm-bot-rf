// Генерирует cvalidate.sql: живая проверка новых запросов от имени n8n_user в транзакции, всё откатывается.
// Тестовый клиент — изолированный 999608. Результаты — строками OK/ПЛОХО.
const fs = require('fs');
const L = (p) => { const d = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(d) ? d[0] : d; };
const lw = L('lw.fixed.json'), ds = L('ds.fixed.json'), me = L('me.fixed.json');
// psql \gset СНИМАЕТ переменную, если значение NULL, и :'x' превращается в синтаксическую ошибку.
// Поэтому только для проверки финальная проекция отдаёт id строкой ('' вместо NULL); логика CTE та же.
const SQ_TAIL = 'SELECT main_id, cardio_id, COALESCE(main_id, cardio_id) AS id FROM ids';
const sq0 = lw.nodes.find((n) => n.name === 'Сессия').parameters.query.replace(/;\s*$/, '');
if (sq0.split(SQ_TAIL).length !== 2) throw new Error('финальная проекция запроса «Сессия» не найдена');
const sq = sq0.replace(SQ_TAIL, () => "SELECT coalesce(main_id::text, '') AS main_id, coalesce(cardio_id::text, '') AS cardio_id, COALESCE(main_id, cardio_id)::text AS id FROM ids");
const dsq = ds.nodes.find((n) => n.name === 'Сессии').parameters.query.replace(/;\s*$/, '');
const meq = me.nodes.find((n) => n.name === 'Клиенты').parameters.query.replace(/;\s*$/, '');
const lit = (v) => (v === null || v === undefined) ? 'NULL' : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const call = (date, mainType, dur, note, hasMain, hasCardio, cMin, cNote) =>
  sq.replace(/\$(\d+)/g, (m, n) => lit(['users', 999608, date, mainType, dur, note, hasMain, hasCardio, cMin, cNote][Number(n) - 1]));
const types = "(SELECT coalesce(string_agg(session_type || ':' || coalesce(duration_min::text, '-'), ',' ORDER BY id), '') FROM workout_session WHERE user_id = 999608 AND performed_on = ";

process.stdout.write(`\\set ON_ERROR_STOP on
SET ROLE n8n_user;
BEGIN;
DELETE FROM workout_entry WHERE session_id IN (SELECT id FROM workout_session WHERE user_id = 999608);
DELETE FROM workout_session WHERE user_id = 999608;
DELETE FROM training_program WHERE user_id = 999608;

-- A: силовая + кардио одним вызовом
${call('2026-09-10', 'strength', 90, 'силовая', true, true, 60, null)} \\gset a_
SELECT CASE WHEN :'a_main_id' <> '' AND :'a_cardio_id' <> '' AND :'a_main_id' <> :'a_cardio_id' AND :'a_id' = :'a_main_id'
  THEN 'OK   A: смешанный вызов — две разные сессии, основной id силовой' ELSE 'ПЛОХО A: ' || :'a_main_id' || '/' || :'a_cardio_id' || '/' || :'a_id' END;
SELECT CASE WHEN ${types}'2026-09-10') = 'strength:90,cardio:60' THEN 'OK   A: типы и длительности strength:90, cardio:60'
  ELSE 'ПЛОХО A2: ' || ${types}'2026-09-10') END;

-- B: потом ещё кардио в тот же день — дописывается в ту же кардио-сессию
${call('2026-09-10', 'other', null, null, false, true, 30, 'вело')} \\gset b_
SELECT CASE WHEN :'b_main_id' = '' AND :'b_cardio_id' = :'a_cardio_id' AND :'b_id' = :'a_cardio_id'
  THEN 'OK   B: кардио после силовой — в ту же кардио-сессию, силовая не тронута' ELSE 'ПЛОХО B: ' || :'b_main_id' || '/' || :'b_cardio_id' END;
SELECT CASE WHEN ${types}'2026-09-10') = 'strength:90,cardio:90' THEN 'OK   B: минуты кардио сложились (60+30), сессий по-прежнему две'
  ELSE 'ПЛОХО B2: ' || ${types}'2026-09-10') END;

-- C: ещё силовое упражнение в тот же день — в ту же силовую
${call('2026-09-10', 'strength', null, null, true, false, null, null)} \\gset c_
SELECT CASE WHEN :'c_main_id' = :'a_main_id' AND :'c_cardio_id' = '' THEN 'OK   C: силовое после кардио — в ту же силовую, дробления нет'
  ELSE 'ПЛОХО C: ' || :'c_main_id' || '/' || :'c_cardio_id' END;

-- D: день только с кардио — силовая не создаётся
${call('2026-09-09', 'strength', null, null, false, true, 45, 'эллипс')} \\gset d_
SELECT CASE WHEN :'d_main_id' = '' AND :'d_cardio_id' <> '' AND ${types}'2026-09-09') = 'cardio:45'
  THEN 'OK   D: день только с кардио — одна кардио-сессия 45 мин' ELSE 'ПЛОХО D: ' || ${types}'2026-09-09') END;

-- P: функция программы с кардио
SELECT new_version, jsonb_array_length(new_cardio) AS nc FROM set_training_program('users', 999608, 'Europe/Moscow', 'Т',
  '[{"day":1,"name":"А","exercises":[{"name":"Жим","target":"3 × 10"}]}]'::jsonb, 'v1', '[{"name":"Эллипс","duration_min":60}]'::jsonb) \\gset p1_
SELECT new_version, jsonb_array_length(new_cardio) AS nc, jsonb_array_length(old_cardio) AS oc FROM set_training_program('users', 999608, 'Europe/Moscow', 'Т',
  '[{"day":1,"name":"А","exercises":["Жим","Тяга"]}]'::jsonb, 'v2', NULL) \\gset p2_
SELECT new_version, jsonb_array_length(new_cardio) AS nc FROM set_training_program('users', 999608, 'Europe/Moscow', 'Т',
  '[{"day":1,"name":"А","exercises":["Жим"]}]'::jsonb, 'v3', '[]'::jsonb) \\gset p3_
SELECT new_version FROM set_training_program('users', 999608, 'Europe/Moscow', 'Т', '[{"day":1,"name":"А","exercises":["Жим"]}]'::jsonb, 'старый вызов, 6 аргументов') \\gset p4_
SELECT CASE WHEN :'p1_new_version' = '1' AND :'p1_nc' = '1' THEN 'OK   P1: первая версия с кардио' ELSE 'ПЛОХО P1' END;
SELECT CASE WHEN :'p2_new_version' = '2' AND :'p2_nc' = '1' AND :'p2_oc' = '1' THEN 'OK   P2: кардио не передано — перешло из прежней версии' ELSE 'ПЛОХО P2: ' || :'p2_nc' END;
SELECT CASE WHEN :'p3_new_version' = '3' AND :'p3_nc' = '0' THEN 'OK   P3: пустой [] — кардио убрано явно' ELSE 'ПЛОХО P3' END;
SELECT CASE WHEN :'p4_new_version' = '4' AND (SELECT count(*) FROM training_program WHERE user_id = 999608 AND status = 'active') = 1
  THEN 'OK   P4: старый вызов с 6 аргументами работает (выкатка без простоя), действующая одна' ELSE 'ПЛОХО P4' END;

-- S: запросы сводок компилируются и отдают флаг
SELECT 'OK   S: нить диалога — к обработке ' || count(*) || ', из них с программой ' || count(*) FILTER (WHERE has_program) FROM (${dsq}) q;
SELECT 'OK   S: выжимка — к обработке ' || count(*) || ', из них с программой ' || count(*) FILTER (WHERE has_program) FROM (${meq}) q;

ROLLBACK;
\\echo ##ВСЁ_ОТКАЧЕНО
`);
