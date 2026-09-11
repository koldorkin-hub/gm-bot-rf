/**
 * Программа тренировок: инструмент агента (ProgramTool01).
 *
 * Повод (владелец, 11.09.2026): бот путался в тренировках — выдавал понедельник вместо
 * дня «отстающих» и раскладывал упражнения как попало. Причина: при переделке программы
 * старые версии оставались жить рядом с новой — в разных полях профиля и в журнале,
 * по которому бот строил «прошлую такую же». Владелец: «нужна система, где он удаляет
 * старый режим как то, что уже не работает, создаёт новый и дальше движется по нему».
 *
 * Принцип: «новое заменяет старое» гарантирует КОД, а не память модели.
 *  - версии хранятся в таблице training_program, действующая ровно одна (индекс в базе);
 *  - action=set вызывает функцию set_training_program: она в одной транзакции снимает
 *    действующую версию и заводит новую;
 *  - в ответе — что именно изменилось по дням, чтобы бот сказал это клиенту и чтобы
 *    случайная потеря дня при частичной передаче была заметна сразу.
 *
 * Сборка:  node schema/build-programtool.js  ->  schema/ProgramTool01.json
 */
const fs = require('fs');
const path = require('path');

const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

const CODE_PARAMS = String.raw`
const d = $input.first().json;
const action = String(d.action || 'get').trim().toLowerCase();
const bot = d.bot_id, uid = Number(d.user_id);
const tz = String(d.tz || '').trim() || 'Europe/Moscow';

if (action === 'get') {
  return [{ json: { action,
    query: "SELECT version, title, days, started_on::text AS started_on, note FROM training_program WHERE bot_id=$1 AND user_id=$2 AND status='active'",
    params: [bot, uid] } }];
}
if (action !== 'set') throw new Error('action: get (прочитать действующую) или set (новая версия)');

let days = d.days;
if (typeof days === 'string') {
  try { days = JSON.parse(days); } catch (e) { throw new Error('days — не JSON. Нужен JSON-массив ВСЕХ дней программы.'); }
}
if (!Array.isArray(days) || !days.length) throw new Error('days — нужен непустой JSON-массив ВСЕХ дней программы, не только изменённого');

const seen = new Set();
const clean = days.map((x, i) => {
  if (!x || typeof x !== 'object') throw new Error('элемент ' + (i + 1) + ': не объект дня');
  const day = Number(x.day);
  if (!Number.isInteger(day) || day < 1 || day > 14) throw new Error('элемент ' + (i + 1) + ': day — целое число от 1 до 14');
  if (seen.has(day)) throw new Error('день ' + day + ' указан дважды');
  seen.add(day);
  const name = String(x.name || '').trim();
  if (!name) throw new Error('день ' + day + ': нет названия (name)');
  const ex = Array.isArray(x.exercises) ? x.exercises.map((e) => String(e || '').trim()).filter(Boolean) : [];
  if (!ex.length) throw new Error('день ' + day + ': пустой список упражнений (exercises)');
  const out = { day, name, exercises: ex };
  const wd = String(x.weekday || '').trim();
  if (wd) out.weekday = wd;
  return out;
}).sort((a, b) => a.day - b.day);
clean.forEach((x, i) => { if (x.day !== i + 1) throw new Error('дни должны идти подряд с 1 — пропущен день ' + (i + 1)); });

const title = String(d.title || '').trim() || 'Программа тренировок';
const note = String(d.note || '').trim() || null;
return [{ json: { action,
  query: 'SELECT new_version, started_on::text AS started_on, old_version, old_days, new_days FROM set_training_program($1, $2, $3, $4, $5::jsonb, $6)',
  params: [bot, uid, tz, title, JSON.stringify(clean), note] } }];
`.trim();

