/**
 * Главный workflow: предохранитель от срыва генерации вызова инструмента.
 *
 * Что лечим (07.09.2026, найдено на живом диалоге владельца). Изредка модель дописывает
 * вызов инструмента ТЕКСТОМ вместо настоящего вызова: клиент видит служебную разметку
 * (<invoke>, <parameter>, «Calling lookup_food with input: {...}»), а действие при этом
 * не выполняется. Частота по всей истории — 4 случая на 3957 ответов (0.1%), у трёх разных
 * ботов и клиентов, задолго до кнопок и маршрутизации моделей, — то есть это свойство
 * генерации, а не регресс. Ошибкой workflow это не является: для него ответ выглядит
 * обычным текстом, поэтому отличить может только детерминированный код.
 *
 * Что делаем в узле «Ответ: нарезка» (там же, где режется метка кнопок):
 *  1. Ловим разметку вызова и вырезаем её.
 *  2. Если после чистки связного ответа не осталось (короткий обрывок без знаков конца
 *     предложения) — вместо мусора отправляем короткую честную просьбу повторить.
 *     Если ответ по существу есть и утёк лишь хвост тега — оставляем ответ, только чистим:
 *     иначе просьба повторить могла бы задвоить уже выполненную запись.
 *  3. Случай пишем в ops_error (узел «Утечка: журнал»), чтобы он попадал в /diag и была
 *     видна реальная частота. Узел не мешает отправке: он в параллельной ветке и с
 *     continueRegularOutput.
 *
 * Автоматический повторный прогон сознательно НЕ делаем: в общем случае часть действий
 * модель могла уже выполнить, и повтор рискует задвоить записи.
 *
 * Прогон:  node schema/transform-main-toolleak.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-toolleak.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл: ' + from.slice(0, 70)); return s.replace(from, () => to); };

// --- код предохранителя (вставляется в «Ответ: нарезка») ---
const GUARD_SRC = `// --- Предохранитель: срыв генерации вызова инструмента ---
// Модель изредка дописывает вызов ТЕКСТОМ вместо настоящего вызова. Для workflow это
// выглядит обычным ответом, поэтому ловим детерминированно и наружу мусор не отдаём.
function stripToolLeak(text) {
  const leaked = /<\\/?\\s*(?:antml:)?(?:invoke|parameter|function_calls|function_results)\\b[^>]*>/i.test(text)
              || /^[ \\t]*Calling\\s+[A-Za-z_][\\w.-]*\\s*(?:with\\s+input\\s*:|["'>])/im.test(text);
  if (!leaked) return { text: text, leaked: false };
  let t = text
    .replace(/^[ \\t]*Calling\\s+[A-Za-z_][\\w.-]*\\s*(?:with\\s+input\\s*:|["'>]).*$/gim, ' ')
    .replace(/<\\/?\\s*(?:antml:)?(?:invoke|parameter|function_calls|function_results)\\b[^>]*>/gi, ' ')
    .replace(/\\{[^{}]{0,4000}\\}/g, ' ')
    .replace(/[ \\t]{2,}/g, ' ')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
  return { text: t, leaked: true };
}
const LEAK_FALLBACK = 'Секунду — у меня сорвалось на середине, дописать не успел. Повтори, пожалуйста, последнее сообщение 🙏';
const _rawOut = String(($('AI Agent').first().json.output) || '').trim();
const _leak = stripToolLeak(_rawOut);
// Обрывок без знаков конца предложения = ответа по существу не осталось.
const _broken = _leak.leaked && _leak.text.length < 120 && !/[.!?…]/.test(_leak.text);
const _leakNote = _leak.leaked ? _rawOut.replace(/\\s+/g, ' ').slice(0, 400) : '';
`;

const chunk = byName('Ответ: нарезка');
if (chunk.parameters.jsCode.indexOf('stripToolLeak') === -1) {
  let c = chunk.parameters.jsCode;
  // 1) предохранитель — перед разбором кнопок
  c = swap(c, '// Метка кнопок в конце ответа:', GUARD_SRC + '\n// Метка кнопок в конце ответа:');
  // 2) кнопки разбираем уже из очищенного текста (или из подменённого ответа)
  c = swap(c, "const _ex = extractButtons(String(($('AI Agent').first().json.output) || '').trim());",
    'const _ex = extractButtons(_broken ? LEAK_FALLBACK : _leak.text);');
  // 3) признак утечки — на первом куске, для узла журнала
  c = swap(c, 'return parts.map((t, i) => ({ json: { chat_id, text: t, part: i + 1, total: parts.length,',
    "return parts.map((t, i) => ({ json: { chat_id, text: t, part: i + 1, total: parts.length, leak: (i === 0 && _leak.leaked) ? '1' : '', leak_note: (i === 0 && _leak.leaked) ? _leakNote : '',");
  chunk.parameters.jsCode = c;
}

// --- узел журнала: пишем только когда есть признак утечки ---
if (!wf.nodes.find((n) => n.name === 'Утечка: журнал')) {
  wf.nodes.push({
    parameters: {
      operation: 'executeQuery',
      query: 'INSERT INTO ops_error (workflow_name, node_name, message) SELECT $1, $2, $3 WHERE $4 = \'1\';',
      options: {
        queryReplacement:
          "={{ [ 'ИИ Тренер - Telegram Bot', 'Ответ: нарезка', 'Срыв генерации вызова инструмента: разметка утекла в ответ. Клиент ' + $('Load Config').first().json.bot_id + ':' + $('Normalize').first().json.message.from.id + '. Сырой ответ: ' + ($json.leak_note || ''), ($json.leak || '') ] }}",
      },
    },
    id: 'leak-log-0000-4000-8000-000000000001',
    name: 'Утечка: журнал',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [1200, 200],
    credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
    onError: 'continueRegularOutput',
  });
  const prev = (wf.connections['Ответ: нарезка'] && wf.connections['Ответ: нарезка'].main && wf.connections['Ответ: нарезка'].main[0]) || [];
  if (!prev.find((c) => c.node === 'HTTP Request1')) fail('«Ответ: нарезка» не ведёт в HTTP Request1 — схема изменилась');
  // отправка первой, журнал после — чтобы запись в базу не задерживала ответ клиенту
  wf.connections['Ответ: нарезка'] = { main: [prev.concat([{ node: 'Утечка: журнал', type: 'main', index: 0 }])] };
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// ---- проверка ----
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const g = (n) => w.nodes.find((x) => x.name === n) || fail('после записи нет узла ' + n);
const code = g('Ответ: нарезка').parameters.jsCode;
new Function('$', code);
if (!g('Утечка: журнал')) fail('узел журнала не добавлен');
const conn = w.connections['Ответ: нарезка'].main[0].map((c) => c.node);
if (conn[0] !== 'HTTP Request1' || !conn.includes('Утечка: журнал')) fail('связи «Ответ: нарезка» неверны: ' + JSON.stringify(conn));

// самотест: гоняем узел целиком на подставном $() и сверяем, что уходит клиенту
const run = (agentOutput) => {
  const fake = (name) => {
    if (name === 'AI Agent') return { first: () => ({ json: { output: agentOutput } }) };
    if (name === 'Normalize') return { first: () => ({ json: { message: { chat: { id: 1 } } } }) };
    return { first: () => ({ json: {} }) };
  };
  return new Function('$', code)(fake);
};

const REAL_8587 = 'Calling lookup_food with input: {"query":"творог 2%"}\n<invoke name="lookup_food">\n<parameter name="query">творог 2%</parameter>\n</invoke>\n<invoke name="lookup_food">\n<parameter name="query">протеин сывороточный порошок</parameter>\n</invoke>';
const REAL_2149 = 'Calling lookup_food"> <parameter name="query">пиво светлое лагер</parameter> </invoke>';
const REAL_632 = 'Calling Web_Search with input: {"query":"тирзепатид противопоказания"> <parameter name="query">тирзепатид</parameter> </invoke>';
const NORMAL = 'Записал обед 👍\n\n🍽 ОБЕД\nГречка (150 г): 165 ккал\n\nИТОГО: 165 ккал. Хороший выбор!';
const WITH_BUTTONS = 'Какой творог?\n[[кнопки: 5% | 9% | обезжиренный]]';
const GOOD_WITH_STRAY = 'Записал ужин ✅ Творог 200 г — 202 ккал, белок 36 г. Отличный выбор перед сном: казеин усваивается медленно и поддержит белковый синтез ночью. До нормы осталось совсем немного, добери завтраком.</invoke>';

const cases = [
  ['реальный случай 8587 (два вызова текстом)', REAL_8587, 'fallback'],
  ['реальный случай 2149 (обрывок вызова)', REAL_2149, 'fallback'],
  ['реальный случай 632 (веб-поиск текстом)', REAL_632, 'fallback'],
  ['обычный ответ', NORMAL, 'as-is'],
  ['ответ с кнопками', WITH_BUTTONS, 'buttons'],
  ['хороший ответ с одиноким хвостом тега', GOOD_WITH_STRAY, 'cleaned'],
];

let bad = 0;
for (const [name, input, want] of cases) {
  const items = run(input);
  const first = items[0] ? items[0].json : { text: '', leak: '' };
  const sent = String(first.text || '');
  const leak = first.leak === '1';
  let ok = false, why = '';
  if (want === 'fallback') {
    ok = sent.indexOf('сорвалось на середине') !== -1 && leak;
    why = 'ждали подмену на просьбу повторить + признак утечки';
  } else if (want === 'as-is') {
    ok = sent === input && !leak;
    why = 'ждали текст без изменений и без признака утечки';
  } else if (want === 'buttons') {
    const kb = first.reply_markup && first.reply_markup.inline_keyboard;
    ok = !leak && sent === 'Какой творог?' && kb && kb.flat().length === 3;
    why = 'ждали текст без метки и три кнопки';
  } else if (want === 'cleaned') {
    ok = leak && sent.indexOf('</invoke>') === -1 && sent.indexOf('Записал ужин') === 0 && sent.indexOf('сорвалось на середине') === -1;
    why = 'ждали очищенный, но СОХРАНЁННЫЙ ответ (иначе повтор задвоит запись)';
  }
  if (!ok) { bad++; console.log('  ПЛОХО [' + name + ']: ' + why + '\n    получили: ' + JSON.stringify(sent).slice(0, 200) + ' leak=' + leak); }
}
if (bad) fail('предохранитель ошибается в ' + bad + ' случаях из ' + cases.length);
console.log('OK ->', OUT, '| предохранитель проверен на', cases.length, 'случаях (из них 3 — реальные из базы)');
