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
 * Вечер 11.09.2026, вторая жалоба владельца: «Эллипс и велотренажёр — это кардио, отдельно от
 * силовой. Зачем он их смешал с тренировкой?» Поэтому:
 *  - кардио хранится отдельным списком cardio [{name, duration_min, when}], не в днях;
 *  - кардио внутри силового дня инструмент ОТКЛОНЯЕТ с объяснением, куда его передать;
 *  - cardio не передан — сохраняется прежний (пересохраняя программу из-за одного упражнения,
 *    модель не должна случайно стереть кардио);
 *  - у упражнения может быть схема подходов: {name, target: "4 × 8–12"} — как в плане,
 *    который утверждал клиент. Название — как в журнале, иначе прошлые веса не найдутся.
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
    query: "SELECT version, title, days, cardio, started_on::text AS started_on, note FROM training_program WHERE bot_id=$1 AND user_id=$2 AND status='active'",
    params: [bot, uid] } }];
}
if (action !== 'set') throw new Error('action: get (прочитать действующую) или set (новая версия)');

const parseArr = (v, what) => {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { throw new Error(what + ' — не JSON. Нужен JSON-массив.'); }
  }
  return v;
};

// Кардио в силовом дне — главный источник путаницы: код не пускает его туда вовсе.
// «Велосипед» (упражнение на пресс) сюда не попадает: в списке только однозначные названия.
const CARDIO_ANY = /(эллипс|велотренаж|беговая дорожк|беговой дорожк|гребн[а-яё]* тренаж|степпер|кардио)/i;
const CARDIO_FULL = /^(ходьба|быстрая ходьба|интенсивная ходьба|скандинавская ходьба|шаги|бег|гребля|плавание|сайкл|велосипед на улице)$/i;
const isCardioName = (s) => { const nm = String(s || '').trim().replace(/\s*\([^)]*\)\s*$/, ''); return CARDIO_ANY.test(nm) || CARDIO_FULL.test(nm); };

let days = parseArr(d.days, 'days');
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
  const ex = (Array.isArray(x.exercises) ? x.exercises : []).map((e) => {
    if (e && typeof e === 'object') {
      const n = String(e.name || '').trim();
      const t = String(e.target || '').trim();
      return n ? (t ? { name: n, target: t } : n) : null;
    }
    const s = String(e || '').trim();
    return s || null;
  }).filter(Boolean);
  if (!ex.length) throw new Error('день ' + day + ': пустой список упражнений (exercises)');
  const cardioIn = ex.map((e) => (typeof e === 'string' ? e : e.name)).filter(isCardioName);
  if (cardioIn.length) {
    throw new Error('день ' + day + ': «' + cardioIn.join('», «') + '» — это кардио. В силовые дни кардио не ставь: передай его отдельно в cardio (name, duration_min, when), а в days оставь только силовые упражнения.');
  }
  const out = { day, name, exercises: ex };
  const wd = String(x.weekday || '').trim();
  if (wd) out.weekday = wd;
  return out;
}).sort((a, b) => a.day - b.day);
clean.forEach((x, i) => { if (x.day !== i + 1) throw new Error('дни должны идти подряд с 1 — пропущен день ' + (i + 1)); });

let cardio = null;
if (d.cardio !== undefined && d.cardio !== null && String(d.cardio).trim() !== '') {
  const c = parseArr(d.cardio, 'cardio');
  if (!Array.isArray(c)) throw new Error('cardio — JSON-массив [{name, duration_min, when}]; пустой [] — убрать кардио');
  if (c.length > 10) throw new Error('cardio — не больше 10 видов');
  cardio = c.map((x, i) => {
    const o = (x && typeof x === 'object') ? x : { name: x };
    const n = String(o.name || '').trim();
    if (!n) throw new Error('cardio, элемент ' + (i + 1) + ': нет названия (name)');
    const r = { name: n };
    if (o.duration_min !== undefined && o.duration_min !== null && String(o.duration_min).trim() !== '') {
      const m = Number(o.duration_min);
      if (!isFinite(m) || m < 1 || m > 600) throw new Error('cardio «' + n + '»: duration_min — число минут от 1 до 600');
      r.duration_min = Math.round(m);
    }
    const w = String(o.when || '').trim();
    if (w) r.when = w.slice(0, 160);
    return r;
  });
}

