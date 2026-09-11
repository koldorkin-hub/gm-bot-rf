/**
 * LogWorkoutTool001: кардио и шаги — отдельной кардио-тренировкой, не внутри силовой.
 *
 * Повод (владелец, 11.09.2026): «Эллипс и велотренажёр я делаю отдельно от силовой… Зачем он их
 * смешал с тренировкой? Пусть хранится отдельно». Узел «Сессия» с 31.07 переиспользовал ЛЮБУЮ
 * сессию за дату (защита от дробления тренировки на много сессий). Побочный эффект: кардио,
 * записанное после силовой, дописывалось в неё же, и дальше бот и сборка программы принимали
 * эллипс за упражнение силового дня.
 *
 * Что меняется:
 *  1. «Подготовить» решает КОДОМ, что кардио: kind='cardio', шаги, или название из списка
 *     (эллипс, велотренажёр, дорожка, ходьба, бег…) без силовых подходов. Модель может ошибиться
 *     с kind — код поправит. «Велосипед 3×20» (упражнение на пресс) с подходами остаётся силовым.
 *  2. «Сессия» ищет-или-создаёт ДВЕ сессии за дату: не-кардио для силовых строк и кардио для кардио.
 *     Дробления по-прежнему нет: повторные вызовы за день дописывают в сессию своего вида.
 *  3. «Строки» кладут каждую строку в сессию её вида; оценка силовой работы — в силовую.
 *
 * Прогон:  node transform-logworkout-cardio-split.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-logworkout-cardio-split.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const node = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const once = (s, from, what) => { const k = s.split(from).length - 1; if (k !== 1) fail(what + ': якорь встречается ' + k + ' раз'); };
const swap = (s, from, to, what) => { once(s, from, what); return s.replace(from, () => to); };
const MARK = '// >>> кардио отдельно';

// ---------- 1) Подготовить ----------
const prep = node('Подготовить');
const PREP_BLOCK = String.raw`
// >>> кардио отдельно
// Что считать кардио, решает код: модель иногда присылает эллипс как kind='strength'.
// Силовое с подходами (например «Велосипед 3×20» на пресс) остаётся силовым.
const CARDIO_ANY = /(эллипс|велотренаж|беговая дорожк|беговой дорожк|гребн[а-яё]* тренаж|степпер|кардио)/i;
const CARDIO_FULL = /^(ходьба|быстрая ходьба|интенсивная ходьба|скандинавская ходьба|шаги|бег|гребля|плавание|сайкл|велосипед на улице)$/i;
const isCardio = (e) => {
  if (!e || typeof e !== 'object') return false;
  const hasSets = Array.isArray(e.sets) && e.sets.length > 0;
  if (e.kind === 'strength' && hasSets) return false;
  if (e.kind === 'cardio') return true;
  if (Number(e.steps) > 0) return true;
  const nm = String(e.activity || e.activity_name || '').trim().replace(/\s*\([^)]*\)\s*$/, '');
  return !hasSets && (CARDIO_ANY.test(nm) || CARDIO_FULL.test(nm));
};
entries = entries.map((e) => (isCardio(e) ? Object.assign({}, e, { kind: 'cardio' }) : e));
const _st = String(d.session_type || '').trim() || null;
const hasCardio = entries.some((e) => e && e.kind === 'cardio') || (!entries.length && _st === 'cardio');
const hasMain = entries.some((e) => e && e.kind !== 'cardio') || (!entries.length && _st !== 'cardio');
const mainType = (_st && _st !== 'cardio') ? _st : (entries.some((e) => e && e.kind === 'strength') ? 'strength' : 'other');
let cardioSec = 0;
for (const e of entries) {
  if (!e || e.kind !== 'cardio') continue;
  let s = Number(e.duration_s);
  if (!(s > 0) && Number(e.steps) > 0) s = Math.round(Number(e.steps) / 100 * 60);
  if (s > 0) cardioSec += s;
}
const _dm = num(d.duration_min);
const cardioMin = hasMain ? (cardioSec > 0 ? Math.round(cardioSec / 60) : null) : (_dm != null ? Math.round(_dm) : (cardioSec > 0 ? Math.round(cardioSec / 60) : null));
// <<< кардио отдельно`;
const OLD_RET = "return [{ json: { bot_id: d.bot_id, user_id: d.user_id, performed_on: on, session_type: String(d.session_type || '').trim() || null, duration_min: num(d.duration_min), note: String(d.note || '').trim() || null, entries } }];";
const NEW_RET = "return [{ json: { bot_id: d.bot_id, user_id: d.user_id, performed_on: on, session_type: _st, main_type: mainType, has_main: hasMain, has_cardio: hasCardio, duration_min: hasMain ? _dm : null, note: hasMain ? (String(d.note || '').trim() || null) : null, cardio_min: cardioMin, cardio_note: hasMain ? null : (String(d.note || '').trim() || null), entries } }];";
if (!prep.parameters.jsCode.includes(MARK)) {
  let c = prep.parameters.jsCode;
  c = swap(c, 'if (!Array.isArray(entries)) entries = [];', 'if (!Array.isArray(entries)) entries = [];\n' + PREP_BLOCK.trim(), 'Подготовить/вставка');
  c = swap(c, OLD_RET, NEW_RET, 'Подготовить/возврат');
  prep.parameters.jsCode = c;
}

// ---------- 2) Сессия ----------
const sess = node('Сессия');
const SESS_Q = "WITH m_ex AS (SELECT id FROM workout_session WHERE bot_id=$1 AND user_id=$2 AND performed_on=$3::date AND session_type IS DISTINCT FROM 'cardio' ORDER BY id DESC LIMIT 1), " +
  "m_ins AS (INSERT INTO workout_session (bot_id,user_id,performed_on,session_type,duration_min,note,source) SELECT $1,$2,$3::date,$4,$5,$6,'client' WHERE $7::boolean AND NOT EXISTS (SELECT 1 FROM m_ex) RETURNING id), " +
  "c_ex AS (SELECT id FROM workout_session WHERE bot_id=$1 AND user_id=$2 AND performed_on=$3::date AND session_type='cardio' ORDER BY id DESC LIMIT 1), " +
  "c_upd AS (UPDATE workout_session SET duration_min = COALESCE(duration_min,0) + $9::int WHERE id IN (SELECT id FROM c_ex) AND $8::boolean AND COALESCE($9::int,0) > 0 RETURNING id), " +
  "c_ins AS (INSERT INTO workout_session (bot_id,user_id,performed_on,session_type,duration_min,note,source) SELECT $1,$2,$3::date,'cardio',$9::int,$10,'client' WHERE $8::boolean AND NOT EXISTS (SELECT 1 FROM c_ex) RETURNING id), " +
  "ids AS (SELECT CASE WHEN $7::boolean THEN COALESCE((SELECT id FROM m_ex),(SELECT id FROM m_ins)) END AS main_id, CASE WHEN $8::boolean THEN COALESCE((SELECT id FROM c_ex),(SELECT id FROM c_ins)) END AS cardio_id) " +
  "SELECT main_id, cardio_id, COALESCE(main_id, cardio_id) AS id FROM ids;";
const SESS_R = '={{ [$json.bot_id, $json.user_id, $json.performed_on, $json.main_type, $json.duration_min, $json.note, $json.has_main, $json.has_cardio, $json.cardio_min, $json.cardio_note] }}';
if (!sess.parameters.query.includes('c_ex AS')) {
  if (!sess.parameters.query.includes('existing AS')) fail('Сессия: запрос не той версии');
  sess.parameters.query = SESS_Q;
  sess.parameters.options.queryReplacement = SESS_R;
}

// ---------- 3) Строки ----------
const rowsN = node('Строки');
if (!rowsN.parameters.jsCode.includes('cardioSessionId')) {
  let c = rowsN.parameters.jsCode;
  c = swap(c, "const sessionId = $('Сессия').first().json.id;",
    "const _S = $('Сессия').first().json;\n// Силовые строки — в силовую сессию дня, кардио — в кардио-сессию дня (см. «Подготовить»).\nconst sessionId = (_S.main_id != null ? _S.main_id : _S.id);\nconst cardioSessionId = (_S.cardio_id != null ? _S.cardio_id : sessionId);", 'Строки/id');
  c = swap(c, 'addRow([sessionId, act, order, kind, num(e.set_no)', "addRow([kind === 'cardio' ? cardioSessionId : sessionId, act, order, kind, num(e.set_no)", 'Строки/кардио-строка');
  rowsN.parameters.jsCode = c;
}

// ---------- 4) Ответ агенту ----------
const ans = node('Ответ агенту');
const av = ans.parameters.assignments.assignments.find((a) => a.name === 'response') || fail('нет поля response');
if (!av.value.includes('отдельной кардио-тренировкой')) {
  av.value = swap(av.value, "+ ($('Рекорды').first().json.pr_text || '') }}",
    "+ (($('Сессия').first().json.main_id && $('Сессия').first().json.cardio_id) ? ' Кардио записано отдельной кардио-тренировкой, силовая — отдельно.' : '') + ($('Рекорды').first().json.pr_text || '') }}", 'Ответ агенту');
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf), 'utf8');

// ================= проверка фактом =================
let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };
const runPrep = (d) => new Function('$input', prep.parameters.jsCode)({ first: () => ({ json: d }) })[0].json;
const base = { bot_id: 'users', user_id: 999608, client_today: '2026-09-11', performed_on: '2026-09-11' };

let p = runPrep({ ...base, session_type: 'strength', duration_min: 90, entries: JSON.stringify([
  { activity: 'Жим Арнольда', kind: 'strength', sets: [{ reps: 10, weight_kg: 16 }] },
  { activity: 'Эллипс', kind: 'strength', duration_s: 3600 },
  { activity: 'Велосипед', kind: 'strength', sets: [{ reps: 20 }] },
  { activity: 'Шаги', steps: 6000 },
  { activity: 'Велотренажёр (Technogym)', duration_s: 1800 },
]) });
const k = Object.fromEntries(p.entries.map((e) => [e.activity, e.kind]));
check('эллипс, присланный как силовое, стал кардио', k['Эллипс'] === 'cardio');
check('велотренажёр без kind стал кардио', k['Велотренажёр (Technogym)'] === 'cardio');
check('шаги — кардио', k['Шаги'] === 'cardio');
check('«Велосипед» с подходами (пресс) остался силовым', k['Велосипед'] === 'strength');
check('смешанный вызов: нужны обе сессии', p.has_main === true && p.has_cardio === true && p.main_type === 'strength');
check('кардио-минуты посчитаны (60+60 шаги+30)', p.cardio_min === 150);
check('длительность и заметка — силовой сессии', p.duration_min === 90 && p.cardio_note === null);

p = runPrep({ ...base, session_type: 'cardio', duration_min: 90, note: 'эллипс+вело', entries: [{ activity: 'Эллипс', kind: 'cardio', duration_s: 3600 }, { activity: 'Велотренажёр', kind: 'cardio', duration_s: 1800 }] });
check('только кардио: силовая сессия не создаётся', p.has_main === false && p.has_cardio === true);
check('только кардио: длительность и заметка уходят в кардио-сессию', p.cardio_min === 90 && p.cardio_note === 'эллипс+вело' && p.duration_min === null);
check('только кардио: тип основной сессии никогда не cardio', p.main_type !== 'cardio');

p = runPrep({ ...base, session_type: 'cardio', duration_min: 40, entries: '[]' });
check('пустые строки + тип cardio → только кардио-сессия', p.has_main === false && p.has_cardio === true && p.cardio_min === 40);
p = runPrep({ ...base, session_type: 'strength', entries: [{ activity: 'Планка на локтях', kind: 'strength', sets: [{ duration_s: 60 }] }] });
check('изометрия не принята за кардио', p.has_cardio === false && p.has_main === true);

// «Строки»: какая строка в какую сессию
const rowsCode = rowsN.parameters.jsCode;
const runRows = (prepJson, sessJson, ref) => new Function('$', '$input', rowsCode)(
  (n) => ({ first: () => ({ json: n === 'Подготовить' ? prepJson : sessJson }) }),
  { first: () => ({ json: ref }) })[0].json;
p = runPrep({ ...base, session_type: 'strength', duration_min: 90, entries: [
  { activity: 'Жим Арнольда', kind: 'strength', sets: [{ reps: 10, weight_kg: 16 }, { reps: 8, weight_kg: 16 }] },
  { activity: 'Эллипс', duration_s: 3600 },
] });
const R = runRows(p, { main_id: 501, cardio_id: 502, id: 501 }, { weight_kg: 97, age: 45, sex: 'male', met_table: [{ p: 'эллипс', met: 5 }, { p: 'силовая', met: 3.5 }], has_strength_est: 0 });
const perRow = []; for (let i = 0; i < R.params.length; i += 13) perRow.push({ sid: R.params[i], act: R.params[i + 1], kind: R.params[i + 3] });
check('подходы силового — в силовую сессию', perRow.filter((x) => x.act === 'Жим Арнольда').every((x) => x.sid === 501) && perRow.filter((x) => x.act === 'Жим Арнольда').length === 2);
check('эллипс — в кардио-сессию', perRow.some((x) => x.act === 'Эллипс' && x.sid === 502 && x.kind === 'cardio'));
check('оценка силовой работы — в силовую сессию', perRow.some((x) => x.act === 'Силовая работа (оценка)' && x.sid === 501));
const R2 = runRows(runPrep({ ...base, session_type: 'cardio', entries: [{ activity: 'Эллипс', kind: 'cardio', duration_s: 3600 }] }), { main_id: null, cardio_id: 777, id: 777 }, {});
check('только кардио: строка в кардио-сессию', R2.params[0] === 777);

// запрос и связи
const s2 = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w2 = Array.isArray(s2) ? s2[0] : s2;
const q = w2.nodes.find((n) => n.name === 'Сессия').parameters;
check('Сессия: 10 параметров в запросе и в подстановке', (q.query.match(/\$10/g) || []).length === 1 && q.options.queryReplacement.split(',').length === 10);
check('Сессия: кардио ищется только среди кардио-сессий, силовая — среди не-кардио', /session_type IS DISTINCT FROM 'cardio'/.test(q.query) && /session_type='cardio'/.test(q.query));
check('связи workflow не тронуты', JSON.stringify(w2.connections) === JSON.stringify(wf.connections));
['Подготовить', 'Строки'].forEach((n) => { try { new Function('$', '$input', w2.nodes.find((x) => x.name === n).parameters.jsCode); check(n + ' компилируется', true); } catch (e) { check(n + ' компилируется: ' + e.message, false); } });

if (bad.length) fail('провалено ' + bad.length + ' из ' + total + ' проверок');
console.log('OK ->', OUT, '| проверок пройдено:', total);
