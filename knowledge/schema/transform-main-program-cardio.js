/**
 * Главный workflow: программа главнее памяти, кардио — отдельно от силовых дней.
 *
 * Повод (владелец, 11.09.2026, вечер, после выкатки программы): «опять не те дни, не те
 * упражнения… взял часть с четвёртого дня, часть с понедельника… эллипс смешал с тренировкой».
 * Разбор показал, что программа в базе была одна, но модель получала ещё три источника состава:
 *  - «нить диалога» записала неправильную раскладку, которую бот сам выдал утром;
 *  - «выжимка о клиенте» с 20.08 хранила старый цикл дней с прессом в Дне 4;
 *  - последние сообщения переписки с теми же ошибками.
 * И в самой программе версии 1 эллипс стоял в силовом дне (собрано из журнала, где кардио
 * лежало внутри силовой).
 *
 * Что меняется:
 *  1. training_program: вход cardio и описание (кардио отдельно, схема подходов у упражнения).
 *  2. Build Profile Context: строка программы со схемами подходов и отдельная строка КАРДИО;
 *     заголовки выжимки и нити диалога при наличии программы прямо говорят, что состав дней
 *     в них мог устареть, — это код, а не надежда на внимательность модели.
 *  3. Промпт: что главнее (программа > выжимка/нить/планы/прошлые сообщения), кардио отдельно,
 *     «клиент говорит, что неверно» → сначала get; нет программы → зафиксировать согласованную.
 *  4. Строка про log_workout: кардио и шаги система пишет отдельной тренировкой.
 *
 * Прогон:  node transform-main-program-cardio.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-program-cardio.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const once = (s, from, what) => { const k = s.split(from).length - 1; if (k !== 1) fail(what + ': якорь встречается ' + k + ' раз, ожидался один'); };
const swap = (s, from, to, what) => { once(s, from, what); return s.replace(from, () => to); };
const before = JSON.parse(JSON.stringify(wf));

// ================= 1) инструмент training_program =================
const tp = byName('training_program');
const DESC_PRG = 'Программа тренировок клиента — ЕДИНСТВЕННЫЙ источник состава и порядка упражнений силовых дней и списка кардио. Действующая программа уже показана в профиле строками ПРОГРАММА ТРЕНИРОВОК и КАРДИО КЛИЕНТА. ' +
  'action=get — прочитать действующую целиком. action=set — завести НОВУЮ версию: title, days (JSON-массив ВСЕХ дней программы, не только изменённого; у дня поля day, name, weekday, exercises — по порядку выполнения, строкой «название» или объектом {name, target}, где target — схема подходов, например «4 × 8–12»), cardio (JSON-массив кардио клиента отдельно от силовых дней: [{name, duration_min, when}]) и note (что изменилось). ' +
  'Кардио (эллипс, велотренажёр, дорожка, ходьба, шаги) в days НЕ ставь — инструмент отклонит; не передал cardio — сохранится прежнее. ' +
  'Прежняя версия снимается автоматически, двух действующих не бывает. Вызывай set, когда клиент меняет программу НАСОВСЕМ: новый сплит, заменить, добавить или убрать упражнение, новый постоянный порядок, изменить кардио. ' +
  'НЕ вызывай set при разовой перестановке в зале (тренажёр занят, сегодня вместо) — это просто запись в журнал. Перед set сделай get, чтобы не потерять дни. Названия упражнений бери как в журнале, иначе прошлые результаты не найдутся.';
if (!String(tp.parameters.description).includes('cardio')) {
  if (!String(tp.parameters.description).includes('ЕДИНСТВЕННЫЙ источник состава')) fail('описание training_program не той версии');
  tp.parameters.description = DESC_PRG;
}
const tv = tp.parameters.workflowInputs.value;
tv.days = "={{ $fromAI('days', 'для set: JSON-массив ВСЕХ дней программы; у дня поля day, name, weekday, exercises по порядку — строки или объекты {name, target}; кардио сюда не ставь', 'string') }}";
if (!tv.cardio) {
  tv.cardio = "={{ $fromAI('cardio', 'для set: JSON-массив кардио клиента отдельно от силовых дней, например [{\"name\":\"Эллипс\",\"duration_min\":60,\"when\":\"в дни без силовой\"}]; не меняешь кардио — оставь пустым', 'string') }}";
}
if (!tp.parameters.workflowInputs.schema.some((c) => c.id === 'cardio')) {
  const tpl = tp.parameters.workflowInputs.schema.find((c) => c.id === 'note') || fail('в схеме training_program нет поля note');
  tp.parameters.workflowInputs.schema.push({ ...tpl, id: 'cardio', displayName: 'cardio', type: 'string' });
}

// ================= 2) Build Profile Context =================
const bpc = byName('Build Profile Context');
let code = bpc.parameters.jsCode;
const SNIP_START = '// >>> программа тренировок', SNIP_END = '// <<< программа тренировок';
const SNIPPET = String.raw`// >>> программа тренировок
// Единственный источник состава и порядка упражнений силовых дней. Версии — в training_program,
// действующая всегда одна: старая не может подмешаться к новой. Кардио — отдельной строкой:
// в силовой день оно не входит (жалоба владельца 11.09: эллипс оказался в Дне 4).
const _tp = asObj(row.training_program);
const _tpOn = !!(_tp && Array.isArray(_tp.days) && _tp.days.length);
if (_tpOn) {
  const _tpEx = (x) => (x && typeof x === 'object') ? (String(x.name || '') + (x.target ? ' — ' + x.target : '')) : String(x);
  const _tpDays = _tp.days.map((dd) => 'День ' + dd.day + (dd.weekday ? ' (обычно ' + dd.weekday + ')' : '') + ' — ' + dd.name + ': ' +
    (Array.isArray(dd.exercises) ? dd.exercises.map((x, i) => (i + 1) + ') ' + _tpEx(x)).join(', ') : ''));
  lines.push('ПРОГРАММА ТРЕНИРОВОК (действующая версия ' + _tp.version + ', с ' + String(_tp.started_on || '').slice(0, 10) +
    '; ЕДИНСТВЕННЫЙ источник состава и порядка силовых дней: в день — ровно эти упражнения, ничего не добавляй и не переноси из других дней; план недели, общий план, выжимка, нить диалога и прошлые сообщения состав не задают): ' + _tpDays.join(' | '));
  let _tpC = _tp.cardio;
  if (typeof _tpC === 'string') { try { _tpC = JSON.parse(_tpC); } catch (e) { _tpC = []; } }
  _tpC = Array.isArray(_tpC) ? _tpC : [];
  if (_tpC.length) {
    lines.push('КАРДИО КЛИЕНТА — ОТДЕЛЬНО от силовых дней (в раскладку силового дня НЕ включай; записывается отдельной кардио-тренировкой): ' +
      _tpC.map((c) => String(c.name || '') + (c.duration_min ? ' — ' + c.duration_min + ' мин' : '') + (c.when ? ' (' + c.when + ')' : '')).join('; '));
  }
}
// <<< программа тренировок`;
if (!code.includes('КАРДИО КЛИЕНТА — ОТДЕЛЬНО')) {
  const a = code.indexOf(SNIP_START), b = code.indexOf(SNIP_END);
  if (a < 0 || b < a || code.indexOf(SNIP_START, a + 1) >= 0) fail('Build Profile Context: блок программы не найден или повторяется');
  code = code.slice(0, a) + SNIPPET + code.slice(b + SNIP_END.length);
}
const STALE = " + (_tpOn ? '; СОСТАВ ТРЕНИРОВОЧНЫХ ДНЕЙ здесь мог устареть — верна только ПРОГРАММА ТРЕНИРОВОК' : '') + ";
const H1_OLD = String.raw`block = 'ВЫЖИМКА О КЛИЕНТЕ (долговременная память — опирайся на неё, это сжатая история общения):\n' + summary.trim()`;
const H1_NEW = String.raw`block = 'ВЫЖИМКА О КЛИЕНТЕ (долговременная память — опирайся на неё, это сжатая история общения'` + STALE + String.raw`'):\n' + summary.trim()`;
const H2_OLD = String.raw`block = 'НИТЬ ДИАЛОГА ПОСЛЕДНИХ ДНЕЙ (что обсуждали и о чём договорились — помни это, даже если сообщений нет в окне; журналы еды/тренировок смотри через get_progress):\n' + dialogThread.trim()`;
const H2_NEW = String.raw`block = 'НИТЬ ДИАЛОГА ПОСЛЕДНИХ ДНЕЙ (что обсуждали и о чём договорились — помни это, даже если сообщений нет в окне; журналы еды/тренировок смотри через get_progress'` + STALE + String.raw`'):\n' + dialogThread.trim()`;
if (!code.includes('СОСТАВ ТРЕНИРОВОЧНЫХ ДНЕЙ здесь мог устареть')) {
  code = swap(code, H1_OLD, H1_NEW, 'заголовок выжимки');
  code = swap(code, H2_OLD, H2_NEW, 'заголовок нити диалога');
}
// заголовки должны стоять ПОСЛЕ объявления _tpOn, иначе const окажется в «мёртвой зоне»
if (code.indexOf('const _tpOn') < 0 || code.indexOf('const _tpOn') > code.indexOf('ВЫЖИМКА О КЛИЕНТЕ (')) fail('Build Profile Context: _tpOn объявлен позже заголовков');
bpc.parameters.jsCode = code;

// ================= 3) промпт =================
const agent = wf.nodes.find((n) => n.type && n.type.endsWith('.agent')) || fail('нет узла агента');
let sm = agent.parameters.options.systemMessage;
const smBefore = sm;
const VED_END = 'Не уверен, насовсем ли, — спроси. Повторяемость = видимый прогресс.';
const PRIORITY = ' ЧТО ГЛАВНЕЕ. ПРОГРАММА ТРЕНИРОВОК важнее выжимки, нити диалога, плана недели, общего плана и твоих прошлых сообщений в переписке: если они называют другой состав дня — они устарели или ошибочны. Не смешивай источники и не добавляй «по памяти» пресс, кардио или упражнения других дней. ' +
  'Клиент говорит, что раскладка неверна, — СНАЧАЛА training_program get, сверь день по программе и выдай ровно его; своё прошлое сообщение не защищай и не переспрашивай «что именно неправильно», пока не сверился. ' +
  'КАРДИО (эллипс, велотренажёр, дорожка, ходьба, шаги) — отдельно от силовых дней: в раскладку силового дня не вставляй; какое у клиента кардио — строка КАРДИО КЛИЕНТА в профиле; записывается отдельной кардио-тренировкой. ' +
  'НЕТ ПРОГРАММЫ, а клиент тренируется по согласованному плану — предложи зафиксировать его: перечисли состав каждого дня, получи явное «да» и сохрани training_program set; до этого бери состав из последнего согласованного с клиентом плана, а не из журнала и не из своих прошлых раскладок.';
if (!sm.includes('ЧТО ГЛАВНЕЕ. ПРОГРАММА ТРЕНИРОВОК')) sm = swap(sm, VED_END, VED_END + PRIORITY, 'промпт/ведение');
const LW_ANCH = "шаги {activity:'Шаги', kind:'cardio', steps}).";
if (!sm.includes('система сама пишет отдельной кардио-тренировкой')) {
  sm = swap(sm, LW_ANCH, LW_ANCH + ' Кардио и шаги система сама пишет отдельной кардио-тренировкой, силовые — отдельно; в одну тренировку их не своди.', 'промпт/log_workout');
}
agent.parameters.options.systemMessage = sm;

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');

// ================= проверка =================
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(back) ? back[0] : back;
const g = (n) => w.nodes.find((x) => x.name === n) || fail('после записи нет узла ' + n);
let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };

const TOUCHED = new Set(['training_program', 'Build Profile Context', agent.name]);
const bMap = Object.fromEntries(before.nodes.map((n) => [n.name, JSON.stringify(n)]));
const untouchedChanged = w.nodes.filter((n) => !TOUCHED.has(n.name) && bMap[n.name] !== JSON.stringify(n)).map((n) => n.name);
check('посторонние узлы не тронуты' + (untouchedChanged.length ? ': ' + untouchedChanged.join(', ') : ''), untouchedChanged.length === 0);
check('число узлов не изменилось', w.nodes.length === before.nodes.length);
check('связи не тронуты', JSON.stringify(w.connections) === JSON.stringify(before.connections));

const t2 = g('training_program');
check('training_program: поля и схема совпадают, есть cardio', Object.keys(t2.parameters.workflowInputs.value).sort().join() === t2.parameters.workflowInputs.schema.map((c) => c.id).sort().join() && !!t2.parameters.workflowInputs.value.cardio);
check('training_program: описание про кардио и схему подходов', /в days НЕ ставь/.test(t2.parameters.description) && /target/.test(t2.parameters.description));

// Build Profile Context целиком, на подставных данных — как в бою
const code2 = g('Build Profile Context').parameters.jsCode;
const runBPC = (row) => new Function('$', '$input', code2)((n) => ({ first: () => ({ json: n === 'Normalize' ? { message: { text: 'распиши тренировку', from: { id: 1 } } } : row }) }), { first: () => ({ json: {} }) })[0].json.profile_block;
const PROFILE = { language: 'Russian', onboarding_done: true, timezone: 'Europe/Moscow', main_goal: 'сушка', plan_week: 'Пт — День 4' };
const PROG = { version: 2, started_on: '2026-09-11', days: [
  { day: 1, weekday: 'Пн', name: 'Грудь', exercises: [{ name: 'Жим штанги лёжа', target: '4 × 8–12' }, 'Баттерфляй'] },
  { day: 4, weekday: 'Пт', name: 'Верх, отстающие', exercises: [{ name: 'Жим Арнольда', target: '3 × 10–12' }, 'Молотки'] }],
  cardio: [{ name: 'Эллипс', duration_min: 60, when: 'в дни без силовой' }, { name: 'Велотренажёр', duration_min: 30 }] };
let pb = runBPC({ profile: PROFILE, training_program: JSON.stringify(PROG), summary: 'День 4 — Верх + Пресс', dialog_thread: '[2026-09-11] День 4 — жим штанги, баттерфляй' });
check('профиль: программа со схемой подходов', /1\) Жим штанги лёжа — 4 × 8–12, 2\) Баттерфляй/.test(pb) && /День 4 \(обычно Пт\) — Верх, отстающие: 1\) Жим Арнольда — 3 × 10–12, 2\) Молотки/.test(pb));
check('профиль: кардио отдельной строкой, не в днях', /КАРДИО КЛИЕНТА — ОТДЕЛЬНО от силовых дней[^\n]*Эллипс — 60 мин \(в дни без силовой\); Велотренажёр — 30 мин/.test(pb) && !/Молотки, 3\) Эллипс/.test(pb));
check('профиль: выжимка помечена как возможно устаревшая по составу', /ВЫЖИМКА О КЛИЕНТЕ \([^)]*СОСТАВ ТРЕНИРОВОЧНЫХ ДНЕЙ здесь мог устареть/.test(pb));
check('профиль: нить диалога помечена так же', /НИТЬ ДИАЛОГА ПОСЛЕДНИХ ДНЕЙ \([^\n]*СОСТАВ ТРЕНИРОВОЧНЫХ ДНЕЙ здесь мог устареть/.test(pb));
pb = runBPC({ profile: PROFILE, training_program: null, summary: 'цикл дней', dialog_thread: 'что-то' });
check('нет программы: строк программы и кардио нет, пометок на сводках нет', !/ПРОГРАММА ТРЕНИРОВОК \(/.test(pb) && !/КАРДИО КЛИЕНТА/.test(pb) && !/мог устареть/.test(pb) && /ВЫЖИМКА О КЛИЕНТЕ/.test(pb));
pb = runBPC({ profile: PROFILE, training_program: { version: 1, started_on: '2026-08-18', days: [{ day: 1, name: 'А', exercises: ['x'] }] }, summary: '', dialog_thread: '' });
check('старая программа без cardio: не падает, строки кардио нет', /1\) x/.test(pb) && !/КАРДИО КЛИЕНТА/.test(pb));

const sm2 = g(agent.name).parameters.options.systemMessage;
check('промпт: что главнее — программа', sm2.includes('ЧТО ГЛАВНЕЕ. ПРОГРАММА ТРЕНИРОВОК важнее выжимки'));
check('промпт: «неверно» → сначала get', /Клиент говорит, что раскладка неверна, — СНАЧАЛА training_program get/.test(sm2));
check('промпт: кардио отдельно', /КАРДИО \(эллипс, велотренажёр[^)]*\) — отдельно от силовых дней/.test(sm2));
check('промпт: нет программы — зафиксировать согласованную', /НЕТ ПРОГРАММЫ, а клиент тренируется по согласованному плану/.test(sm2));
check('промпт: log_workout пишет кардио отдельно', sm2.includes('система сама пишет отдельной кардио-тренировкой'));
check('выражения {{ }} не сломаны', (sm2.match(/\{\{/g) || []).length === (smBefore.match(/\{\{/g) || []).length && (sm2.match(/\{\{/g) || []).length === (sm2.match(/\}\}/g) || []).length);
const heads = (s) => (s.match(/^=== [^\n]+ ===$/gm) || []).join('|');
check('все блоки промпта на месте', heads(sm2) === heads(smBefore));

if (bad.length) fail('провалено ' + bad.length + ' из ' + total + ' проверок');
console.log('OK ->', OUT, '| проверок пройдено:', total, '| системник', smBefore.length, '->', sm2.length, 'знаков');
