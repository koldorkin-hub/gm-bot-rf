/**
 * LogWorkoutTool001: расход калорий на активностях + шаги + дата по поясу клиента.
 *
 * Повод (20.08.2026, владелец): «клиент делает кардио, шаги, плавание — бот это помнит,
 * но в базе этого нет, и недельный дефицит считается только по еде».
 *
 * Что делаем:
 *  1. Калории считает КОД, а не агент. Агент только записывает факт активности
 *     (что и сколько), система умножает на MET из справочника activity_met.
 *     Агент не может «забыть посчитать» — считается всегда.
 *  2. Если клиент назвал средний пульс — берём формулу Кейтеля (точнее MET),
 *     она учитывает пол, возраст и вес. Нет пульса — MET по виду активности.
 *  3. Шаги: новое поле steps в записи кардио. Темп 100 шагов/мин, шаг 0.7 м.
 *  4. Силовая работа: калории от длительности СЕССИИ за вычетом кардио-минут,
 *     отдельной строкой-оценкой. Защита от двойного счёта при повторном вызове
 *     в тот же день — проверяем, нет ли уже такой строки в сессии.
 *  5. ★ Дата берётся из пояса КЛИЕНТА (новый вход client_today), а не из серверного UTC.
 *     Прежде тренировка, записанная после полуночи по Москве, уезжала на вчера.
 *
 * Прогон:  node schema/transform-logworkout-kcal.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-logworkout-kcal.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// --- 1. вход client_today ---
const trig = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger') || fail('нет триггера');
const vals = trig.parameters.workflowInputs.values;
if (!vals.some((v) => v.name === 'client_today')) vals.push({ name: 'client_today', type: 'string' });

// --- 2. дата по поясу клиента ---
const prep = byName('Подготовить') || fail('нет узла Подготовить');
prep.parameters.jsCode = [
  'const d = $input.first().json;',
  '// «Сегодня» — по поясу КЛИЕНТА. Серверный UTC после полуночи по Москве даёт вчерашнюю дату.',
  "const ct = String(d.client_today || '').trim();",
  "const today = /^\\d{4}-\\d{2}-\\d{2}$/.test(ct) ? ct : new Date().toISOString().slice(0, 10);",
  "let on = String(d.performed_on || '').trim();",
  "if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(on)) on = today;",
  'if (on > today) on = today;',
  'const num = v => { const n = Number(v); return isFinite(n) ? n : null; };',
  'let entries = [];',
  "try { entries = (typeof d.entries === 'string') ? JSON.parse(d.entries) : (d.entries || []); } catch (e) { entries = []; }",
  'if (!Array.isArray(entries)) entries = [];',
  "return [{ json: { bot_id: d.bot_id, user_id: d.user_id, performed_on: on, session_type: String(d.session_type || '').trim() || null, duration_min: num(d.duration_min), note: String(d.note || '').trim() || null, entries } }];",
].join('\n');

// --- 3. справка для расчёта: вес, пол, возраст, таблица MET ---
if (!byName('Калории: справка')) {
  wf.nodes.push({
    parameters: {
      operation: 'executeQuery',
      query: [
        'SELECT',
        '  (SELECT current_weight_kg FROM client_profile WHERE bot_id=$1 AND user_id=$2) AS weight_kg,',
        '  (SELECT sex FROM client_profile WHERE bot_id=$1 AND user_id=$2) AS sex,',
        "  (SELECT date_part('year', age(birth_date))::int FROM client_profile WHERE bot_id=$1 AND user_id=$2) AS age,",
        "  (SELECT json_agg(json_build_object('p', lower(pattern), 'met', met) ORDER BY priority DESC, length(pattern) DESC)",
        '     FROM activity_met) AS met_table,',
        '  (SELECT count(*) FROM workout_entry',
        "     WHERE session_id = $3 AND activity_name = 'Силовая работа (оценка)') AS has_strength_est;",
      ].join('\n'),
      options: {
        queryReplacement:
          "={{ [ $('Подготовить').first().json.bot_id, $('Подготовить').first().json.user_id, $json.id ] }}",
      },
    },
    id: 'lw-kcal-0000-4000-8000-000000000001',
    name: 'Калории: справка',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [420, 0],
    credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  });
}

// --- 4. сборка строк с калориями ---
const rows = byName('Строки') || fail('нет узла Строки');
rows.parameters.jsCode = [
  "const prep = $('Подготовить').first().json;",
  "// id сессии берём у самой Сессии: между ней и нами теперь стоит узел справки.",
  "const sessionId = $('Сессия').first().json.id;",
  'const ref = $input.first().json || {};',
  'const num = v => { const n = Number(v); return isFinite(n) ? n : null; };',
  '',
  'const weight = Number(ref.weight_kg) || null;',
  'const age = Number(ref.age) || null;',
  "const male = /^m|муж/i.test(String(ref.sex || ''));",
  'const metTable = Array.isArray(ref.met_table) ? ref.met_table : [];',
  '',
  '// Справочник отсортирован: сначала уточняющие шаблоны, потом общие.',
  'const metFor = (name) => {',
  "  const s = String(name || '').toLowerCase();",
  '  for (const r of metTable) { if (r && r.p && s.indexOf(r.p) !== -1) return Number(r.met); }',
  '  return null;',
  '};',
  '',
  '// Пульс точнее MET — если клиент его назвал, считаем по Кейтелю (учитывает пол и возраст).',
  'const kcalFor = (minutes, met, hr) => {',
  '  if (!(minutes > 0)) return null;',
  '  if (hr > 0 && weight > 0 && age > 0) {',
  '    const perMin = male',
  '      ? (-55.0969 + 0.6309 * hr + 0.1988 * weight + 0.2017 * age) / 4.184',
  '      : (-20.4022 + 0.4472 * hr - 0.1263 * weight + 0.0740 * age) / 4.184;',
  '    if (perMin > 0) return Math.round(perMin * minutes);',
  '  }',
  '  if (met > 0 && weight > 0) return Math.round(met * 3.5 * weight / 200 * minutes);',
  '  return null;',
  '};',
  '',
  'const entries = prep.entries || [];',
  "const cols = ['session_id','activity_name','entry_order','kind','set_no','reps','weight_kg','rpe','duration_s','distance_m','pace_s_per_km','hr_avg','kcal'];",
  "const rows = []; const params = []; let p = 1; let order = 0;",
  "function addRow(vals) { const ph = vals.map(() => '$' + (p++)); rows.push('(' + ph.join(',') + ')'); for (const v of vals) params.push(v); }",
  '',
  'let cardioMin = 0, kcalTotal = 0, hasStrength = false;',
  '',
  'for (const e of entries) {',
  '  order++;',
  "  const kind = e.kind === 'cardio' ? 'cardio' : (e.kind === 'strength' ? 'strength' : 'other');",
  '  const act = e.activity || e.activity_name || null;',
  "  if (kind === 'strength' && Array.isArray(e.sets) && e.sets.length) {",
  '    hasStrength = true;',
  '    let sn = 0;',
  "    for (const s of e.sets) { sn++; addRow([sessionId, act, order, 'strength', sn, num(s.reps), num(s.weight_kg != null ? s.weight_kg : s.weight), num(s.rpe), null, null, null, null, null]); }",
  '  } else {',
  '    let dur = num(e.duration_s);',
  '    let dist = num(e.distance_m);',
  '    const steps = num(e.steps);',
  '    if (steps > 0) {',
  '      // Обычный темп ходьбы — около 100 шагов в минуту, длина шага ~0.7 м.',
  '      if (!(dur > 0)) dur = Math.round(steps / 100 * 60);',
  '      if (!(dist > 0)) dist = Math.round(steps * 0.7);',
  '    }',
  '    const minutes = dur > 0 ? dur / 60 : 0;',
  "    const met = metFor(act) || (kind === 'cardio' ? metFor('кардио') : null);",
  '    const k = kcalFor(minutes, met, num(e.hr_avg));',
  '    if (k) kcalTotal += k;',
  "    if (kind === 'cardio') cardioMin += minutes;",
  "    addRow([sessionId, act, order, kind, num(e.set_no), num(e.reps), num(e.weight_kg != null ? e.weight_kg : e.weight), num(e.rpe), dur, dist, num(e.pace_s_per_km), num(e.hr_avg), k]);",
  '  }',
  '}',
  '',
  '// Силовая работа: время сессии минус кардио. Отдельной строкой-оценкой,',
  '// и только если такой строки в сессии ещё нет — иначе повторный вызов за день удвоит счёт.',
  'if (hasStrength && Number(prep.duration_min) > 0 && !Number(ref.has_strength_est)) {',
  '  const strengthMin = Math.max(0, Number(prep.duration_min) - cardioMin);',
  '  if (strengthMin >= 5) {',
  "    const k = kcalFor(strengthMin, metFor('силовая'), null);",
  '    if (k) {',
  '      kcalTotal += k;',
  '      order++;',
  "      addRow([sessionId, 'Силовая работа (оценка)', order, 'other', null, null, null, null, Math.round(strengthMin * 60), null, null, null, k]);",
  '    }',
  '  }',
  '}',
  '',
  "const query = rows.length ? ('INSERT INTO workout_entry (' + cols.join(',') + ') VALUES ' + rows.join(',')) : 'SELECT 1';",
  'return [{ json: { query, params, session_id: sessionId, n_exercises: order, n_rows: rows.length, kcal_total: kcalTotal || null } }];',
].join('\n');

// --- 5. ответ агенту с расходом ---
const ans = byName('Ответ агенту') || fail('нет узла Ответ агенту');
ans.parameters.assignments.assignments[0].value =
  "={{ 'Записал тренировку от ' + $('Подготовить').first().json.performed_on + ': упражнений ' + " +
  "$('Строки').first().json.n_exercises + ', строк-подходов ' + $('Строки').first().json.n_rows + '.' + " +
  "($('Строки').first().json.kcal_total ? ' Расход ≈ ' + $('Строки').first().json.kcal_total + ' ккал — посчитано системой, не пересчитывай.' : '') + " +
  "($('Рекорды').first().json.pr_text || '') }}";

// --- 6. разводка: Сессия -> Калории: справка -> Строки ---
wf.connections['Сессия'] = { main: [[{ node: 'Калории: справка', type: 'main', index: 0 }]] };
wf.connections['Калории: справка'] = { main: [[{ node: 'Строки', type: 'main', index: 0 }]] };

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка фактом ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const t = w.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
if (!t.parameters.workflowInputs.values.some((v) => v.name === 'client_today')) fail('вход client_today не добавлен');
['Подготовить', 'Строки'].forEach((n) => new Function(w.nodes.find((x) => x.name === n).parameters.jsCode));
if (!w.nodes.find((n) => n.name === 'Калории: справка')) fail('узел справки не вставлен');
if (w.connections['Сессия'].main[0][0].node !== 'Калории: справка') fail('справка не встала в цепочку');
if (w.nodes.find((n) => n.name === 'Строки').parameters.jsCode.indexOf('kcal') === -1) fail('калории не считаются');
console.log('OK ->', OUT, '| узлов', w.nodes.length);
