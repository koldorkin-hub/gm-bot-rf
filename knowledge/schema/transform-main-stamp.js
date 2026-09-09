/**
 * Главный workflow: компактный штамп даты вместо полной справки в сообщении агенту.
 *
 * Обнаружено на живом тесте 20.08.2026: узел памяти сохраняет в n8n_chat_histories
 * ИМЕННО ТОТ текст, который подан агенту. Полная справка (5 строк, ~400 символов)
 * оседала в истории — значит в окне из 40 сообщений копилось 40 блоков со СТАРЫМИ
 * датами и лишние ~16 тысяч символов на каждый вызов. То самое зашумление,
 * ради устранения которого справка и вводилась.
 *
 * Решение: в сообщение агенту идёт ОДНА строка-штамп (~90 символов), а полный
 * календарь с сеткой недели остаётся в системном промпте — он собирается заново
 * на каждый вызов и в историю не попадает.
 *
 * Побочная польза: штампы в истории делают её датированной — «что я ел во вторник»
 * теперь опирается на явную метку каждого прошлого сообщения, а не на догадки.
 *
 * Прогон:  node schema/transform-main-stamp.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-stamp.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл: ' + from.slice(0, 60)); return s.replace(from, () => to); };

// --- короткий штамп рядом с полным календарём ---
const bpc = byName('Build Profile Context') || fail('нет Build Profile Context');
let code = bpc.parameters.jsCode;

code = swap(code,
  "const todayBlock = _todayLines.join('\\n');",
  [
    "const todayBlock = _todayLines.join('\\n');",
    '// Короткая метка для сообщения агенту: она осядет в истории диалога,',
    '// поэтому должна быть дешёвой по символам и однозначной по смыслу.',
    "const todayStamp = 'СЕГОДНЯ ' + _SHORT[_dow] + ' ' + _dmy(_cur) + '.' + _cur.getUTCFullYear() +",
    "  (_clock ? ' ' + _clock : '') + ', вчера ' + _SHORT[_at(-1).getUTCDay()] + ' ' + _dmy(_at(-1)) +",
    "  ', завтра ' + _SHORT[_at(1).getUTCDay()] + ' ' + _dmy(_at(1));",
  ].join('\n'));

code = swap(code,
  'today_date: _today, tz: _tz } }];',
  'today_date: _today, tz: _tz, today_stamp: todayStamp } }];');

bpc.parameters.jsCode = code;

// --- сообщение агенту: одна строка вместо пяти ---
const agent = byName('AI Agent') || fail('нет AI Agent');
agent.parameters.text =
  "={{ '[' + $('Build Profile Context').first().json.today_stamp + ']\\n' " +
  "+ ($json.message?.text || $json['message.text'] || '') }}";

// --- правила: объяснить, что за скобки в начале сообщения ---
const OLD = 'Перед КАЖДЫМ сообщением клиента ты получаешь служебную справку с блоком СЕГОДНЯ: день недели, дата,';
const NEW = [
  'Перед каждым сообщением клиента в квадратных скобках стоит служебный штамп с сегодняшней датой,',
  'а полный календарь (вся неделя по числам, вчера, завтра, день недели, день программы) — в блоке ПРОФИЛЬ выше.',
  'Штампы в скобках у СТАРЫХ сообщений показывают, каким днём было отправлено то сообщение, — это история, не сегодня.',
  'Сегодняшняя дата — только из ПОСЛЕДНЕГО штампа и из календаря в профиле. Обе метки: день недели, дата,',
].join('\n');
agent.parameters.options.systemMessage = swap(agent.parameters.options.systemMessage, OLD, NEW);

// Штамп в скобках клиенту показывать не надо — скажем прямо.
const HIDE = '— Саму справку клиенту не показывай и не цитируй, она служебная.';
agent.parameters.options.systemMessage = swap(agent.parameters.options.systemMessage, HIDE,
  '— Штамп в квадратных скобках и календарь клиенту не показывай и не цитируй, они служебные.');

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const nc = w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode;
new Function(nc);
if (nc.indexOf('today_stamp') === -1) fail('штамп не отдаётся');
const t = w.nodes.find((n) => n.name === 'AI Agent').parameters.text;
if (t.indexOf('today_stamp') === -1) fail('штамп не подставлен в сообщение');
if (t.indexOf('today_block') !== -1) fail('полная справка всё ещё идёт в сообщение');
console.log('OK ->', OUT);