const CODE_ANSWER = String.raw`
const P = $('Параметры').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r && (r.version || r.new_version));
const asArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  return [];
};
const render = (days) => asArr(days).map((dd) => 'День ' + dd.day + (dd.weekday ? ' (' + dd.weekday + ')' : '') + ' — ' + dd.name + ': ' +
  (dd.exercises || []).map((x, i) => (i + 1) + ') ' + x).join(', ')).join('\n');

if (P.action === 'get') {
  if (!rows.length) return [{ json: { response: 'Действующей программы тренировок нет. Когда согласуете программу с клиентом — сохрани её action=set.' } }];
  const r = rows[0];
  return [{ json: { response: 'Действующая программа, версия ' + r.version + ' (с ' + r.started_on + '): ' + r.title + '\n' +
    render(r.days) + (r.note ? '\nЗаметка: ' + r.note : '') } }];
}

if (!rows.length) return [{ json: { response: 'Не удалось сохранить программу.' } }];
const r = rows[0];
const oldD = asArr(r.old_days), newD = asArr(r.new_days);
const byDay = (arr) => { const m = {}; arr.forEach((x) => { m[x.day] = x; }); return m; };
const o = byDay(oldD), n = byDay(newD);
const allDays = Array.from(new Set(Object.keys(o).concat(Object.keys(n)).map(Number))).sort((a, b) => a - b);
const diff = [];
for (const k of allDays) {
  const a = o[k], b = n[k];
  if (!a) { diff.push('День ' + k + ' — новый: ' + b.name); continue; }
  if (!b) { diff.push('День ' + k + ' — УБРАН (был: ' + a.name + ')'); continue; }
  const ae = a.exercises || [], be = b.exercises || [];
  const added = be.filter((x) => ae.indexOf(x) === -1), removed = ae.filter((x) => be.indexOf(x) === -1);
  const orderChanged = !added.length && !removed.length && ae.join('|') !== be.join('|');
  const parts = [];
  if (a.name !== b.name) parts.push('название «' + a.name + '» → «' + b.name + '»');
  if (added.length) parts.push('добавлено: ' + added.join(', '));
  if (removed.length) parts.push('убрано: ' + removed.join(', '));
  if (orderChanged) parts.push('изменён порядок');
  if (parts.length) diff.push('День ' + k + ': ' + parts.join('; '));
}
let resp = r.old_version
  ? 'Программа обновлена: версия ' + r.old_version + ' снята, действует версия ' + r.new_version + ' (с ' + r.started_on + ').'
  : 'Программа сохранена: версия ' + r.new_version + ' (с ' + r.started_on + ').';
if (diff.length) resp += '\nИзменения:\n' + diff.join('\n');
else if (r.old_version) resp += '\nСостав не изменился.';
if (r.old_version && newD.length < oldD.length) {
  resp += '\nВНИМАНИЕ: в новой версии дней меньше, чем было (' + newD.length + ' вместо ' + oldD.length +
    '). Если клиент этого не просил — дни потеряны при передаче: восстанови их новым set с полным составом.';
}
resp += '\nСкажи клиенту коротко, что изменилось в программе.';
return [{ json: { response: resp } }];
`.trim();

const tool = {
  id: 'ProgramTool01',
  name: 'Инструмент — Программа тренировок',
  active: false,
  nodes: [
    {
      parameters: {
        inputSource: 'workflowInputs',
        workflowInputs: {
          values: [
            { name: 'bot_id', type: 'string' }, { name: 'user_id', type: 'number' }, { name: 'tz', type: 'string' },
            { name: 'action', type: 'string' }, { name: 'title', type: 'string' },
            { name: 'days', type: 'string' }, { name: 'note', type: 'string' },
          ],
        },
      },
      id: 'pg000000-0000-4000-8000-000000000001',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.2,
      position: [-600, 0],
    },
    {
      parameters: { jsCode: CODE_PARAMS },
      id: 'pg000000-0000-4000-8000-000000000002',
      name: 'Параметры',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-380, 0],
    },
    {
      parameters: { operation: 'executeQuery', query: '={{ $json.query }}', options: { queryReplacement: '={{ $json.params }}' } },
      id: 'pg000000-0000-4000-8000-000000000003',
      name: 'Данные',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-160, 0],
      credentials: PG,
      // Пустой результат (программы ещё нет) не должен обрывать цепочку — иначе агент не получит ответа.
      alwaysOutputData: true,
    },
    {
      parameters: { jsCode: CODE_ANSWER },
      id: 'pg000000-0000-4000-8000-000000000004',
      name: 'Ответ агенту',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [60, 0],
    },
  ],
  connections: {
    'When Executed by Another Workflow': { main: [[{ node: 'Параметры', type: 'main', index: 0 }]] },
    'Параметры': { main: [[{ node: 'Данные', type: 'main', index: 0 }]] },
    'Данные': { main: [[{ node: 'Ответ агенту', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001', executionTimeout: 120 },
  pinData: {},
};

const OUT = path.join(__dirname, 'ProgramTool01.json');
fs.writeFileSync(OUT, JSON.stringify(tool, null, 2), 'utf8');

// ---- проверка фактом: гоняем оба узла на подставных данных ----
let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };
const runP = (d) => new Function('$input', CODE_PARAMS)({ first: () => ({ json: d }) })[0].json;
const expectErr = (d, re) => { try { runP(d); return false; } catch (e) { return re.test(e.message); } };
const base = { bot_id: 'users', user_id: 999608, tz: 'Europe/Moscow' };
const PROG = [
  { day: 2, name: 'Спина', weekday: 'Вт', exercises: ['Тяга верхнего блока широким хватом', ' Молотки '] },
  { day: 1, name: 'Грудь', weekday: 'Пн', exercises: ['Жим штанги лёжа', '', 'Баттерфляй (сведение рук в тренажёре)'] },
];

let r = runP({ ...base, action: 'get' });
check('get: запрос только действующей', /status='active'/.test(r.query) && r.params.length === 2);

r = runP({ ...base, action: 'set', title: '4 дня', days: JSON.stringify(PROG), note: 'тест' });
const sent = JSON.parse(r.params[4]);
check('set: вызывается функция смены версии', /set_training_program\(\$1, \$2, \$3, \$4, \$5::jsonb, \$6\)/.test(r.query) && r.params.length === 6);
check('set: дни упорядочены по номеру', sent[0].day === 1 && sent[1].day === 2);
check('set: пустые названия отброшены, пробелы обрезаны', sent[0].exercises.length === 2 && sent[1].exercises[1] === 'Молотки');
check('set: days принимаются и массивом, не только строкой', runP({ ...base, action: 'set', days: PROG }).params[4] === r.params[4]);
check('set: без title — название по умолчанию', runP({ ...base, action: 'set', days: PROG }).params[3] === 'Программа тренировок');

check('отказ: days не JSON', expectErr({ ...base, action: 'set', days: 'Пн грудь' }, /не JSON/));
check('отказ: пустой массив', expectErr({ ...base, action: 'set', days: '[]' }, /непустой/));
check('отказ: день без упражнений', expectErr({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: [] }] }, /пустой список/));
check('отказ: день дважды', expectErr({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: ['x'] }, { day: 1, name: 'Б', exercises: ['y'] }] }, /дважды/));
check('отказ: дни не подряд', expectErr({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: ['x'] }, { day: 3, name: 'В', exercises: ['y'] }] }, /пропущен день 2/));
check('отказ: неизвестное действие', expectErr({ ...base, action: 'delete' }, /get .* или set/));

