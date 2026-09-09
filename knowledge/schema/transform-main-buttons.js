/**
 * Главный workflow: кнопки выбора под ответом (inline-клавиатура Telegram).
 *
 * Идея: модель сама решает, когда набор ответов очевиден (жирность творога, приём пищи,
 * «да/нет»), и дописывает ПОСЛЕДНЕЙ строкой служебную метку  [[кнопки: 5% | 9% | обезжиренный]].
 * Код в «Ответ: нарезка» вырезает метку из текста и превращает её в inline-кнопки под
 * последним куском сообщения. Нажатие приходит как callback_query; «Normalize» превращает его
 * в обычное сообщение с текстом кнопки — дальше всё идёт тем же путём, что и напечатанное.
 * Клавиатура клиента не трогается: он может печатать или отправить голосовое.
 *
 * Что меняется:
 *  1. Normalize: Set → Code. message из body.message как раньше; из body.callback_query —
 *     синтезированное сообщение (from = нажавший, chat = чат сообщения с кнопками,
 *     text = подпись кнопки, найденная по callback_data в reply_markup исходного сообщения).
 *     Дополнительно отдаёт callback {id, chat_id, message_id} для ответа Telegram.
 *  2. Новая боковая ветка после Normalize: «Кнопка?» → answerCallbackQuery → editMessageReplyMarkup
 *     (снимает кнопки с сообщения, чтобы не нажимали повторно). Ветка первая по порядку —
 *     в режиме v1 она выполнится до долгого пути через агента, спиннер на кнопке гаснет сразу.
 *  3. «Ответ: нарезка»: парсер метки (терпимый к формату), кнопки только на последнем куске.
 *  4. «HTTP Request1» (sendMessage): тело формой → JSON, reply_markup добавляется только
 *     когда есть (пустая строка в reply_markup Telegram не нравится).
 *  5. Системник: короткий блок «КНОПКИ ВЫБОРА» после блока ФОРМАТ.
 *
 * Отдельно (не в этом скрипте): вебхуки ботов подписаны только на message — нужен setWebhook
 * с allowed_updates ["message","callback_query"], иначе нажатия не доходят.
 *
 * Прогон:  node schema/transform-main-buttons.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-buttons.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл: ' + from.slice(0, 60)); return s.replace(from, () => to); };
const BOT = "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/";

// --- 1. Normalize: Set -> Code, понимает callback_query ---
const NORMALIZE_CODE = `// Вход бота. Обычное сообщение — как есть. Нажатие inline-кнопки (callback_query) —
// превращаем в обычное сообщение с текстом кнопки, чтобы дальше всё шло одним путём.
const b = $('Webhook').first().json.body || {};
if (b.message) return [{ json: { message: b.message } }];
const cq = b.callback_query;
if (!cq) return [{ json: { message: b.message } }];
const m = cq.message || {};
let text = String(cq.data || '').trim();
// callback_data = opt:N; подпись берём из клавиатуры исходного сообщения (Telegram присылает её целиком)
if (/^opt:\\d+$/.test(text) && m.reply_markup && Array.isArray(m.reply_markup.inline_keyboard)) {
  for (const row of m.reply_markup.inline_keyboard) for (const btn of (row || [])) {
    if (btn && btn.callback_data === text) text = String(btn.text || '').trim();
  }
}
if (/^opt:\\d+$/.test(text)) text = '';
const chat = m.chat || { id: cq.from && cq.from.id, type: 'private' };
// message_id синтетический (у сообщения бота свой id, а инструменты используют его как метку источника)
const message_id = Number(String(cq.id || Date.now()).slice(-9)) || Math.floor(Date.now() / 1000);
return [{ json: {
  message: { message_id, from: cq.from, chat, date: Math.floor(Date.now() / 1000), text, via_button: true },
  callback: { id: cq.id, chat_id: chat.id, message_id: m.message_id }
} }];`;

const norm = byName('Normalize');
if (norm.type !== 'n8n-nodes-base.code') {
  norm.type = 'n8n-nodes-base.code';
  norm.typeVersion = 2;
  norm.parameters = { jsCode: NORMALIZE_CODE };
}

// --- 2. боковая ветка: ответить Telegram и снять кнопки ---
if (!wf.nodes.find((n) => n.name === 'Кнопка?')) {
  wf.nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'btn-if-0001', leftValue: '={{ $json.callback !== undefined }}', rightValue: 'true', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: 'btn-if-0000-4000-8000-000000000001', name: 'Кнопка?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [40, -520],
  });
  wf.nodes.push({
    parameters: {
      method: 'POST', url: BOT + 'answerCallbackQuery', sendBody: true,
      bodyParameters: { parameters: [{ name: 'callback_query_id', value: "={{ $('Normalize').first().json.callback.id }}" }] },
      options: { timeout: 10000 },
    },
    id: 'btn-ack-0000-4000-8000-000000000002', name: 'Кнопка: ответить', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [240, -520],
    onError: 'continueRegularOutput',
  });
  wf.nodes.push({
    parameters: {
      method: 'POST', url: BOT + 'editMessageReplyMarkup', sendBody: true,
      bodyParameters: { parameters: [
        { name: 'chat_id', value: "={{ $('Normalize').first().json.callback.chat_id }}" },
        { name: 'message_id', value: "={{ $('Normalize').first().json.callback.message_id }}" },
        { name: 'reply_markup', value: '={{ JSON.stringify({ inline_keyboard: [] }) }}' },
      ] },
      options: { timeout: 10000 },
    },
    id: 'btn-rm-0000-4000-8000-000000000003', name: 'Кнопка: убрать', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [440, -520],
    onError: 'continueRegularOutput',
  });
  // Normalize -> [Кнопка?, Access Gate]: кнопочная ветка ПЕРВОЙ, чтобы спиннер гас до работы агента
  const prev = (wf.connections['Normalize'] && wf.connections['Normalize'].main && wf.connections['Normalize'].main[0]) || [];
  if (!prev.find((c) => c.node === 'Access Gate')) fail('Normalize не ведёт в Access Gate — схема изменилась');
  wf.connections['Normalize'] = { main: [[{ node: 'Кнопка?', type: 'main', index: 0 }].concat(prev)] };
  wf.connections['Кнопка?'] = { main: [[{ node: 'Кнопка: ответить', type: 'main', index: 0 }], []] };
  wf.connections['Кнопка: ответить'] = { main: [[{ node: 'Кнопка: убрать', type: 'main', index: 0 }]] };
}

// --- 3. парсер метки в «Ответ: нарезка» ---
const PARSE_SRC = `// Метка кнопок в конце ответа: [[кнопки: а | б | в]]. Терпимо к формату: без скобок в конце,
// латинское слово, лишние пробелы. Кнопки — только если 2–4 варианта и есть сам текст.
function extractButtons(text) {
  const mk = text.match(/\\n?[ \\t]*\\[\\[\\s*(?:кнопки|варианты|buttons|options|choices)\\s*:\\s*([^\\]\\n]*)\\]?\\]?[ \\t]*$/i);
  if (!mk) return { text, reply_markup: null };
  const body = text.slice(0, mk.index).trim();
  const seen = new Set();
  const labels = mk[1].split('|').map((s) => s.trim().replace(/^[•\\-—–\\s]+/, '').replace(/[.。]+$/, '').trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase())).map((s) => s.slice(0, 40)).slice(0, 4);
  if (labels.length < 2) return { text: body || text, reply_markup: null };
  const oneRow = labels.length <= 3 && labels.every((l) => l.length <= 12);
  const btns = labels.map((l, i) => ({ text: l, callback_data: 'opt:' + (i + 1) }));
  return { text: body || '👇', reply_markup: { inline_keyboard: oneRow ? [btns] : btns.map((b) => [b]) } };
}`;

const chunk = byName('Ответ: нарезка');
if (chunk.parameters.jsCode.indexOf('function extractButtons') === -1) {
  let c = chunk.parameters.jsCode;
  c = swap(c, "const out = String(($('AI Agent').first().json.output) || '').trim();",
    PARSE_SRC + "\nconst _ex = extractButtons(String(($('AI Agent').first().json.output) || '').trim());\nconst out = _ex.text;\nconst reply_markup = _ex.reply_markup;");
  c = swap(c, 'return parts.map((t, i) => ({ json: { chat_id, text: t, part: i + 1, total: parts.length } }));',
    'return parts.map((t, i) => ({ json: { chat_id, text: t, part: i + 1, total: parts.length, reply_markup: (i === parts.length - 1 && reply_markup) ? reply_markup : undefined } }));');
  chunk.parameters.jsCode = c;
}

// --- 4. sendMessage: JSON-тело, reply_markup только когда есть ---
const send = byName('HTTP Request1');
if (send.parameters.specifyBody !== 'json') {
  send.parameters = {
    method: 'POST', url: send.parameters.url, sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: "={{ JSON.stringify(Object.assign({ chat_id: $json.chat_id, text: $json.text }, $json.reply_markup ? { reply_markup: $json.reply_markup } : {})) }}",
    options: send.parameters.options || { timeout: 20000 },
  };
}

// --- 5. блок в системнике ---
const agent = wf.nodes.find((n) => n.type && n.type.includes('.agent')) || fail('нет узла агента');
const sm = agent.parameters.options.systemMessage;
const BLOCK = `=== КНОПКИ ВЫБОРА ===
Когда твой ответ заканчивается вопросом с очевидным коротким набором ответов (жирность или вид продукта, приём пищи, «да/нет», «записать / исправить», выбор из 2–4 вариантов, которые ты сам назвал) — добавь САМОЙ ПОСЛЕДНЕЙ строкой: [[кнопки: вариант | вариант | вариант]]. 2–4 варианта, каждый до 25 знаков, на языке клиента, без эмодзи и точек. Эта строка станет кнопками под сообщением, как текст клиент её не увидит; нажатие придёт тебе обычным сообщением с текстом кнопки. Клиент всегда может написать своё или прислать голосовое. НЕ добавляй кнопки: к открытым вопросам, к темам здоровья, боли и красных флагов, к сообщениям без вопроса, при двух вопросах подряд (кнопки только к последнему).`;
if (sm.indexOf('=== КНОПКИ ВЫБОРА ===') === -1) {
  const anchor = '\n=== ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ КЛИЕНТА ===';
  if (sm.indexOf(anchor) === -1) fail('нет якоря ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ в системнике');
  agent.parameters.options.systemMessage = swap(sm, anchor, '\n' + BLOCK + '\n' + anchor);
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// ---- проверка ----
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const g = (n) => w.nodes.find((x) => x.name === n) || fail('после записи нет узла ' + n);
new Function('$', g('Normalize').parameters.jsCode);
new Function('$', g('Ответ: нарезка').parameters.jsCode);
if (g('Normalize').type !== 'n8n-nodes-base.code') fail('Normalize не Code');
if (!w.connections['Normalize'].main[0].some((c) => c.node === 'Кнопка?') || !w.connections['Normalize'].main[0].some((c) => c.node === 'Access Gate')) fail('связи Normalize');
if (w.connections['Normalize'].main[0][0].node !== 'Кнопка?') fail('кнопочная ветка не первая');
if (g('HTTP Request1').parameters.specifyBody !== 'json' || !g('HTTP Request1').parameters.jsonBody.includes('reply_markup')) fail('sendMessage не переведён на JSON');
if (!g('AI Agent').parameters.options.systemMessage.includes('[[кнопки:')) fail('блок кнопок не в системнике');
const sm2 = g('AI Agent').parameters.options.systemMessage;
if ((sm2.match(/\{\{/g) || []).length !== (sm2.match(/\}\}/g) || []).length) fail('скобки {{ }} в системнике разъехались');

// самотест Normalize на сообщении и на нажатии
const runNorm = (body) => new Function('$', g('Normalize').parameters.jsCode)(() => ({ first: () => ({ json: { body } }) }))[0].json;
const plain = runNorm({ message: { message_id: 5, from: { id: 1 }, chat: { id: 1 }, text: 'привет' } });
if (plain.message.text !== 'привет' || plain.callback) fail('Normalize: обычное сообщение испорчено');
const cb = runNorm({ callback_query: { id: '4382111222333444555', from: { id: 77, first_name: 'T' }, data: 'opt:2',
  message: { message_id: 900, chat: { id: 77, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '5%', callback_data: 'opt:1' }, { text: '9%', callback_data: 'opt:2' }]] } } } });
if (cb.message.text !== '9%' || cb.message.from.id !== 77 || cb.callback.message_id !== 900 || !cb.message.via_button) fail('Normalize: нажатие разобрано неверно: ' + JSON.stringify(cb));
const other = runNorm({ edited_message: { text: 'x' } });
if (other.message !== undefined) fail('Normalize: чужой апдейт должен давать пустое message');

// самотест парсера
const ex = new Function(PARSE_SRC + '\nreturn extractButtons;')();
const cases = [
  ['Записал.\nКакой творог?\n[[кнопки: 5% | 9% | обезжиренный]]', 'Записал.\nКакой творог?', ['5%', '9%', 'обезжиренный'], 1],
  ['Уточни приём пищи:\n[[кнопки: Завтрак | Обед | Ужин | Перекус]]', 'Уточни приём пищи:', ['Завтрак', 'Обед', 'Ужин', 'Перекус'], 4],
  ['Это так?\n[[buttons: Да | Нет', 'Это так?', ['Да', 'Нет'], 1],
  ['Всё записал 👍', 'Всё записал 👍', null, 0],
  ['Хочешь?\n[[кнопки: только один]]', 'Хочешь?', null, 0],
  ['[[кнопки: Да | Нет]]', '👇', ['Да', 'Нет'], 1],
  ['Вопрос?\n[[кнопки: Да | да | Нет]]', 'Вопрос?', ['Да', 'Нет'], 1],
  ['Обсудили [[кнопки: а | б]] в середине текста, и дальше идёт ещё текст.', 'Обсудили [[кнопки: а | б]] в середине текста, и дальше идёт ещё текст.', null, 0],
];
let bad = 0;
cases.forEach(([inp, wantText, wantLabels, wantRows]) => {
  const r = ex(inp);
  const labels = r.reply_markup ? r.reply_markup.inline_keyboard.flat().map((b) => b.text) : null;
  const rows = r.reply_markup ? r.reply_markup.inline_keyboard.length : 0;
  if (r.text !== wantText || JSON.stringify(labels) !== JSON.stringify(wantLabels) || rows !== wantRows) { bad++; console.log('  ПЛОХО: ' + JSON.stringify(inp) + ' -> ' + JSON.stringify(r)); }
});
if (bad) fail('парсер кнопок ошибается в ' + bad + ' случаях');
console.log('OK ->', OUT, '| системник', sm.length, '->', sm2.length, 'знаков | парсер проверен на', cases.length, 'примерах');
