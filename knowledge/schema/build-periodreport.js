/**
 * PeriodReport01 — пакет данных для отчёта о прогрессе за период.
 *
 * Повод (04.09.2026, владелец): «отчёт по /progress неинформативный, практически одни
 * графики; в чате бот рассказал о прогрессе лучше, чем по команде». Причина была в том,
 * что отдельного отчёта не существовало — команда просто уходила агенту, и он сам решал,
 * что показать. Отсюда и разнобой, и жим ногами как мерило прогресса у человека с протезом.
 *
 * Принцип тот же, что с выпиской дня и календарём: СЧИТАЕТ КОД, агент только пишет текст.
 * Тогда /progress и просьба в чате дают одинаково полный результат.
 *
 * Состав пакета согласован с владельцем (баланс и динамику по упражнениям он убрал):
 *   тренировки, питание, расход, вес, замеры, рекорды.
 *
 * Сборка:  node schema/build-periodreport.js  ->  schema/PeriodReport01.json
 */
const fs = require('fs');
const path = require('path');

const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

// Границы периода считаем в поясе КЛИЕНТА, а не сервера.
const SQL = `
WITH tz AS (
  SELECT COALESCE(NULLIF((SELECT timezone FROM client_profile WHERE bot_id=$1 AND user_id=$2), ''), 'Europe/Moscow') AS z
), d AS (
  SELECT (now() AT TIME ZONE (SELECT z FROM tz))::date AS today,
         (now() AT TIME ZONE (SELECT z FROM tz))::date - ($3::int - 1) AS d_from
)
SELECT
  to_char((SELECT d_from FROM d), 'YYYY-MM-DD') AS period_from,
  to_char((SELECT today FROM d), 'YYYY-MM-DD') AS period_to,
  $3::int AS period_days,

  (SELECT json_build_object(
     'sessions', count(*),
     'days', count(DISTINCT performed_on),
     'by_type', (SELECT json_agg(json_build_object('t', t, 'n', n))
                   FROM (SELECT COALESCE(session_type, 'без типа') AS t, count(*) AS n
                           FROM workout_session
                          WHERE bot_id=$1 AND user_id=$2
                            AND performed_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)
                          GROUP BY 1 ORDER BY 2 DESC) y))
     FROM workout_session
    WHERE bot_id=$1 AND user_id=$2
      AND performed_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)) AS workouts,

  (SELECT json_build_object(
     'kcal_total', COALESCE(sum(k), 0),
     'kcal_per_logged_day', COALESCE(round(avg(k)), 0),
     'logged_days', count(*),
     'protein_avg', COALESCE(round(avg(p)), 0),
     'fat_avg', COALESCE(round(avg(f)), 0),
     'carb_avg', COALESCE(round(avg(c)), 0))
     FROM (SELECT eaten_on, sum(kcal) k, sum(protein_g) p, sum(fat_g) f, sum(carb_g) c
             FROM food_log
            WHERE bot_id=$1 AND user_id=$2
              AND eaten_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)
            GROUP BY eaten_on) t) AS food,

  (SELECT json_build_object(
     'kcal_total', COALESCE(sum(k), 0),
     'kcal_per_active_day', COALESCE(round(avg(k)), 0),
     'active_days', count(*))
     FROM (SELECT ws.performed_on, sum(we.kcal) k
             FROM workout_entry we JOIN workout_session ws ON ws.id = we.session_id
            WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kcal IS NOT NULL
              AND ws.performed_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)
            GROUP BY 1) t) AS burned,

  (SELECT json_build_object(
     'n', count(*),
     'first', (array_agg(value ORDER BY measured_on, id))[1],
     'last', (array_agg(value ORDER BY measured_on DESC, id DESC))[1],
     'first_on', to_char((array_agg(measured_on ORDER BY measured_on, id))[1], 'DD.MM'),
     'last_on', to_char((array_agg(measured_on ORDER BY measured_on DESC, id DESC))[1], 'DD.MM'))
     FROM measurement
    WHERE bot_id=$1 AND user_id=$2 AND metric = 'weight'
      AND measured_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)) AS weight,

  (SELECT json_build_object(
     'avg_per_day', COALESCE(round(avg(value)), 0),
     'days', count(*),
     'total', COALESCE(sum(value), 0))
     FROM measurement
    WHERE bot_id=$1 AND user_id=$2 AND metric = 'steps'
      AND measured_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)) AS steps,

  (SELECT json_agg(x) FROM (
     SELECT metric, max(unit) AS unit, count(*) AS n,
            (array_agg(value ORDER BY measured_on, id))[1] AS first,
            (array_agg(value ORDER BY measured_on DESC, id DESC))[1] AS last
       FROM measurement
      WHERE bot_id=$1 AND user_id=$2
        -- шаги и активность считаем отдельно: это не параметр тела, и в списке
        -- замеров они выглядели как «обхват уменьшился на 7500»
        AND metric NOT IN ('weight','steps','water_ml','sleep_hours','mood','resting_hr')
        AND measured_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)
      GROUP BY metric
     HAVING count(*) >= 2
      ORDER BY count(*) DESC
      LIMIT 12) x) AS metrics,

  (SELECT json_agg(json_build_object('ex', ex, 'v', v, 'u', u, 'on', on_d) ORDER BY srt DESC)
     FROM (SELECT DISTINCT exercise AS ex, value AS v, max(unit) AS u,
                  to_char(achieved_on, 'DD.MM') AS on_d, max(achieved_on) AS srt
             FROM personal_record
            WHERE bot_id=$1 AND user_id=$2
              AND achieved_on BETWEEN (SELECT d_from FROM d) AND (SELECT today FROM d)
            GROUP BY exercise, value, achieved_on
            ORDER BY max(achieved_on) DESC
            LIMIT 10) y) AS records;
`.trim();