const runA = (P, rows) => new Function('$', '$input', CODE_ANSWER)(
  () => ({ first: () => ({ json: P }) }), { all: () => rows.map((j) => ({ json: j })) })[0].json.response;

let out = runA({ action: 'get' }, [{ success: true }]);
check('get: программы нет — честный ответ', /Действующей программы тренировок нет/.test(out));
out = runA({ action: 'get' }, [{ version: 3, title: '4 дня', started_on: '2026-08-18', days: JSON.stringify(PROG), note: null }]);
check('get: показывает дни и упражнения по порядку', /версия 3/.test(out) && /1\) Тяга верхнего блока/.test(out));

const V1 = [{ day: 1, name: 'Грудь', exercises: ['Жим', 'Баттерфляй'] }, { day: 2, name: 'Спина', exercises: ['Тяга', 'Молотки'] }];
const V2 = [{ day: 1, name: 'Грудь', exercises: ['Жим', 'Разводка'] }, { day: 2, name: 'Спина', exercises: ['Молотки', 'Тяга'] }];
out = runA({ action: 'set' }, [{ new_version: 2, started_on: '2026-09-11', old_version: 1, old_days: V1, new_days: V2 }]);
check('set: сказано, что старая версия снята', /версия 1 снята, действует версия 2/.test(out));
check('set: видна замена упражнения', /День 1: добавлено: Разводка; убрано: Баттерфляй/.test(out));
check('set: виден изменённый порядок', /День 2: изменён порядок/.test(out));
check('set: без ложной тревоги о потере дней', !/ВНИМАНИЕ/.test(out));
out = runA({ action: 'set' }, [{ new_version: 2, started_on: '2026-09-11', old_version: 1, old_days: V1, new_days: JSON.stringify([V2[0]]) }]);
check('set: потеря дня при частичной передаче замечена', /ВНИМАНИЕ: в новой версии дней меньше/.test(out) && /День 2 — УБРАН/.test(out));
out = runA({ action: 'set' }, [{ new_version: 1, started_on: '2026-09-11', old_version: null, old_days: null, new_days: V1 }]);
check('set: первая версия — без упоминания снятой', /Программа сохранена: версия 1/.test(out) && !/снята/.test(out));

if (bad.length) { console.error('ОШИБКА: провалено ' + bad.length + ' из ' + total + ' проверок'); process.exit(1); }
console.log('OK ->', OUT, '| проверок пройдено:', total);