const title = String(d.title || '').trim() || 'Программа тренировок';
const note = String(d.note || '').trim() || null;
return [{ json: { action,
  query: 'SELECT new_version, started_on::text AS started_on, old_version, old_days, new_days, old_cardio, new_cardio FROM set_training_program($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)',
  params: [bot, uid, tz, title, JSON.stringify(clean), note, cardio === null ? null : JSON.stringify(cardio)] } }];
`.trim();

const CODE_ANSWER = String.raw`
const P = $('Параметры').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r && (r.version || r.new_version));
const asArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  return [];
};
const exName = (x) => (x && typeof x === 'object') ? String(x.name || '') : String(x);
const exText = (x) => (x && typeof x === 'object') ? (String(x.name || '') + (x.target ? ' — ' + x.target : '')) : String(x);
const render = (days) => asArr(days).map((dd) => 'День ' + dd.day + (dd.weekday ? ' (' + dd.weekday + ')' : '') + ' — ' + dd.name + ': ' +
  (dd.exercises || []).map((x, i) => (i + 1) + ') ' + exText(x)).join(', ')).join('\n');
const cardioText = (c) => asArr(c).map((x) => x.name + (x.duration_min ? ' — ' + x.duration_min + ' мин' : '') + (x.when ? ' (' + x.when + ')' : '')).join('; ');

if (P.action === 'get') {
  if (!rows.length) return [{ json: { response: 'Действующей программы тренировок нет. Когда согласуете программу с клиентом (перечисли состав каждого дня и получи явное «да») — сохрани её action=set.' } }];
  const r = rows[0];
  const ct = cardioText(r.cardio);
  return [{ json: { response: 'Действующая программа, версия ' + r.version + ' (с ' + r.started_on + '): ' + r.title + '\n' +
    render(r.days) + '\nКардио (отдельно от силовых дней, в раскладку силового дня не входит): ' + (ct || 'не задано') +
    (r.note ? '\nЗаметка: ' + r.note : '') } }];
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
  const ae = (a.exercises || []).map(exName), be = (b.exercises || []).map(exName);
  const added = be.filter((x) => ae.indexOf(x) === -1), removed = ae.filter((x) => be.indexOf(x) === -1);
  const orderChanged = !added.length && !removed.length && ae.join('|') !== be.join('|');
  const tgt = (arr) => { const m = {}; (arr || []).forEach((x) => { if (x && typeof x === 'object' && x.target) m[x.name] = x.target; }); return m; };
  const at = tgt(a.exercises), bt = tgt(b.exercises);
  const schemeChanged = be.filter((x) => ae.indexOf(x) !== -1 && (at[x] || '') !== (bt[x] || '')).map((x) => x + ' ' + (at[x] || '—') + ' → ' + (bt[x] || '—'));
  const parts = [];
  if (a.name !== b.name) parts.push('название «' + a.name + '» → «' + b.name + '»');
  if (added.length) parts.push('добавлено: ' + added.join(', '));
  if (removed.length) parts.push('убрано: ' + removed.join(', '));
  if (orderChanged) parts.push('изменён порядок');
  if (schemeChanged.length) parts.push('схема: ' + schemeChanged.join('; '));
  if (parts.length) diff.push('День ' + k + ': ' + parts.join('; '));
}
const oc = cardioText(r.old_cardio), nc = cardioText(r.new_cardio);
if (r.old_version && oc !== nc) diff.push('Кардио: было «' + (oc || 'не задано') + '», стало «' + (nc || 'не задано') + '»');
else if (!r.old_version && nc) diff.push('Кардио (отдельно от силовых дней): ' + nc);
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
            { name: 'days', type: 'string' }, { name: 'note', type: 'string' }, { name: 'cardio', type: 'string' },
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
const errOf = (d) => { try { runP(d); return ''; } catch (e) { return e.message; } };
const base = { bot_id: 'users', user_id: 999608, tz: 'Europe/Moscow' };
const PROG = [
  { day: 2, name: 'Спина', weekday: 'Вт', exercises: ['Тяга верхнего блока широким хватом', ' Молотки '] },
  { day: 1, name: 'Грудь', weekday: 'Пн', exercises: [{ name: 'Жим штанги лёжа', target: '4 × 8–12' }, '', 'Баттерфляй (сведение рук в тренажёре)', { name: 'Велосипед', target: '3 × 20' }] },
];