const CODE_PARAMS = String.raw`
const d = $input.first().json || {};
let days = Number(d.period_days);
if (!isFinite(days) || days < 1) days = 30;
days = Math.min(Math.max(Math.round(days), 3), 365);
return [{ json: { bot_id: d.bot_id, user_id: d.user_id, period_days: days } }];
`.trim();

// Отдаём агенту готовый ЧИТАЕМЫЙ текст, а не сырой JSON: так дешевле по токенам
// и меньше шансов, что он переврёт числа при пересказе.
const CODE_ANSWER = String.raw`
const r = $input.first().json || {};
const asObj = (v) => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const num = (v, dflt) => { const n = Number(v); return isFinite(n) ? n : dflt; };
const w = asObj(r.workouts) || {};
const f = asObj(r.food) || {};
const b = asObj(r.burned) || {};
const wt = asObj(r.weight) || {};
const ms = asObj(r.metrics) || [];
const pr = asObj(r.records) || [];

const days = num(r.period_days, 30);
const L = [];
L.push('ДАННЫЕ ЗА ПЕРИОД ' + r.period_from + ' — ' + r.period_to + ' (' + days + ' дней). Все числа посчитаны системой из базы — используй их как есть, не пересчитывай.');
L.push('');

// --- тренировки ---
const sess = num(w.sessions, 0);
const wdays = num(w.days, 0);
if (sess > 0) {
  const types = (w.by_type || []).map((t) => t.t + ' — ' + t.n).join(', ');
  const perWeek = Math.round((wdays / days) * 7 * 10) / 10;
  L.push('ТРЕНИРОВКИ: ' + sess + ' занятий в ' + wdays + ' днях, это примерно ' + perWeek + ' раза в неделю.');
  if (types) L.push('  по типам: ' + types);
} else {
  L.push('ТРЕНИРОВКИ: за период не записано ни одной.');
}

// --- питание ---
const fdays = num(f.logged_days, 0);
if (fdays > 0) {
  L.push('ПИТАНИЕ: записано ' + fdays + ' дней из ' + days + '.');
  L.push('  всего ' + num(f.kcal_total, 0) + ' ккал, в среднем ' + num(f.kcal_per_logged_day, 0) + ' ккал в день (по дням с записями)');
  L.push('  средние БЖУ за день: белок ' + num(f.protein_avg, 0) + ' г, жиры ' + num(f.fat_avg, 0) + ' г, углеводы ' + num(f.carb_avg, 0) + ' г');
  if (fdays < days * 0.5) L.push('  ВНИМАНИЕ: дневник заполнен меньше чем наполовину, средние по нему приблизительны — так и скажи клиенту.');
} else {
  L.push('ПИТАНИЕ: за период нет записей в дневнике.');
}

// --- расход ---
const bdays = num(b.active_days, 0);
if (bdays > 0) {
  L.push('РАСХОД НА АКТИВНОСТЯХ: всего ' + num(b.kcal_total, 0) + ' ккал за ' + bdays + ' дней с активностью, в среднем ' + num(b.kcal_per_active_day, 0) + ' ккал в такой день.');
} else {
  L.push('РАСХОД НА АКТИВНОСТЯХ: не посчитан — активности с длительностью в журнале нет.');
}

// --- вес ---
if (num(wt.n, 0) >= 2) {
  const a = num(wt.first, 0), z = num(wt.last, 0);
  const delta = Math.round((z - a) * 10) / 10;
  const word = delta < 0 ? 'минус ' + Math.abs(delta) : (delta > 0 ? 'плюс ' + delta : 'без изменений');
  L.push('ВЕС: ' + a + ' кг (' + wt.first_on + ') -> ' + z + ' кг (' + wt.last_on + '), ' + word + ' кг за период. Взвешиваний: ' + num(wt.n, 0) + '.');
} else if (num(wt.n, 0) === 1) {
  L.push('ВЕС: единственное измерение ' + num(wt.last, 0) + ' кг (' + wt.last_on + ') — динамику показать не по чему.');
} else {
  L.push('ВЕС: за период не измерялся.');
}

// --- шаги ---
const st = asObj(r.steps) || {};
if (num(st.days, 0) > 0) {
  L.push('ШАГИ: в среднем ' + num(st.avg_per_day, 0) + ' в день (записано ' + num(st.days, 0) + ' дней).');
}

// --- замеры ---
if (ms.length) {
  L.push('ЗАМЕРЫ (что клиент реально отслеживал):');
  ms.forEach((m) => {
    const a = num(m.first, null), z = num(m.last, null);
    if (a === null || z === null) return;
    const dlt = Math.round((z - a) * 10) / 10;
    const sign = dlt > 0 ? '+' : '';
    L.push('  ' + m.metric + ': ' + a + ' -> ' + z + (m.unit ? ' ' + m.unit : '') + ' (' + sign + dlt + '), измерений ' + num(m.n, 0));
  });
} else {
  L.push('ЗАМЕРЫ: кроме веса ничего не отслеживалось (или меньше двух измерений на метрику).');
}

// --- рекорды ---
if (pr.length) {
  L.push('ЛИЧНЫЕ РЕКОРДЫ за период: ' + pr.slice(0, 10).map((p) => p.ex + ' ' + p.v + (p.u ? ' ' + p.u : '') + ' (' + p.on + ')').join('; '));
} else {
  L.push('ЛИЧНЫЕ РЕКОРДЫ: за период новых нет.');
}

return [{ json: { response: L.join('\n') } }];
`.trim();

