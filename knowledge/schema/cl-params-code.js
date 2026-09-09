const d = $input.first().json;
const bot = d.bot_id, uid = d.user_id;
const action = String(d.action || '').trim();
const isD = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
const date = isD(d.date) ? String(d.date).trim() : '';
const id = Number(d.id);
let fields = {};
try { fields = (typeof d.fields === 'string') ? JSON.parse(d.fields) : (d.fields || {}); } catch (e) { fields = {}; }
if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) fields = {};
// Белые списки правимых полей по таблицам (только данные записи, НЕ ключи клиента)
const WL = {
  food: { description: 'text', kcal: 'num', protein_g: 'num', fat_g: 'num', carb_g: 'num', meal_type: 'text', eaten_on: 'date' },
  workout: { activity_name: 'text', reps: 'int', weight_kg: 'num', distance_m: 'num', duration_s: 'int', set_no: 'int' },
  measurement: { metric: 'text', value: 'num', unit: 'text', measured_on: 'date', note: 'text' }
};
function buildSet(wl, startIdx) {
  const sets = [], params = [];
  let i = startIdx;
  for (const [k, t] of Object.entries(wl)) {
    if (fields[k] === undefined) continue;
    let v = fields[k];
    if (v === null || String(v).trim() === '') continue;
    if (t === 'num' || t === 'int') { v = Number(v); if (!isFinite(v)) continue; }
    if (t === 'date' && !isD(v)) continue;
    sets.push(k + ' = $' + i); params.push(t === 'int' ? Math.round(v) : v); i++;
  }
  return { sets, params };
}
let query = 'SELECT 1', params = [], error = null;
if (action === 'list_food') {
  if (!date) error = 'need_date';
  else { query = `SELECT id, meal_type, left(description,90) AS description, round(kcal) AS kcal, round(protein_g) AS p, round(fat_g) AS f, round(carb_g) AS c FROM food_log WHERE bot_id=$1 AND user_id=$2 AND eaten_on=$3::date ORDER BY id`; params = [bot, uid, date]; }
} else if (action === 'list_workout') {
  if (!date) error = 'need_date';
  else { query = `SELECT ws.id AS session_id, ws.session_type, we.id AS entry_id, we.kind, we.activity_name, we.set_no, we.reps, we.weight_kg, we.distance_m, we.duration_s FROM workout_session ws LEFT JOIN workout_entry we ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND ws.performed_on=$3::date ORDER BY we.entry_order, we.id`; params = [bot, uid, date]; }
} else if (action === 'list_measurement') {
  if (!date) error = 'need_date';
  else { query = `SELECT id, metric, value, unit, measured_on FROM measurement WHERE bot_id=$1 AND user_id=$2 AND measured_on=$3::date ORDER BY id`; params = [bot, uid, date]; }
} else if (action === 'update_food') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { const b = buildSet(WL.food, 4); if (!b.sets.length) error = 'no_fields';
    else { query = `UPDATE food_log SET ${b.sets.join(', ')} WHERE id=$3 AND bot_id=$1 AND user_id=$2 RETURNING id, eaten_on, meal_type, left(description,90) AS description, round(kcal) AS kcal, round(protein_g) AS p, round(fat_g) AS f, round(carb_g) AS c`; params = [bot, uid, Math.round(id), ...b.params]; } }
} else if (action === 'delete_food') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { query = `DELETE FROM food_log WHERE id=$3 AND bot_id=$1 AND user_id=$2 RETURNING id, eaten_on, left(description,90) AS description, round(kcal) AS kcal`; params = [bot, uid, Math.round(id)]; }
} else if (action === 'update_workout') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { const b = buildSet(WL.workout, 4); if (!b.sets.length) error = 'no_fields';
    else { query = `UPDATE workout_entry we SET ${b.sets.join(', ')} FROM workout_session ws WHERE we.id=$3 AND we.session_id=ws.id AND ws.bot_id=$1 AND ws.user_id=$2 RETURNING we.id, ws.performed_on, we.kind, we.activity_name, we.reps, we.weight_kg, we.distance_m, we.duration_s`; params = [bot, uid, Math.round(id), ...b.params]; } }
} else if (action === 'delete_workout') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { query = `DELETE FROM workout_entry we USING workout_session ws WHERE we.id=$3 AND we.session_id=ws.id AND ws.bot_id=$1 AND ws.user_id=$2 RETURNING we.id, ws.performed_on, we.activity_name, we.reps, we.weight_kg`; params = [bot, uid, Math.round(id)]; }
} else if (action === 'delete_workout_session') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { query = `DELETE FROM workout_session WHERE id=$3 AND bot_id=$1 AND user_id=$2 RETURNING id, performed_on, session_type`; params = [bot, uid, Math.round(id)]; }
} else if (action === 'update_measurement') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { const b = buildSet(WL.measurement, 4); if (!b.sets.length) error = 'no_fields';
    else { query = `UPDATE measurement SET ${b.sets.join(', ')} WHERE id=$3 AND bot_id=$1 AND user_id=$2 RETURNING id, metric, value, unit, measured_on`; params = [bot, uid, Math.round(id), ...b.params]; } }
} else if (action === 'delete_measurement') {
  if (!isFinite(id) || id <= 0) error = 'need_id';
  else { query = `DELETE FROM measurement WHERE id=$3 AND bot_id=$1 AND user_id=$2 RETURNING id, metric, value, measured_on`; params = [bot, uid, Math.round(id)]; }
} else { error = 'bad_action'; }
if (error) { query = 'SELECT 1'; params = []; }
return [{ json: { query, params, action, date, id: isFinite(id) ? id : null, error } }];
