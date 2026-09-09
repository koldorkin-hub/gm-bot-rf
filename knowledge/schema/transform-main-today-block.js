/**
 * Главный workflow: лечение вечной путаницы с датой и днём недели.
 *
 * Симптом (20.08.2026, диалог владельца): в профиле стояло верное
 * «2026-08-20 10:20 (четверг)», а бот написал «четверг 21.08», потом «среда 20.08»,
 * потом заявил, что «профиль ещё не обновился», потому что клиент сказал «доброе утро».
 *
 * Три причины, все три чинятся здесь:
 *  1. Дата лежала в СЕРЕДИНЕ системного промпта (позиция ~18k из 32k), а сообщению
 *     агента доставался только текст клиента. После промпта идут 40 сообщений истории
 *     со старыми датами — свежесть проигрывает. Теперь календарь идёт ВПЛОТНУЮ
 *     перед сообщением клиента, в самой заметной позиции.
 *  2. Боту приходилось ВЫЧИСЛЯТЬ: день недели, вчера/завтра, номер дня программы.
 *     Теперь всё посчитано кодом и выложено готовым — вычислять нечего.
 *  3. Дата и день недели считались из РАЗНЫХ источников (округлённое до 5 минут время
 *     и отдельный вызов toLocaleDateString) — могли разойтись на границе суток.
 *     Теперь оба из одной строки календарной даты клиента.
 *
 * Прогон:  node schema/transform-main-today-block.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-today-block.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// ---------------------------------------------------------------- 1. календарь
const bpc = byName('Build Profile Context') || fail('нет узла Build Profile Context');
let code = bpc.parameters.jsCode;

const FROM = "const _tz = (prof.timezone && String(prof.timezone).trim()) || 'Europe/Moscow';";
const TILL = 'const dir = [];';
const a = code.indexOf(FROM);
const b = code.indexOf(TILL);
if (a === -1 || b === -1 || b <= a) fail('не нашёл прежний блок вычисления даты — код узла изменился, править вручную');

const NEW_DATE_CODE = [
  "const _tz = (prof.timezone && String(prof.timezone).trim()) || 'Europe/Moscow';",
  '',
  '// Календарная дата клиента — ЕДИНСТВЕННЫЙ источник и для даты, и для дня недели.',
  '// Раньше они брались из разных вызовов и могли разойтись на границе суток.',
  "let _today = '';",
  "try { _today = new Date().toLocaleString('sv-SE', { timeZone: _tz }).slice(0, 10); }",
  "catch (e) { _today = new Date().toISOString().slice(0, 10); }",
  '',
  '// Время округляем до 5 минут — минутная метка ломала бы кэш промпта.',
  "let _clock = '';",
  'try {',
  '  const _r = new Date(Math.floor(Date.now() / 300000) * 300000);',
  "  _clock = _r.toLocaleString('sv-SE', { timeZone: _tz }).slice(11, 16);",
  "} catch (e) { _clock = ''; }",
  '',
  "const _DOW = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];",
  "const _SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];",
  "const _MON = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];",
  '',
  '// Полдень по UTC — чтобы сдвиг пояса никогда не перекинул дату на соседнюю.',
  "const _base = Date.parse(_today + 'T12:00:00Z');",
  'const _at = (shift) => new Date(_base + shift * 86400000);',
  "const _dmy = (d) => String(d.getUTCDate()).padStart(2,'0') + '.' + String(d.getUTCMonth()+1).padStart(2,'0');",
  '',
  'const _cur = _at(0);',
  'const _dow = _cur.getUTCDay();',
  "const _longDate = _cur.getUTCDate() + ' ' + _MON[_cur.getUTCMonth()] + ' ' + _cur.getUTCFullYear();",
  '',
  '// Неделя целиком: боту не нужно считать, какой день каким числом.',
  'const _mondayShift = (_dow === 0 ? -6 : 1 - _dow);',
  'const _week = [];',
  'for (let i = 0; i < 7; i++) {',
  '  const d = _at(_mondayShift + i);',
  '  const mark = (d.getUTCDay() === _dow);',
  "  _week.push((mark ? '[' : '') + _SHORT[d.getUTCDay()] + ' ' + _dmy(d) + (mark ? ' — СЕГОДНЯ]' : ''));",
  '}',
  '',
  'const _todayLines = [];',
  "_todayLines.push('СЕГОДНЯ: ' + _DOW[_dow].toUpperCase() + ', ' + _longDate + (_clock ? ', ' + _clock : '') + ' (пояс ' + _tz + ', дата в формате ' + _today + ')');",
  "_todayLines.push('ТЕКУЩАЯ НЕДЕЛЯ: ' + _week.join(' · '));",
  "_todayLines.push('ВЧЕРА: ' + _DOW[_at(-1).getUTCDay()] + ' ' + _dmy(_at(-1)) + '. ЗАВТРА: ' + _DOW[_at(1).getUTCDay()] + ' ' + _dmy(_at(1)) + '.');",
  '',
  'if (has(prof.plan_started_on)) {',
  '  try {',
  "    const _ps = String(prof.plan_started_on).slice(0, 10);",
  "    const _dn = Math.floor((Date.parse(_today + 'T00:00:00Z') - Date.parse(_ps + 'T00:00:00Z')) / 86400000) + 1;",
  '    if (isFinite(_dn) && _dn >= 1) {',
  '      const _wk = Math.floor((_dn - 1) / 7) + 1;',
  "      _todayLines.push('ПРОГРАММА: сегодня ДЕНЬ ' + _dn + ', НЕДЕЛЯ ' + _wk + ' (старт ' + _ps + '). Это единственный источник номера дня и недели — не пересчитывай.');",
  '    }',
  '  } catch (e) {}',
  '}',
  '',
  "const todayBlock = _todayLines.join('\\n');",
  'lines.unshift(todayBlock);',
  '',
].join('\n');

code = code.slice(0, a) + NEW_DATE_CODE + code.slice(b);

// Отдаём календарь отдельным полем — его подставим прямо перед сообщением клиента.
const RET_OLD = 'return [{ json: { message: msg, profile_block: block } }];';
const RET_NEW = 'return [{ json: { message: msg, profile_block: block, today_block: todayBlock } }];';
if (code.indexOf(RET_OLD) === -1) fail('не нашёл возврат узла — править вручную');
code = code.replace(RET_OLD, () => RET_NEW);
bpc.parameters.jsCode = code;

// ---------------------------------------------------------------- 2. в сообщение агенту
// Самая заметная позиция — вплотную к реплике клиента, а не в середине системника.
const agent = byName('AI Agent') || fail('нет узла AI Agent');
agent.parameters.text =
  "={{ '[СЛУЖЕБНАЯ СПРАВКА — не показывай клиенту, не пересчитывай, она верна на сейчас]\\n' " +
  "+ $('Build Profile Context').first().json.today_block " +
  "+ '\\n\\n[СООБЩЕНИЕ КЛИЕНТА]\\n' + ($json.message?.text || $json['message.text'] || '') }}";

// ---------------------------------------------------------------- 3. правила
// Прежние инструкции ссылались на строку «СЕЙЧАС У КЛИЕНТА» — её больше нет,
// иначе агент искал бы в промпте несуществующий ориентир.
// Замена ТОЛЬКО функцией: спецпаттерны $' в строке замены молча портят текст (грабля п.9).
const OLD_REF = 'СЕЙЧАС У КЛИЕНТА';
let smFixed = agent.parameters.options.systemMessage;
let refs = 0;
while (smFixed.indexOf(OLD_REF) !== -1) {
  smFixed = smFixed.replace(OLD_REF, () => 'СЕГОДНЯ');
  refs++;
  if (refs > 50) fail('слишком много замен — что-то не так');
}
agent.parameters.options.systemMessage = smFixed;
console.log('переименовано ссылок на прежнюю строку даты:', refs);

const MARK = '=== ДАТА И ДЕНЬ НЕДЕЛИ (жёстко) ===';
const sm = agent.parameters.options.systemMessage;
if (sm.indexOf(MARK) === -1) {
  const block = [
    '',
    '',
    MARK,
    'Перед КАЖДЫМ сообщением клиента ты получаешь служебную справку с блоком СЕГОДНЯ: день недели, дата,',
    'вся текущая неделя по числам, вчера, завтра, номер дня и недели программы. Это ЕДИНСТВЕННЫЙ источник.',
    'Правила без исключений:',
    '— НЕ вычисляй день недели, дату, «вчера/завтра» и номер дня программы сам. Всё уже посчитано, просто читай.',
    '— Справка пересчитывается заново на каждое сообщение и ВСЕГДА актуальна. Заявлять, что она устарела,',
    '  что «профиль не обновился» или что «наступил новый день» — ЗАПРЕЩЕНО.',
    '— Слова клиента «доброе утро», «привет», «спокойной ночи» НЕ меняют дату. Дата только из справки.',
    '— Даты, которые встречаются в истории переписки, относятся к ПРОШЛЫМ дням. Сегодняшняя дата — только из справки.',
    '— Если клиент говорит, что дата другая, — не спорь и не выдумывай: назови дату из справки и предложи',
    '  проверить часовой пояс в профиле. Расхождение возможно только из-за пояса, больше ни из-за чего.',
    '— Саму справку клиенту не показывай и не цитируй, она служебная.',
    'Перед тем как назвать любую дату или день недели, сверься со строкой СЕГОДНЯ. Ошибка здесь ломает',
    'весь план тренировок, поэтому цена у неё высокая.',
  ].join('\n');
  agent.parameters.options.systemMessage = sm + block;
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// ---------------------------------------------------------------- проверка
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const nc = w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode;
new Function(nc);
if (nc.indexOf('today_block') === -1) fail('поле today_block не отдаётся');
if (nc.indexOf('ТЕКУЩАЯ НЕДЕЛЯ') === -1) fail('календарь недели не собран');
if (nc.indexOf('СЕЙЧАС У КЛИЕНТА') !== -1) fail('прежняя строка даты осталась — будет два разных источника');
const t = w.nodes.find((n) => n.name === 'AI Agent').parameters.text;
if (t.indexOf('today_block') === -1) fail('календарь не попал в сообщение агенту');
if (w.nodes.find((n) => n.name === 'AI Agent').parameters.options.systemMessage.indexOf(MARK) === -1) fail('правила не добавлены');
console.log('OK ->', OUT, '| код BPC', nc.length, 'симв, компилируется');