const wf = {
  id: 'PeriodReport01',
  name: 'Инструмент — Отчёт за период',
  active: false,
  nodes: [
    {
      parameters: {
        inputSource: 'workflowInputs',
        workflowInputs: {
          values: [
            { name: 'bot_id', type: 'string' },
            { name: 'user_id', type: 'number' },
            { name: 'period_days', type: 'number' },
          ],
        },
      },
      id: 'pr000000-0000-4000-8000-000000000001',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.2,
      position: [-600, 0],
    },
    {
      parameters: { jsCode: CODE_PARAMS },
      id: 'pr000000-0000-4000-8000-000000000002',
      name: 'Период',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-400, 0],
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: SQL,
        options: { queryReplacement: '={{ [$json.bot_id, $json.user_id, $json.period_days] }}' },
      },
      id: 'pr000000-0000-4000-8000-000000000003',
      name: 'Свод',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-200, 0],
      credentials: PG,
      alwaysOutputData: true,
    },
    {
      parameters: { jsCode: CODE_ANSWER },
      id: 'pr000000-0000-4000-8000-000000000004',
      name: 'Ответ агенту',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [0, 0],
    },
  ],
  connections: {
    'When Executed by Another Workflow': { main: [[{ node: 'Период', type: 'main', index: 0 }]] },
    'Период': { main: [[{ node: 'Свод', type: 'main', index: 0 }]] },
    'Свод': { main: [[{ node: 'Ответ агенту', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001', executionTimeout: 120 },
};

new Function(CODE_PARAMS);
new Function(CODE_ANSWER);
const out = path.join(__dirname, 'PeriodReport01.json');
fs.writeFileSync(out, JSON.stringify([wf], null, 2), 'utf8');
console.log('OK ->', out, '|', wf.nodes.length, 'узлов, SQL', SQL.length, 'символов');
