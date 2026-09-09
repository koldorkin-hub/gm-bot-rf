const d = $input.first().json;
let p = Number(d.period_days); if (!isFinite(p) || p <= 0) p = 30; p = Math.round(p); if (p > 92) p = 92;
const domain = ['measurement','workout','food','records'].includes(String(d.domain||'').trim()) ? String(d.domain).trim() : 'measurement';
const metric = String(d.metric||'').trim();
const isD = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'').trim());
const one = isD(d.date) ? String(d.date).trim() : null;
let from = one || (isD(d.date_from) ? String(d.date_from).trim() : '');
let to = one || (isD(d.date_to) ? String(d.date_to).trim() : '');
if (from && to && from > to) { const t = from; from = to; to = t; }
if (from && !to) to = from;
if (to && !from) from = to;
let query, params, error = null;
if (domain === 'measurement') {
  if (!metric) { query = 'SELECT 1'; params = []; error = 'no_metric'; }
  else {
    query = `SELECT metric, count(*) AS n, (array_agg(value ORDER BY measured_on DESC, id DESC))[1] AS last_value, (array_agg(measured_on ORDER BY measured_on DESC, id DESC))[1] AS last_date, min(value) AS min_v, max(value) AS max_v, round(avg(value),2) AS avg_v, (SELECT json_agg(json_build_object('d',m2.measured_on,'v',m2.value) ORDER BY m2.measured_on) FROM measurement m2 WHERE m2.bot_id=$1 AND m2.user_id=$2 AND m2.metric=$3 AND m2.measured_on >= current_date-(($4)::text||' days')::interval) AS series FROM measurement WHERE bot_id=$1 AND user_id=$2 AND metric=$3 AND measured_on >= current_date-(($4)::text||' days')::interval GROUP BY metric`;
    params = [d.bot_id, d.user_id, metric, p];
  }
} else if (domain === 'records') {
  query = `SELECT COALESCE(json_agg(json_build_object('exercise',exercise,'metric',metric,'value',best_value,'unit',unit,'date',best_date) ORDER BY best_date DESC),'[]'::json) AS records, count(*) AS n FROM (SELECT exercise, metric, unit, max(value) AS best_value, (array_agg(achieved_on ORDER BY value DESC, achieved_on DESC))[1] AS best_date FROM personal_record WHERE bot_id=$1 AND user_id=$2 GROUP BY exercise, metric, unit) t`;
  params = [d.bot_id, d.user_id];
} else if (domain === 'workout') {
  query = `WITH b0 AS (SELECT COALESCE(NULLIF($3,'')::date, current_date - $5::int) AS fd0, COALESCE(NULLIF($4,'')::date, current_date) AS td), b AS (SELECT GREATEST(fd0, td - 92) AS fd, td FROM b0) SELECT (SELECT fd::text FROM b) AS from_d, (SELECT td::text FROM b) AS to_d, (SELECT COALESCE(json_agg(sess ORDER BY sess->>'d'),'[]'::json) FROM (SELECT json_build_object('d', ws.performed_on, 'dow', extract(isodow from ws.performed_on)::int, 'type', ws.session_type, 'dur', ws.duration_min, 'entries', (SELECT COALESCE(json_agg(json_build_object('k',we.kind,'ex',we.activity_name,'reps',we.reps,'w',we.weight_kg,'dist',we.distance_m,'sec',we.duration_s) ORDER BY we.entry_order, we.id),'[]'::json) FROM workout_entry we WHERE we.session_id=ws.id)) AS sess FROM workout_session ws, b WHERE ws.bot_id=$1 AND ws.user_id=$2 AND ws.performed_on BETWEEN b.fd AND b.td) t) AS sessions`;
  params = [d.bot_id, d.user_id, from, to, p];
} else {
  query = `WITH b0 AS (SELECT COALESCE(NULLIF($3,'')::date, current_date - $5::int) AS fd0, COALESCE(NULLIF($4,'')::date, current_date) AS td), b AS (SELECT GREATEST(fd0, td - 92) AS fd, td FROM b0) SELECT (SELECT fd::text FROM b) AS from_d, (SELECT td::text FROM b) AS to_d, (SELECT COALESCE(json_agg(day ORDER BY day->>'d'),'[]'::json) FROM (SELECT json_build_object('d', eaten_on, 'dow', extract(isodow from eaten_on)::int, 'n', count(*), 'kcal', round(sum(kcal)), 'p', round(sum(protein_g)), 'f', round(sum(fat_g)), 'c', round(sum(carb_g)), 'items', json_agg(json_build_object('m', meal_type, 't', left(description,90), 'k', round(kcal)) ORDER BY id)) AS day FROM food_log, b WHERE bot_id=$1 AND user_id=$2 AND eaten_on BETWEEN b.fd AND b.td GROUP BY eaten_on) t) AS days`;
  params = [d.bot_id, d.user_id, from, to, p];
}
return [{ json: { query, params, domain, metric, period_days: p, error, req_date: one || '' } }];
