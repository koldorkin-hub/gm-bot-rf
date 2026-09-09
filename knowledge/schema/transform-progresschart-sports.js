#!/usr/bin/env node
/*
 * ProgressChart01 (get_progress_chart): расширяет метрики под виды спорта.
 * Было: только measurement (вес/талия/%жира/бёдра). Стало: узел «Метрика» строит
 * SQL (query+params) по типу метрики — measurement | силовой объём (volume) |
 * 1ПМ упражнения (1rm:<name>) | кардио-дистанция по неделям (cardio) | темп (pace);
 * узел «Данные» переведён на generic {{ $json.query }} / {{ $json.params }}.
 * HTML/PNG/Фото не трогаем (читают points + label/unit из «Метрика»).
 * Идемпотентно (перезапись jsCode/query). Запуск: node transform-progresschart-sports.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/pc-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (!byName['Метрика']) throw new Error('нет узла Метрика');
if (!byName['Данные']) throw new Error('нет узла Данные');

const metricCode = `const raw = String($json.metric || 'weight').toLowerCase().trim();
const bot_id = $json.bot_id, user_id = Number($json.user_id), chat_id = String($json.chat_id), bot_token = $json.bot_token;
const D180 = "ws.performed_on >= (now()-interval '180 days')::date";
let query, params, label, unit;
const m1 = raw.match(/^(?:1rm|strength|1пм|силов\\w*)\\s*[:\\s]\\s*(.+)$/);
if (m1) {
  const ex = m1[1].trim();
  query = "SELECT COALESCE(json_agg(json_build_object('d',to_char(d,'YYYY-MM-DD'),'v',round(best,1)) ORDER BY d),'[]'::json) AS points, count(*) AS n FROM (SELECT ws.performed_on AS d, max(we.weight_kg*(1+we.reps/30.0)) AS best FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kind='strength' AND lower(we.activity_name) LIKE lower($3) AND we.weight_kg IS NOT NULL AND we.reps>0 AND " + D180 + " GROUP BY ws.performed_on) t";
  params = [bot_id, user_id, '%' + ex + '%'];
  label = 'расч. 1ПМ: ' + ex; unit = 'кг';
} else if (/(объ[её]м|volume|тоннаж|tonnage)/.test(raw)) {
  query = "SELECT COALESCE(json_agg(json_build_object('d',to_char(wk,'YYYY-MM-DD'),'v',vol) ORDER BY wk),'[]'::json) AS points, count(*) AS n FROM (SELECT date_trunc('week', ws.performed_on)::date AS wk, round(sum(we.reps*we.weight_kg)) AS vol FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kind='strength' AND we.reps IS NOT NULL AND we.weight_kg IS NOT NULL AND " + D180 + " GROUP BY 1) t";
  params = [bot_id, user_id];
  label = 'силовой объём (нед)'; unit = 'кг';
} else if (/(темп|pace)/.test(raw)) {
  query = "SELECT COALESCE(json_agg(json_build_object('d',to_char(d,'YYYY-MM-DD'),'v',pace) ORDER BY d),'[]'::json) AS points, count(*) AS n FROM (SELECT ws.performed_on AS d, round((avg(we.pace_s_per_km)/60.0)::numeric,2) AS pace FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kind='cardio' AND we.pace_s_per_km IS NOT NULL AND " + D180 + " GROUP BY ws.performed_on) t";
  params = [bot_id, user_id];
  label = 'темп бега'; unit = 'мин/км';
} else if (/(кардио|cardio|дистанц|distance|пробег|бег|\\bkm\\b|\\brun\\b|километр)/.test(raw)) {
  query = "SELECT COALESCE(json_agg(json_build_object('d',to_char(wk,'YYYY-MM-DD'),'v',km) ORDER BY wk),'[]'::json) AS points, count(*) AS n FROM (SELECT date_trunc('week', ws.performed_on)::date AS wk, round(sum(we.distance_m)/1000.0,2) AS km FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND we.kind='cardio' AND we.distance_m IS NOT NULL AND " + D180 + " GROUP BY 1) t";
  params = [bot_id, user_id];
  label = 'кардио, км/нед'; unit = 'км';
} else {
  let variants, mlabel, munit;
  if (/вес|weight|масс/.test(raw)) { variants = ['вес','weight']; mlabel = 'веса'; munit = 'кг'; }
  else if (/тали|waist/.test(raw)) { variants = ['талия','waist']; mlabel = 'талии'; munit = 'см'; }
  else if (/жир|fat/.test(raw)) { variants = ['body_fat_pct','% жира','жир','bodyfat','body_fat']; mlabel = '% жира'; munit = '%'; }
  else if (/бедр|hip/.test(raw)) { variants = ['бедра','hip','hips']; mlabel = 'бёдер'; munit = 'см'; }
  else { variants = [raw]; mlabel = raw; munit = ''; }
  query = "SELECT COALESCE(json_agg(json_build_object('d', to_char(measured_on,'YYYY-MM-DD'), 'v', value) ORDER BY measured_on), '[]'::json) AS points, count(*) AS n FROM measurement WHERE bot_id=$1 AND user_id=$2 AND metric = ANY($3::text[]) AND measured_on >= (now()-interval '180 days')::date";
  params = [bot_id, user_id, variants];
  label = mlabel; unit = munit;
}
return [{ json: { query, params, label, unit, bot_id, user_id, chat_id, bot_token } }];`;

byName['Метрика'].parameters.jsCode = metricCode;
byName['Данные'].parameters.query = '={{ $json.query }}';
byName['Данные'].parameters.options = byName['Данные'].parameters.options || {};
byName['Данные'].parameters.options.queryReplacement = '={{ $json.params }}';

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: ProgressChart01 — метрики volume/1rm/cardio/pace + measurement, Данные на generic query');
