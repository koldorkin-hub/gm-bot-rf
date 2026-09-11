// Генерирует validate.sql: живая проверка новых запросов в транзакции от имени n8n_user.
// Всё откатывается в конце. Тестовый клиент — изолированный 999608.
// Значение source берётся из уже существующих строк: у колонки стоит CHECK на допустимые
// значения, и произвольное 'test' база отвергает.
const fs = require('fs');
const L = (p) => { const d = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(d) ? d[0] : d; };
const tick = L('tick.fixed.json');
const rt = L('remtool.fixed.json');
const sel = tick.nodes.find((n) => n.name === 'Напоминания: выборка').parameters.query;
const cls = tick.nodes.find((n) => n.name === 'Напоминания: закрыть').parameters.query;
const pc = rt.nodes.find((n) => n.name === 'Параметры').parameters.jsCode;

const lit = (v) => (v && v.raw) ? v.raw
  : (v === null || v === undefined) ? 'NULL'
  : (typeof v === 'number') ? String(v)
  : "'" + String(v).replace(/'/g, "''") + "'";
const sub = (q, p) => q.replace(/\$(\d+)/g, (m, n) => lit(p[Number(n) - 1]));

const cr = new Function('$input', pc)({ first: () => ({ json: {
  bot_id: 'users', user_id: 999608, chat_id: 999608, tz: 'Europe/Moscow',
  action: 'create', text: 'Взвеситься ТЕСТ', when_date: '2026-09-20', when_time: '10:00', done_when: 'measurement:weight',
} }) })[0].json;

const T = "(now() AT TIME ZONE 'Europe/Moscow')::date";
const SRC = (tbl) => `(SELECT source FROM ${tbl} WHERE source IS NOT NULL GROUP BY source ORDER BY count(*) DESC LIMIT 1)`;
const closeSql = sub(cls, [
  { raw: "(SELECT id FROM reminder WHERE user_id=999608 AND text='ТЕСТ записать ужин' AND status='pending' ORDER BY id LIMIT 1)" },
  '⏰ ТЕСТ',
  { raw: 'true' },
]);

process.stdout.write(`\\set ON_ERROR_STOP on
SET ROLE n8n_user;
BEGIN;
INSERT INTO client_profile (bot_id,user_id,language,onboarding_done,timezone) VALUES ('users',999608,'Russian',true,'Europe/Moscow')
  ON CONFLICT (bot_id,user_id) DO UPDATE SET timezone='Europe/Moscow';
INSERT INTO measurement (bot_id,user_id,measured_on,metric,value,unit,source) VALUES ('users',999608,${T},'вес',84.5,'kg',${SRC('measurement')});
INSERT INTO workout_session (bot_id,user_id,performed_on,session_type,duration_min,source) VALUES ('users',999608,${T},'cardio',30,${SRC('workout_session')});
INSERT INTO food_log (bot_id,user_id,eaten_on,meal_type,description,kcal,source) VALUES ('users',999608,${T} - 1,'dinner','тест',500,${SRC('food_log')});
INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule,status,done_when) VALUES
 ('users',999608,999608,now()-interval '1 minute','ТЕСТ взвеситься','weekly','pending','measurement:weight'),
 ('users',999608,999608,now()-interval '1 minute','ТЕСТ силовая','none','pending','workout:strength'),
 ('users',999608,999608,now()-interval '1 minute','ТЕСТ ужин','none','pending','food:dinner'),
 ('users',999608,999608,now()-interval '1 minute','ТЕСТ укол','none','pending','none');
\\echo ##ВЫБОРКА_НАЧАЛО
${sel}
\\echo ##ВЫБОРКА_КОНЕЦ
DO $v$ BEGIN
  IF (SELECT status FROM reminder WHERE user_id=999608 AND text='ТЕСТ взвеситься' ORDER BY id LIMIT 1) <> 'skipped_done' THEN
    RAISE EXCEPTION 'A: взвешивание (метрика «вес») не пропущено'; END IF;
  IF NOT EXISTS (SELECT 1 FROM reminder WHERE user_id=999608 AND text='ТЕСТ взвеситься' AND status='pending'
                 AND done_when='measurement:weight' AND fire_at > now() + interval '6 days') THEN
    RAISE EXCEPTION 'A: у пропущенного не поставлен следующий повтор или потерялась связь'; END IF;
  IF (SELECT status FROM reminder WHERE user_id=999608 AND text='ТЕСТ силовая') <> 'pending' THEN
    RAISE EXCEPTION 'B: силовую закрыло кардио'; END IF;
  IF (SELECT status FROM reminder WHERE user_id=999608 AND text='ТЕСТ ужин') <> 'pending' THEN
    RAISE EXCEPTION 'C: ужин закрыт вчерашней записью'; END IF;
  IF (SELECT status FROM reminder WHERE user_id=999608 AND text='ТЕСТ укол') <> 'pending' THEN
    RAISE EXCEPTION 'D: напоминание без связи закрыто'; END IF;
  RAISE NOTICE 'ТИКЕР OK: вес пропущен и серия продолжена; кардио не закрыло силовую; вчерашний ужин не закрыл сегодняшний; без связи пришло';
END $v$;
INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule,status,done_when) VALUES
 ('users',999608,999608,now()-interval '1 minute','ТЕСТ записать ужин','weekly','pending','food:dinner');
${closeSql}
DO $v$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM reminder WHERE user_id=999608 AND text='ТЕСТ записать ужин' AND status='sent') THEN
    RAISE EXCEPTION 'E: не отмечено отправленным'; END IF;
  IF NOT EXISTS (SELECT 1 FROM reminder WHERE user_id=999608 AND text='ТЕСТ записать ужин' AND status='pending' AND done_when='food:dinner') THEN
    RAISE EXCEPTION 'E: связь не перешла в следующий повтор'; END IF;
  RAISE NOTICE 'ЗАКРЫТИЕ OK: после отправки связь перешла в следующий повтор';
END $v$;
INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule,status) VALUES
 ('users',999608,999608,('2026-09-20 10:15')::timestamp AT TIME ZONE 'Europe/Moscow','ТЕСТ сосед','none','pending');
\\echo ##СОЗДАНИЕ_НАЧАЛО
${sub(cr.query, cr.params)};
\\echo ##СОЗДАНИЕ_КОНЕЦ
DO $v$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM reminder WHERE user_id=999608 AND text='Взвеситься ТЕСТ' AND done_when='measurement:weight'
                 AND to_char(fire_at AT TIME ZONE 'Europe/Moscow','DD.MM HH24:MI')='20.09 10:00') THEN
    RAISE EXCEPTION 'F: связь или время не записались'; END IF;
  RAISE NOTICE 'ИНСТРУМЕНТ OK: создано со связью и верным временем';
END $v$;
\\echo ##ПРОГРАММА_НАЧАЛО
SELECT new_version, old_version FROM set_training_program('users', 999608, 'Europe/Moscow', 'Тест', '[{"day":1,"name":"А","exercises":["Жим"]}]'::jsonb, 'v1');
SELECT new_version, old_version, old_days FROM set_training_program('users', 999608, 'Europe/Moscow', 'Тест 2', '[{"day":1,"name":"А","exercises":["Жим","Тяга"]}]'::jsonb, 'v2');
\\echo ##ПРОГРАММА_КОНЕЦ
DO $v$ BEGIN
  IF (SELECT count(*) FROM training_program WHERE bot_id='users' AND user_id=999608 AND status='active') <> 1 THEN
    RAISE EXCEPTION 'P: действующих не ровно одна'; END IF;
  IF (SELECT version FROM training_program WHERE bot_id='users' AND user_id=999608 AND status='active') <> 2 THEN
    RAISE EXCEPTION 'P: действующая не версия 2'; END IF;
  IF (SELECT status FROM training_program WHERE bot_id='users' AND user_id=999608 AND version=1) <> 'retired' THEN
    RAISE EXCEPTION 'P: версия 1 не снята'; END IF;
  BEGIN
    INSERT INTO training_program (bot_id,user_id,version,status,title,days,started_on)
    VALUES ('users',999608,9,'active','взлом','[{"day":1,"name":"x","exercises":["y"]}]',current_date);
    RAISE EXCEPTION 'P: база пустила вторую действующую программу';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ПРОГРАММА OK: новая версия снимает старую; вторую действующую база не пускает';
  END;
END $v$;
ROLLBACK;
\\echo ##ВСЁ_ОТКАЧЕНО
`);
