/**
 * Главный workflow: программа тренировок с версиями + связь напоминаний с делом.
 *
 * Повод (владелец, 11.09.2026):
 *  - бот путал тренировки: старая и новая версии программы жили одновременно — в полях
 *    профиля и в журнале, по которому он строил «прошлую такую же»;
 *  - напоминание «взвеситься» приходило, даже если человек уже взвесился сам;
 *  - по утрам приходили дубли: бот пересоздавал график и не отменял старый.
 *
 * Что меняется:
 *  1. Новый инструмент training_program (подворкфлоу ProgramTool01): get / set.
 *  2. «Load Profile» дочитывает действующую программу, «Build Profile Context» кладёт её
 *     в профиль строкой «ПРОГРАММА ТРЕНИРОВОК» — единственный источник состава и порядка.
 *  3. Правило «ВЕДЕНИЕ ТРЕНИРОВКИ ПО ПРОШЛОЙ… те же упражнения в том же порядке» заменено
 *     на ведение по программе. Именно оно превращало журнал в шаблон: переставил в зале
 *     из-за занятого тренажёра — и в следующий раз бот предлагал уже этот порядок.
 *  4. В правило про поля планов — не писать туда состав упражнений.
 *  5. set_reminder: поле done_when и правила про связь, лекарства и дубли.
 *
 * Прогон:  node transform-main-program-reminder.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-program-reminder.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const once = (s, from, what) => { const k = s.split(from).length - 1; if (k !== 1) fail(what + ': якорь встречается ' + k + ' раз, ожидался один'); };
const swap = (s, from, to, what) => { once(s, from, what); return s.replace(from, () => to); };
const before = JSON.parse(JSON.stringify(wf));

// ================= 1) set_reminder: done_when =================
const sr = byName('set_reminder');
const DESC_REM = 'Напоминания клиенту — бот умеет напоминать сам. action=create: text + либо when_date (ГГГГ-ММ-ДД из справки) и when_time (ЧЧ:ММ клиента), либо in_minutes; repeat daily|weekly для регулярных. ' +
  'done_when — чем напоминание закрывается само, если клиент заранее сделал дело в тот же день: measurement:weight|waist|hip|body_fat_pct (записан замер), food:breakfast|lunch|dinner|snack (записан приём пищи), workout:strength|cardio (записана тренировка ТОГО ЖЕ вида). ' +
  'Ставь связь только если напоминание именно о том, чтобы сделать или записать это действие. Лекарства, уколы, препараты, добавки, любые медицинские напоминания — ВСЕГДА none. Сомневаешься — none. ' +
  'Меняешь график целиком (обновился план, курс) — сначала action=list и отмени устаревшие, потом ставь новые. Если в ответе сказано, что на это время уже стоят напоминания, а новое их заменяет, — отмени старые action=cancel. ' +
  'action=list — активные с номерами. action=cancel + id. Придёт само в назначенное время.';
if (!String(sr.parameters.description).includes('done_when')) {
  if (!String(sr.parameters.description).includes('action=cancel + id')) fail('описание set_reminder не той версии');
  sr.parameters.description = DESC_REM;
}
const wi = sr.parameters.workflowInputs;
if (!wi.value.done_when) {
  wi.value.done_when = "={{ $fromAI('done_when', 'чем закрывается само: measurement:weight, measurement:waist, measurement:hip, measurement:body_fat_pct, food:breakfast, food:lunch, food:dinner, food:snack, workout:strength, workout:cardio или none; лекарства всегда none', 'string') }}";
}
if (!wi.schema.some((c) => c.id === 'done_when')) {
  const tpl = wi.schema.find((c) => c.type === 'string') || fail('в схеме set_reminder нет строкового поля-образца');
  wi.schema.push({ ...tpl, id: 'done_when', displayName: 'done_when', type: 'string' });
}

// ================= 2) новый инструмент training_program =================
const DESC_PRG = 'Программа тренировок клиента — ЕДИНСТВЕННЫЙ источник состава и порядка упражнений каждого дня. Действующая программа уже показана в профиле строкой ПРОГРАММА ТРЕНИРОВОК. ' +
  'action=get — прочитать действующую целиком. action=set — завести НОВУЮ версию: title, days (JSON-массив ВСЕХ дней программы, не только изменённого; у дня поля day, name, weekday, exercises — названия упражнений по порядку выполнения) и note (что изменилось). ' +
  'Прежняя версия снимается автоматически, двух действующих не бывает. Вызывай set, когда клиент меняет программу НАСОВСЕМ: новый сплит, заменить, добавить или убрать упражнение, новый постоянный порядок. ' +
  'НЕ вызывай set при разовой перестановке в зале (тренажёр занят, сегодня вместо) — это просто запись в журнал. Перед set сделай get, чтобы не потерять дни. Названия упражнений бери как в журнале, иначе прошлые результаты не найдутся.';
if (!wf.nodes.find((n) => n.name === 'training_program')) {
  const t = JSON.parse(JSON.stringify(sr));
  t.id = 'prg-tool-0000-4000-8000-000000000001';
  t.name = 'training_program';
  t.position = [(sr.position || [660, 920])[0] + 240, (sr.position || [660, 920])[1]];
  t.parameters.name = 'training_program';
  t.parameters.description = DESC_PRG;
  t.parameters.workflowId = { __rl: true, mode: 'list', value: 'ProgramTool01', cachedResultName: 'Инструмент — Программа тренировок' };
  t.parameters.workflowInputs.value = {
    bot_id: "={{ $('Load Config').first().json.bot_id }}",
    user_id: "={{ $('Normalize').first().json.message.from.id }}",
    tz: "={{ $('Build Profile Context').first().json.tz }}",
    action: "={{ $fromAI('action', 'get или set', 'string') }}",
    title: "={{ $fromAI('title', 'для set: короткое название программы', 'string') }}",
    days: "={{ $fromAI('days', 'для set: JSON-массив ВСЕХ дней программы, у дня поля day, name, weekday, exercises по порядку', 'string') }}",
    note: "={{ $fromAI('note', 'для set: что изменилось и почему', 'string') }}",
  };
  const strTpl = sr.parameters.workflowInputs.schema.find((c) => c.type === 'string');
  const numTpl = sr.parameters.workflowInputs.schema.find((c) => c.type === 'number') || strTpl;
  t.parameters.workflowInputs.schema = [
    ['bot_id', 'string'], ['user_id', 'number'], ['tz', 'string'], ['action', 'string'],
    ['title', 'string'], ['days', 'string'], ['note', 'string'],
  ].map(([id, type]) => ({ ...(type === 'number' ? numTpl : strTpl), id, displayName: id, type }));
  wf.nodes.push(t);
  wf.connections['training_program'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };
}

// ================= 3) Load Profile: действующая программа =================
const lp = byName('Load Profile');
if (!lp.parameters.query.includes('training_program')) {
  lp.parameters.query = swap(lp.parameters.query, ') AS profile, ',
    ") AS profile, (SELECT to_jsonb(tp) FROM training_program tp WHERE tp.bot_id=$1 AND tp.user_id=$2 AND tp.status='active') AS training_program, ",
    'Load Profile');
}

// ================= 4) Build Profile Context: строка ПРОГРАММА ТРЕНИРОВОК =================
const SNIPPET = String.raw`
// >>> программа тренировок
// Единственный источник состава и порядка упражнений. Версии — в training_program,
// действующая всегда одна: старая не может подмешаться к новой.
const _tp = asObj(row.training_program);
if (_tp && Array.isArray(_tp.days) && _tp.days.length) {
  const _tpDays = _tp.days.map((dd) => 'День ' + dd.day + (dd.weekday ? ' (обычно ' + dd.weekday + ')' : '') + ' — ' + dd.name + ': ' +
    (Array.isArray(dd.exercises) ? dd.exercises.map((x, i) => (i + 1) + ') ' + x).join(', ') : ''));
  lines.push('ПРОГРАММА ТРЕНИРОВОК (действующая версия ' + _tp.version + ', с ' + String(_tp.started_on || '').slice(0, 10) +
    '; единственный источник состава и порядка упражнений — план недели и общий план состав не задают): ' + _tpDays.join(' | '));
}
// <<< программа тренировок`;
const bpc = byName('Build Profile Context');
if (!bpc.parameters.jsCode.includes('>>> программа тренировок')) {
  const ANCH = "if (has(prof.plan_week)) lines.push('ПЛАН НА НЕДЕЛЮ: ' + prof.plan_week);";
  bpc.parameters.jsCode = swap(bpc.parameters.jsCode, ANCH, ANCH + '\n' + SNIPPET, 'Build Profile Context');
}

// ================= 5) промпт =================
const agent = wf.nodes.find((n) => n.type && n.type.endsWith('.agent')) || fail('нет узла агента');
let sm = agent.parameters.options.systemMessage;
const smBefore = sm;
const OLD_VED = 'ВЕДЕНИЕ ТРЕНИРОВКИ ПО ПРОШЛОЙ. Клиент начал тренировку («я в зале», первое упражнение) — СНАЧАЛА get_progress (workout, ~10 дней), найди прошлую того же типа и веди по ней: те же упражнения в том же порядке; ПЕРЕД каждым — прошлый результат по подходам «вес × повторы» («прошлый раз: жим лёжа — 40×16, 50×14, 60×10»); клиент отчитался — запиши и объяви следующее. Замена — только по инициативе клиента. Повторяемость = видимый прогресс.';
const NEW_VED = 'ВЕДЕНИЕ ТРЕНИРОВКИ ПО ПРОГРАММЕ. Состав и ПОРЯДОК упражнений на день — ТОЛЬКО из строки «ПРОГРАММА ТРЕНИРОВОК» в профиле; не из журнала, не из плана недели, не из общего плана. Какой день программы сегодня — по плану недели и календарю. ' +
  'Клиент начал тренировку («я в зале», «распиши тренировку», первое упражнение) — СНАЧАЛА get_progress (workout, ~21 день) и ПЕРЕД каждым упражнением дня дай его прошлый результат по подходам «вес × повторы» по ТОМУ ЖЕ названию («прошлый раз: жим лёжа — 40×16, 50×14, 60×10»); упражнения из журнала, которых нет в дне программы, в тренировку не добавляй. Клиент отчитался — запиши и объяви следующее по программе. ' +
  'Разовая перестановка в зале (тренажёр занят, «сегодня вместо») программу НЕ меняет: запиши как было, в следующий раз веди по программе. ' +
  'Клиент меняет программу насовсем (заменить, добавить или убрать упражнение, новый сплит, новый постоянный порядок) — training_program: сначала get, потом set с ПОЛНЫМ составом всех дней; прежняя версия снимается сама, скажи клиенту, что обновил и что изменилось. Не уверен, насовсем ли, — спроси. Повторяемость = видимый прогресс.';
if (!sm.includes('ВЕДЕНИЕ ТРЕНИРОВКИ ПО ПРОГРАММЕ')) sm = swap(sm, OLD_VED, NEW_VED, 'промпт/ведение тренировки');
const OLD_PLANS = 'Веди клиента по планам изо дня в день.';
if (!sm.includes('Состав упражнений тренировок в эти поля НЕ пиши')) {
  sm = swap(sm, OLD_PLANS, OLD_PLANS + ' Состав упражнений тренировок в эти поля НЕ пиши — он живёт в программе тренировок (training_program); в plan_week — только какой день программы в какой день недели и прочие дела.', 'промпт/планы');
}
agent.parameters.options.systemMessage = sm;

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');

// ================= проверка =================
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(back) ? back[0] : back;
const g = (n) => w.nodes.find((x) => x.name === n) || fail('после записи нет узла ' + n);
let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };

// узлы: изменились только нужные
const TOUCHED = new Set(['set_reminder', 'Load Profile', 'Build Profile Context', agent.name]);
const bMap = Object.fromEntries(before.nodes.map((n) => [n.name, JSON.stringify(n)]));
const untouchedChanged = w.nodes.filter((n) => bMap[n.name] && !TOUCHED.has(n.name) && bMap[n.name] !== JSON.stringify(n)).map((n) => n.name);
check('посторонние узлы не тронуты' + (untouchedChanged.length ? ': ' + untouchedChanged.join(', ') : ''), untouchedChanged.length === 0);
check('добавлен ровно один узел', w.nodes.length === before.nodes.length + 1 || before.nodes.some((n) => n.name === 'training_program'));
const otherConn = Object.keys(before.connections).filter((k) => JSON.stringify(before.connections[k]) !== JSON.stringify(w.connections[k]));
check('прежние связи не тронуты', otherConn.length === 0);

// инструмент программы
const tp = g('training_program');
check('training_program подключён к агенту как инструмент', JSON.stringify(w.connections['training_program']) === JSON.stringify({ ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] }));
check('training_program вызывает ProgramTool01', tp.parameters.workflowId.value === 'ProgramTool01' && tp.type === g('set_reminder').type);
check('training_program: поля и схема совпадают', Object.keys(tp.parameters.workflowInputs.value).sort().join() === tp.parameters.workflowInputs.schema.map((c) => c.id).sort().join());

// напоминания
const s2 = g('set_reminder');
check('set_reminder: поле done_when и в значениях, и в схеме', !!s2.parameters.workflowInputs.value.done_when && s2.parameters.workflowInputs.schema.some((c) => c.id === 'done_when'));
check('set_reminder: лекарства всегда none', /медицинские напоминания — ВСЕГДА none/.test(s2.parameters.description));

// профиль
const q2 = g('Load Profile').parameters.query;
check('Load Profile: программа дочитывается один раз', (q2.match(/AS training_program/g) || []).length === 1 && (q2.match(/AS profile/g) || []).length === 1);
const code2 = g('Build Profile Context').parameters.jsCode;
try { new Function('$', '$input', code2); check('Build Profile Context компилируется', true); } catch (e) { check('Build Profile Context компилируется: ' + e.message, false); }

// рендер строки программы на подставных данных
const snip = code2.slice(code2.indexOf('// >>> программа тренировок'), code2.indexOf('// <<< программа тренировок'));
const renderWith = (tpRow) => { const lines = []; new Function('row', 'lines', 'asObj', snip)({ training_program: tpRow }, lines, (v) => (typeof v === 'string' ? JSON.parse(v) : v)); return lines; };
let L = renderWith({ version: 1, started_on: '2026-08-18', days: [{ day: 4, name: 'Верх, акцент отстающих', weekday: 'Пт', exercises: ['Эллипс', 'Жим Арнольда'] }] });
check('строка программы: день, порядок, версия', L.length === 1 && /ПРОГРАММА ТРЕНИРОВОК \(действующая версия 1, с 2026-08-18/.test(L[0]) && /День 4 \(обычно Пт\) — Верх, акцент отстающих: 1\) Эллипс, 2\) Жим Арнольда/.test(L[0]));
check('строка программы: из строки JSON тоже', renderWith(JSON.stringify({ version: 2, started_on: '2026-09-11', days: [{ day: 1, name: 'А', exercises: ['x'] }] })).length === 1);
check('нет программы — строки нет, ничего не падает', renderWith(null).length === 0);

// промпт
const sm2 = g(agent.name).parameters.options.systemMessage;
check('правило «те же упражнения в том же порядке» снято', !sm2.includes('ВЕДЕНИЕ ТРЕНИРОВКИ ПО ПРОШЛОЙ') && !sm2.includes('те же упражнения в том же порядке'));
check('правило ведения по программе на месте', sm2.includes('ВЕДЕНИЕ ТРЕНИРОВКИ ПО ПРОГРАММЕ') && /Разовая перестановка в зале/.test(sm2));
check('в поля планов состав не пишется', sm2.includes('Состав упражнений тренировок в эти поля НЕ пиши'));
check('выражения {{ }} не сломаны', (sm2.match(/\{\{/g) || []).length === (smBefore.match(/\{\{/g) || []).length && (sm2.match(/\{\{/g) || []).length === (sm2.match(/\}\}/g) || []).length);
const heads = (s) => (s.match(/^=== [^\n]+ ===$/gm) || []).join('|');
check('все блоки промпта на месте', heads(sm2) === heads(smBefore));

if (bad.length) fail('провалено ' + bad.length + ' из ' + total + ' проверок');
console.log('OK ->', OUT, '| проверок пройдено:', total, '| системник', smBefore.length, '->', sm2.length, 'знаков');
