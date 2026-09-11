/**
 * Инструмент напоминаний (ReminderTool01): автопропуск и предупреждение о дублях.
 *
 * 1. Новое поле done_when — чем напоминание закрывается само, если клиент сделал дело
 *    заранее: замер за тот же день, приём пищи, тренировка ТОГО ЖЕ вида. Закрытый список:
 *    всё, что в него не входит, превращается в 'none', и напоминание приходит как обычно.
 * 2. Лекарства и уколы не закрываются никогда — решение владельца от 11.09.2026:
 *    пропущенный укол хуже любого лишнего напоминания. Проверка по словам здесь работает
 *    только в безопасную сторону: ложное совпадение лишь оставляет 'none'.
 *    Границы слов — через (?![а-яё]), а не \b: \b в JS кириллицы не знает.
 * 3. При создании инструмент возвращает соседние напоминания (±30 минут). Поймано
 *    11.09.2026: бот пересоздавал весь график уколов при каждой правке курса и не отменял
 *    старый — владелец получал по пять одинаковых напоминаний в одно утро. Создание
 *    при этом НЕ блокируется: отказ поставить напоминание об уколе хуже дубля.
 *
 * В конце скрипта код узлов гоняется на подставных данных.
 * Прогон:  node transform-remindertool-donewhen.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-remindertool-donewhen.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);

const PARAMS_CODE = String.raw`const d = $input.first().json;
const action = String(d.action || 'create').trim().toLowerCase();
const bot = d.bot_id, uid = Number(d.user_id), chat = Number(d.chat_id) || null;
const tz = String(d.tz || '').trim() || 'Europe/Moscow';
const text = String(d.text || '').trim();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
const isTime = (s) => /^\d{1,2}:\d{2}$/.test(String(s || '').trim());
const pad = (s) => { const p = String(s).split(':'); return String(p[0]).padStart(2, '0') + ':' + p[1]; };

// Чем напоминание закрывается само, если клиент сделал дело заранее. Закрытый список:
// всё прочее превращается в 'none' — напоминание придёт как обычно.
const DONE_OK = /^(none|measurement:(weight|waist|hip|body_fat_pct)|food:(breakfast|lunch|dinner|snack)|workout:(strength|cardio))$/;
// Лекарства и медицинское не закрываются НИКОГДА: пропущенный укол хуже лишнего
// напоминания. Слова проверяются только в безопасную сторону — ложное совпадение
// лишь означает, что напоминание придёт.
const MED = /(укол|инъекц|препарат|лекарств|таблет|капсул|сустанон|мастерон|тирзепатид|седжаро|оземпик|семаглут|хгч|анастрозол|тадалафил|туринабол|гормон|витамин|добавк|\d\s*(мг|мл|ме)(?![а-яё]))/i;
let doneWhen = String(d.done_when || '').trim().toLowerCase();
if (!DONE_OK.test(doneWhen)) doneWhen = 'none';
const medForced = doneWhen !== 'none' && MED.test(text);
if (medForced) doneWhen = 'none';

let query, params;

if (action === 'list') {
  query = "SELECT id, to_char(fire_at AT TIME ZONE $3, 'DD.MM HH24:MI') AS kogda, text, repeat_rule, done_when" +
          " FROM reminder WHERE bot_id=$1 AND user_id=$2 AND status='pending' ORDER BY fire_at LIMIT 20";
  params = [bot, uid, tz];
  return [{ json: { query, params, action } }];
}

if (action === 'cancel') {
  const id = Number(d.id);
  if (!isFinite(id)) throw new Error('для отмены нужен id напоминания - сначала вызови action=list');
  query = "UPDATE reminder SET status='cancelled' WHERE id=$1 AND bot_id=$2 AND user_id=$3 RETURNING id, text";
  params = [id, bot, uid];
  return [{ json: { query, params, action } }];
}

// создание
if (!text) throw new Error('нужен текст напоминания');
const mins = Number(d.in_minutes);
const rep = ['daily', 'weekly'].includes(String(d.repeat || '').trim()) ? String(d.repeat).trim() : 'none';

// Соседи по времени (±30 минут): бот видит, что на это время уже что-то стоит, и может
// отменить старое, если новое его заменяет. Создание не блокируется.
const near = (tzParam) => "(SELECT coalesce(json_agg(json_build_object('id', r.id, 'kogda', to_char(r.fire_at AT TIME ZONE " + tzParam +
  ", 'DD.MM HH24:MI'), 'text', r.text) ORDER BY r.fire_at), '[]'::json)" +
  " FROM reminder r WHERE r.bot_id = $1 AND r.user_id = $2 AND r.status = 'pending'" +
  " AND r.id <> ins.id AND abs(extract(epoch FROM (r.fire_at - ins.fire_at))) <= 1800) AS near";

if (isFinite(mins) && mins > 0) {
  if (mins > 60 * 24 * 370) throw new Error('слишком далеко - максимум год');
  // Относительное время: считаем от now() базы, часовой пояс тут ни при чём.
  query = "WITH ins AS (INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule,done_when)" +
          " VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval, $5, $6, $8) RETURNING id, fire_at)" +
          " SELECT ins.id, to_char(ins.fire_at AT TIME ZONE $7, 'DD.MM HH24:MI') AS kogda, " + near('$7') + " FROM ins";
  params = [bot, uid, chat, String(Math.round(mins)), text, rep, tz, doneWhen];
  return [{ json: { query, params, action: 'create', done_when: doneWhen, med_forced: medForced } }];
}

const dt = String(d.when_date || '').trim();
const tm = String(d.when_time || '').trim();
if (!isDate(dt) || !isTime(tm)) {
  throw new Error('нужна дата ГГГГ-ММ-ДД и время ЧЧ:ММ (бери дату из справки СЕГОДНЯ) либо in_minutes');
}
// Перевод местного времени клиента в UTC делает Postgres — не JS и не модель.
query = "WITH ins AS (INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule,done_when)" +
        " VALUES ($1,$2,$3, ($4 || ' ' || $5)::timestamp AT TIME ZONE $6, $7, $8, $9) RETURNING id, fire_at)" +
        " SELECT ins.id, to_char(ins.fire_at AT TIME ZONE $6, 'DD.MM HH24:MI') AS kogda, " + near('$6') + " FROM ins";
params = [bot, uid, chat, dt, pad(tm), tz, text, rep, doneWhen];
return [{ json: { query, params, action: 'create', done_when: doneWhen, med_forced: medForced } }];`;

const ANSWER_CODE = String.raw`const P = $('Параметры').first().json;
const act = P.action;
const rows = $input.all().map(i => i.json).filter(r => r && (r.id || r.kogda));
const DW = {
  'measurement:weight': 'взвешивание', 'measurement:waist': 'замер талии', 'measurement:hip': 'замер бёдер',
  'measurement:body_fat_pct': 'замер % жира', 'food:breakfast': 'запись завтрака', 'food:lunch': 'запись обеда',
  'food:dinner': 'запись ужина', 'food:snack': 'запись перекуса',
  'workout:strength': 'силовая тренировка', 'workout:cardio': 'кардио-тренировка'
};

if (act === 'list') {
  if (!rows.length) return [{ json: { response: 'Активных напоминаний нет.' } }];
  const list = rows.map(r => '#' + r.id + ' — ' + r.kogda + ' — ' + r.text +
    (r.repeat_rule && r.repeat_rule !== 'none' ? ' (повтор: ' + (r.repeat_rule === 'daily' ? 'ежедневно' : 'еженедельно') + ')' : '') +
    (r.done_when && r.done_when !== 'none' ? ' [не придёт, если в тот день уже есть: ' + (DW[r.done_when] || r.done_when) + ']' : '')).join('\n');
  return [{ json: { response: 'Активные напоминания:\n' + list } }];
}

if (act === 'cancel') {
  if (!rows.length) return [{ json: { response: 'Такого напоминания нет или оно уже закрыто.' } }];
  return [{ json: { response: 'Отменил напоминание #' + rows[0].id + '.' } }];
}

if (!rows.length) return [{ json: { response: 'Не удалось поставить напоминание.' } }];
const r0 = rows[0];
let resp = 'Напоминание поставлено на ' + r0.kogda + ' (время клиента), номер #' + r0.id +
  '. Оно придёт само, будильник заводить не нужно.';
if (P.done_when && P.done_when !== 'none') {
  resp += ' Если клиент в тот день заранее сделает и запишет: ' + (DW[P.done_when] || P.done_when) +
    ', — напоминание не придёт, это нормально.';
}
if (P.med_forced) resp += ' (Связь с действием не поставлена: напоминания о лекарствах и уколах приходят всегда.)';
let nb = r0.near;
if (typeof nb === 'string') { try { nb = JSON.parse(nb); } catch (e) { nb = []; } }
if (Array.isArray(nb) && nb.length) {
  resp += '\n\nВНИМАНИЕ: на это же время (±30 минут) у клиента уже стоят напоминания:\n' +
    nb.map(n => '#' + n.id + ' — ' + n.kogda + ' — ' + n.text).join('\n') +
    '\nЕсли новое напоминание ЗАМЕНЯЕТ их (обновился план, курс или график) — отмени старые через action=cancel, ' +
    'иначе клиент получит дубли. Если это разные дела — ничего не делай.';
}
return [{ json: { response: resp } }];`;

// ---- 1) новое входное поле подворкфлоу ----
const trig = byName('When Executed by Another Workflow');
const vals = (((trig.parameters || {}).workflowInputs || {}).values) || fail('у триггера нет списка входов');
if (!vals.some((v) => v.name === 'done_when')) vals.push({ name: 'done_when', type: 'string' });

// ---- 2) код узлов: заменяем целиком, но только поверх ожидаемой версии ----
const params = byName('Параметры');
if (!params.parameters.jsCode.includes('DONE_OK')) {
  const c = params.parameters.jsCode;
  if (!c.includes("if (action === 'list')") || !c.includes('Перевод местного времени клиента в UTC делает Postgres')) {
    fail('узел «Параметры» не той версии — править руками');
  }
  params.parameters.jsCode = PARAMS_CODE;
} else console.log('~ «Параметры» уже правлены');

const ans = byName('Ответ агенту');
if (!ans.parameters.jsCode.includes('ВНИМАНИЕ: на это же время')) {
  if (!ans.parameters.jsCode.includes("if (act === 'list')")) fail('узел «Ответ агенту» не той версии — править руками');
  ans.parameters.jsCode = ANSWER_CODE;
} else console.log('~ «Ответ агенту» уже правлен');

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');

// ---- проверка фактом: гоняем код узлов на подставных данных ----
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(back) ? back[0] : back;
const pc = w.nodes.find((n) => n.name === 'Параметры').parameters.jsCode;
const ac = w.nodes.find((n) => n.name === 'Ответ агенту').parameters.jsCode;
if (!w.nodes.find((n) => n.name === 'When Executed by Another Workflow').parameters.workflowInputs.values
  .some((v) => v.name === 'done_when')) fail('вход done_when не добавлен');

let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };
const runP = (d) => new Function('$input', pc)({ first: () => ({ json: d }) })[0].json;
const maxPh = (q) => Math.max(0, ...((q.match(/\$(\d+)/g) || []).map((s) => Number(s.slice(1)))));
const base = { bot_id: 'users', user_id: 999608, chat_id: 999608, tz: 'Europe/Moscow' };

let r = runP({ ...base, action: 'create', text: 'Взвеситься', when_date: '2026-09-12', when_time: '8:00', done_when: 'measurement:weight' });
check('вес: связь сохраняется', r.done_when === 'measurement:weight' && r.params[8] === 'measurement:weight');
check('вес: плейсхолдеров столько же, сколько параметров', maxPh(r.query) === r.params.length);
check('вес: запрос возвращает соседей', /AS near/.test(r.query) && /done_when/.test(r.query));
check('вес: время дополнено нулём', r.params[4] === '08:00');

r = runP({ ...base, action: 'create', text: 'Время тренироваться', in_minutes: 30, done_when: 'workout:strength' });
check('тренировка через минуты: связь и параметры', r.params[7] === 'workout:strength' && maxPh(r.query) === r.params.length);

r = runP({ ...base, action: 'create', text: '💉 Укол тирзепатида 5 мг', when_date: '2026-09-13', when_time: '10:00', done_when: 'measurement:weight' });
check('укол: связь принудительно снята', r.done_when === 'none' && r.med_forced === true && r.params[8] === 'none');

r = runP({ ...base, action: 'create', text: 'Анастрозол 0.5 таб', when_date: '2026-09-13', when_time: '10:00', done_when: 'food:dinner' });
check('таблетка: связь снята', r.done_when === 'none' && r.med_forced === true);

r = runP({ ...base, action: 'create', text: 'Выпить 5 мл сиропа', when_date: '2026-09-13', when_time: '10:00', done_when: 'food:snack' });
check('дозировка «5 мл» распознана (без \\b)', r.done_when === 'none');

r = runP({ ...base, action: 'create', text: 'Записать ужин', when_date: '2026-09-12', when_time: '20:00', done_when: 'food:dinner' });
check('ужин: связь есть', r.done_when === 'food:dinner' && r.med_forced === false);

r = runP({ ...base, action: 'create', text: 'Сходить в зал', when_date: '2026-09-12', when_time: '18:00', done_when: 'workout:mixed' });
check('недопустимый вид тренировки → none', r.done_when === 'none');

r = runP({ ...base, action: 'create', text: 'Сделать замер', when_date: '2026-09-12', when_time: '18:00', done_when: 'MEASUREMENT:WEIGHT ' });
check('регистр и пробелы нормализуются', r.done_when === 'measurement:weight');

r = runP({ ...base, action: 'create', text: 'Позвонить маме', when_date: '2026-09-12', when_time: '18:00' });
check('без связи → none', r.done_when === 'none' && r.med_forced === false);

r = runP({ ...base, action: 'list' });
check('список отдаёт связь', /done_when/.test(r.query) && maxPh(r.query) === r.params.length);

r = runP({ ...base, action: 'cancel', id: 52 });
check('отмена не изменилась', /status='cancelled'/.test(r.query) && r.params[0] === 52);

const runA = (P, rows) => new Function('$', '$input', ac)(
  () => ({ first: () => ({ json: P }) }), { all: () => rows.map((j) => ({ json: j })) })[0].json.response;

let out = runA({ action: 'create', done_when: 'measurement:weight', med_forced: false }, [{ id: 90, kogda: '12.09 08:00', near: [] }]);
check('ответ: пояснение про автопропуск, без тревоги', /не придёт/.test(out) && !/ВНИМАНИЕ/.test(out));
out = runA({ action: 'create', done_when: 'none', med_forced: false },
  [{ id: 91, kogda: '12.09 10:00', near: '[{"id":52,"kogda":"12.09 10:00","text":"Укол 3"}]' }]);
check('ответ: соседи из строки JSON', /ВНИМАНИЕ/.test(out) && /#52/.test(out) && /action=cancel/.test(out));
out = runA({ action: 'create', done_when: 'none', med_forced: true }, [{ id: 92, kogda: '13.09 10:00', near: [] }]);
check('ответ: пометка про лекарства', /лекарств/.test(out));
out = runA({ action: 'list' }, [{ id: 7, kogda: '12.09 08:00', text: 'Взвеситься', repeat_rule: 'weekly', done_when: 'measurement:weight' }]);
check('список: повтор и связь видны', /еженедельно/.test(out) && /взвешивание/.test(out));

if (bad.length) fail('провалено ' + bad.length + ' из ' + total + ' проверок');
console.log('OK ->', OUT, '| проверок пройдено:', total);