let r = runP({ ...base, action: 'get' });
check('get: запрос только действующей, с кардио', /status='active'/.test(r.query) && /cardio/.test(r.query) && r.params.length === 2);

r = runP({ ...base, action: 'set', title: '4 дня', days: JSON.stringify(PROG), note: 'тест' });
const sent = JSON.parse(r.params[4]);
check('set: функция смены версии с 7 аргументами', /set_training_program\(\$1, \$2, \$3, \$4, \$5::jsonb, \$6, \$7::jsonb\)/.test(r.query) && r.params.length === 7);
check('set: дни упорядочены по номеру', sent[0].day === 1 && sent[1].day === 2);
check('set: пустые названия отброшены, пробелы обрезаны', sent[0].exercises.length === 3 && sent[1].exercises[1] === 'Молотки');
check('set: схема подходов сохраняется объектом', sent[0].exercises[0].name === 'Жим штанги лёжа' && sent[0].exercises[0].target === '4 × 8–12');
check('set: «Велосипед» на пресс — не кардио, пропущен', sent[0].exercises.some((e) => e.name === 'Велосипед'));
check('set: cardio не передан — null (останется прежнее)', r.params[6] === null);
check('set: days принимаются и массивом, не только строкой', runP({ ...base, action: 'set', days: PROG }).params[4] === r.params[4]);
check('set: без title — название по умолчанию', runP({ ...base, action: 'set', days: PROG }).params[3] === 'Программа тренировок');

const withCardio = runP({ ...base, action: 'set', days: PROG, cardio: JSON.stringify([{ name: 'Эллипс', duration_min: '60', when: 'в дни без силовой' }, 'Велотренажёр']) });
const cs = JSON.parse(withCardio.params[6]);
check('cardio: список сохранён, минуты числом, строка → объект', cs.length === 2 && cs[0].duration_min === 60 && cs[1].name === 'Велотренажёр');
check('cardio: пустой [] — убрать кардио явно', runP({ ...base, action: 'set', days: PROG, cardio: '[]' }).params[6] === '[]');

check('отказ: эллипс в силовом дне', /«Эллипс» — это кардио/.test(errOf({ ...base, action: 'set', days: [{ day: 1, name: 'Верх', exercises: ['Эллипс', 'Жим Арнольда'] }] })));
check('отказ: велотренажёр объектом в силовом дне', /«Велотренажёр \(Technogym\)» — это кардио/.test(errOf({ ...base, action: 'set', days: [{ day: 1, name: 'Верх', exercises: [{ name: 'Велотренажёр (Technogym)', target: '30 мин' }, 'Молотки'] }] })));
check('отказ объясняет, куда деть кардио', /передай его отдельно в cardio/.test(errOf({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: ['Шаги'] }] })));
check('отказ: cardio без названия', /нет названия/.test(errOf({ ...base, action: 'set', days: PROG, cardio: [{ duration_min: 30 }] })));
check('отказ: cardio с минутами словом', /duration_min/.test(errOf({ ...base, action: 'set', days: PROG, cardio: [{ name: 'Эллипс', duration_min: 'час' }] })));
check('отказ: days не JSON', /не JSON/.test(errOf({ ...base, action: 'set', days: 'Пн грудь' })));
check('отказ: пустой массив', /непустой/.test(errOf({ ...base, action: 'set', days: '[]' })));
check('отказ: день без упражнений', /пустой список/.test(errOf({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: [] }] })));
check('отказ: день дважды', /дважды/.test(errOf({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: ['x'] }, { day: 1, name: 'Б', exercises: ['y'] }] })));
check('отказ: дни не подряд', /пропущен день 2/.test(errOf({ ...base, action: 'set', days: [{ day: 1, name: 'А', exercises: ['x'] }, { day: 3, name: 'В', exercises: ['y'] }] })));
check('отказ: неизвестное действие', /get .* или set/.test(errOf({ ...base, action: 'delete' })));

