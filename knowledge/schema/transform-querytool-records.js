#!/usr/bin/env node
/*
 * QueryTool00001 (get_progress): добавляет домен 'records' → personal_record.
 * Обслуживает свободный текст «покажи мои рекорды» и кнопку /progress.
 * Правит узлы «Параметры» (whitelist + SQL по personal_record) и «Ответ агенту»
 * (форматирование списка рекордов). Идемпотентно (маркер: наличие 'records' в коде).
 * Запуск: node transform-querytool-records.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/qt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (!byName['Параметры']) throw new Error('нет узла Параметры');
if (!byName['Ответ агенту']) throw new Error('нет узла Ответ агенту');

const paramsCode = `const d = $input.first().json;
let p = Number(d.period_days); if (!isFinite(p) || p <= 0) p = 30; p = Math.round(p);
const domain = ['measurement','workout','food','records'].includes(String(d.domain||'').trim()) ? String(d.domain).trim() : 'measurement';
const metric = String(d.metric||'').trim();
let query, params, error = null;
if (domain === 'measurement') {
  if (!metric) { query = 'SELECT 1'; params = []; error = 'no_metric'; }
  else {
    query = \`SELECT metric, count(*) AS n, (array_agg(value ORDER BY measured_on DESC, id DESC))[1] AS last_value, (array_agg(measured_on ORDER BY measured_on DESC, id DESC))[1] AS last_date, min(value) AS min_v, max(value) AS max_v, round(avg(value),2) AS avg_v, (SELECT json_agg(json_build_object('d',m2.measured_on,'v',m2.value) ORDER BY m2.measured_on) FROM measurement m2 WHERE m2.bot_id=$1 AND m2.user_id=$2 AND m2.metric=$3 AND m2.measured_on >= current_date-(($4)::text||' days')::interval) AS series FROM measurement WHERE bot_id=$1 AND user_id=$2 AND metric=$3 AND measured_on >= current_date-(($4)::text||' days')::interval GROUP BY metric\`;
    params = [d.bot_id, d.user_id, metric, p];
  }
} else if (domain === 'workout') {
  query = \`SELECT (SELECT count(*) FROM workout_session WHERE bot_id=$1 AND user_id=$2 AND performed_on >= current_date-(($3)::text||' days')::interval) AS sessions, (SELECT coalesce(round(sum(reps*weight_kg)),0) FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kind='strength' AND ws.performed_on >= current_date-(($3)::text||' days')::interval) AS strength_volume, (SELECT coalesce(round(sum(distance_m)),0) FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kind='cardio' AND ws.performed_on >= current_date-(($3)::text||' days')::interval) AS cardio_distance_m\`;
  params = [d.bot_id, d.user_id, p];
} else if (domain === 'records') {
  query = \`SELECT COALESCE(json_agg(json_build_object('exercise',exercise,'metric',metric,'value',best_value,'unit',unit,'date',best_date) ORDER BY best_date DESC),'[]'::json) AS records, count(*) AS n FROM (SELECT exercise, metric, unit, max(value) AS best_value, (array_agg(achieved_on ORDER BY value DESC, achieved_on DESC))[1] AS best_date FROM personal_record WHERE bot_id=$1 AND user_id=$2 GROUP BY exercise, metric, unit) t\`;
  params = [d.bot_id, d.user_id];
} else {
  query = \`SELECT count(*) AS entries, count(distinct eaten_on) AS days, coalesce(round(sum(kcal)),0) AS total_kcal, coalesce(round(sum(protein_g)),0) AS total_protein, coalesce(round(sum(fat_g)),0) AS total_fat, coalesce(round(sum(carb_g)),0) AS total_carb FROM food_log WHERE bot_id=$1 AND user_id=$2 AND eaten_on >= current_date-(($3)::text||' days')::interval\`;
  params = [d.bot_id, d.user_id, p];
}
return [{ json: { query, params, domain, metric, period_days: p, error } }];`;

const respCode = `const a = $input.first().json || {};
const p = $('Параметры').first().json;
const per = p.period_days;
if (p.domain === 'measurement') {
  if (p.error === 'no_metric') return [{ json: { response: 'Уточни, какую метрику показать (вес, талия, % жира и т.п.).' } }];
  if (a.n === undefined || a.n === null || Number(a.n) === 0) return [{ json: { response: 'В базе НЕТ записей по метрике ' + p.metric + ' за ' + per + ' дн. Так и скажи клиенту, не выдумывай.' } }];
  let arr = a.series; if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = null; } }
  let s = 'Метрика ' + a.metric + ' за ' + per + ' дн: последнее ' + a.last_value + ' (' + a.last_date + '), записей ' + a.n + ', мин ' + a.min_v + ', макс ' + a.max_v + ', среднее ' + a.avg_v + '.';
  if (Array.isArray(arr) && arr.length) s += ' Ряд: ' + arr.map(x => x.d + '=' + x.v).join(', ') + '.';
  return [{ json: { response: s } }];
}
if (p.domain === 'workout') {
  const sess = Number(a.sessions || 0);
  if (!sess) return [{ json: { response: 'За ' + per + ' дн тренировок в журнале НЕТ. Так и скажи.' } }];
  const km = Math.round(Number(a.cardio_distance_m || 0) / 10) / 100;
  return [{ json: { response: 'Тренировки за ' + per + ' дн (из базы): сессий ' + sess + ', силовой объём (Σ повторы×вес) ' + a.strength_volume + ' кг, кардио-дистанция ' + km + ' км.' } }];
}
if (p.domain === 'records') {
  let recs = a.records; if (typeof recs === 'string') { try { recs = JSON.parse(recs); } catch (e) { recs = []; } }
  recs = Array.isArray(recs) ? recs : [];
  if (!recs.length) return [{ json: { response: 'Личных рекордов в базе пока НЕТ. Так и скажи клиенту — рекорды появятся, когда он запишет силовые тренировки (бот фиксирует рекорд, когда расчётный 1ПМ по упражнению превышает прежний максимум).' } }];
  const label = m => m === 'est_1rm' ? 'расч. 1ПМ' : m;
  const line = recs.map(r => r.exercise + ' — ' + r.value + (r.unit ? ' ' + r.unit : '') + ' (' + label(r.metric) + ', ' + r.date + ')').join('; ');
  return [{ json: { response: 'Личные рекорды клиента (из базы, лучшие по каждому упражнению): ' + line + '. Отвечай строго по этим данным, не выдумывай. Поздравь с достижениями и при желании отметь, над чем ещё можно поработать.' } }];
}
const days = Number(a.days || 0);
if (!days) return [{ json: { response: 'За ' + per + ' дн записей о еде НЕТ. Так и скажи.' } }];
const avg = Math.round(Number(a.total_kcal || 0) / days);
return [{ json: { response: 'Еда за ' + per + ' дн (из базы): дней с записями ' + days + ', записей ' + a.entries + '. Всего ' + a.total_kcal + ' ккал, в среднем ' + avg + ' ккал/день. БЖУ суммарно: белок ' + a.total_protein + 'г, жиры ' + a.total_fat + 'г, углеводы ' + a.total_carb + 'г.' } }];`;

byName['Параметры'].parameters.jsCode = paramsCode;
byName['Ответ агенту'].parameters.jsCode = respCode;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: QueryTool00001 — добавлен домен records (personal_record), формат ответа рекордов');