const runA = (P, rows) => new Function('$', '$input', CODE_ANSWER)(
  () => ({ first: () => ({ json: P }) }), { all: () => rows.map((j) => ({ json: j })) })[0].json.response;

let out = runA({ action: 'get' }, [{ success: true }]);
check('get: программы нет — честный ответ с порядком фиксации', /Действующей программы тренировок нет/.test(out) && /явное «да»/.test(out));
out = runA({ action: 'get' }, [{ version: 3, title: '4 дня', started_on: '2026-08-18', days: JSON.stringify(sent), cardio: [{ name: 'Эллипс', duration_min: 60, when: 'в дни без силовой' }], note: null }]);
check('get: дни, порядок и схема подходов', /версия 3/.test(out) && /1\) Жим штанги лёжа — 4 × 8–12/.test(out));
check('get: кардио отдельной строкой', /Кардио \(отдельно от силовых дней[^\n]*\): Эллипс — 60 мин \(в дни без силовой\)/.test(out));
out = runA({ action: 'get' }, [{ version: 1, title: 'x', started_on: '2026-08-18', days: [{ day: 1, name: 'А', exercises: ['Жим'] }], cardio: [], note: null }]);
check('get: кардио не задано — так и сказано', /Кардио[^\n]*: не задано/.test(out));

const V1 = [{ day: 1, name: 'Грудь', exercises: ['Жим', 'Баттерфляй'] }, { day: 2, name: 'Спина', exercises: ['Тяга', 'Молотки'] }];
const V2 = [{ day: 1, name: 'Грудь', exercises: [{ name: 'Жим', target: '4 × 8' }, 'Разводка'] }, { day: 2, name: 'Спина', exercises: ['Молотки', 'Тяга'] }];
out = runA({ action: 'set' }, [{ new_version: 2, started_on: '2026-09-11', old_version: 1, old_days: V1, new_days: V2, old_cardio: [], new_cardio: [] }]);
check('set: сказано, что старая версия снята', /версия 1 снята, действует версия 2/.test(out));
check('set: замена упражнения видна по названию, даже если стал объектом', /День 1: добавлено: Разводка; убрано: Баттерфляй/.test(out) && !/добавлено: Жим/.test(out));
check('set: видна новая схема подходов', /схема: Жим — → 4 × 8/.test(out));
check('set: виден изменённый порядок', /День 2: изменён порядок/.test(out));
check('set: без ложной тревоги о потере дней и кардио', !/ВНИМАНИЕ/.test(out) && !/Кардио:/.test(out));
out = runA({ action: 'set' }, [{ new_version: 3, started_on: '2026-09-11', old_version: 2, old_days: V2, new_days: V2, old_cardio: [], new_cardio: JSON.stringify([{ name: 'Эллипс', duration_min: 60 }]) }]);
check('set: изменение кардио видно', /Кардио: было «не задано», стало «Эллипс — 60 мин»/.test(out));
out = runA({ action: 'set' }, [{ new_version: 2, started_on: '2026-09-11', old_version: 1, old_days: V1, new_days: JSON.stringify([V2[0]]), old_cardio: [], new_cardio: [] }]);
check('set: потеря дня при частичной передаче замечена', /ВНИМАНИЕ: в новой версии дней меньше/.test(out) && /День 2 — УБРАН/.test(out));
out = runA({ action: 'set' }, [{ new_version: 1, started_on: '2026-09-11', old_version: null, old_days: null, new_days: V1, old_cardio: null, new_cardio: [{ name: 'Велотренажёр', duration_min: 30 }] }]);
check('set: первая версия — без упоминания снятой, кардио названо', /Программа сохранена: версия 1/.test(out) && !/снята/.test(out) && /Кардио \(отдельно от силовых дней\): Велотренажёр — 30 мин/.test(out));

if (bad.length) { console.error('ОШИБКА: провалено ' + bad.length + ' из ' + total + ' проверок'); process.exit(1); }
console.log('OK ->', OUT, '| проверок пройдено:', total);
