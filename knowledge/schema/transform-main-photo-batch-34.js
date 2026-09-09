// Фаза 2, части 3+4: ветка текста (копит? → сигнал/вопрос) + финализация мульти-image.
// Идемпотентно (признак 'Финал: захват'). Запуск: node transform-main-photo-batch-34.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Финал: захват']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const B = "$('Load Config').first().json.bot_id";
const U = "$('Normalize').first().json.message.from.id";
const TOKEN = "$('Load Config').first().json.bot_token";
function ifCond(id, name, expr, op, pos) {
  return { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: id + '-c', leftValue: expr, rightValue: op.rv !== undefined ? op.rv : '', operator: op.operator }], combinator: 'and' }, options: {} },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos };
}
function pg(id, name, query, qr, pos) {
  return { parameters: { operation: 'executeQuery', query, options: { queryReplacement: qr } },
    id, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG };
}
function code(id, name, js, pos) { return { parameters: { jsCode: js }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos }; }

// ===== ЧАСТЬ 3: ветка текста =====
byName['Текст: копит?'] = pg('f8000000-0000-4000-8000-000000000001', 'Текст: копит?',
  "SELECT EXISTS(SELECT 1 FROM photo_batch WHERE bot_id=$1 AND user_id=$2) AS collecting, (SELECT count(*) FROM photo_batch_item WHERE bot_id=$1 AND user_id=$2) AS items;",
  "={{ [" + B + ", " + U + "] }}", [-260, -360]);
byName['Текст: разбор'] = code('f8000000-0000-4000-8000-000000000002', 'Текст: разбор',
"const st = $('Текст: копит?').first().json || {};\n" +
"const collecting = st.collecting === true || st.collecting === 't';\n" +
"const nItems = Number(st.items) || 0;\n" +
"const msg = $('Normalize').first().json.message || {};\n" +
"const text = String(msg.text || '');\n" +
"const t = text.toLowerCase().trim();\n" +
"const sig = ['готово','готов','всё','все','обработай','обрабатывай','разбери','разберись','разбор','посмотри','глянь','давай','поехали','да','можно','ок','погнали','обрабатывай'];\n" +
"const isSignal = sig.includes(t) || sig.some(s => t === s+'.' || t === s+'!') || /^(готов|всё готов|можно разбир|разбери|обрабат|погнали|давай разбир)/.test(t);\n" +
"let route = 'agent', outText = text;\n" +
"if (collecting && nItems > 0 && isSignal) route = 'finalize';\n" +
"else if (collecting && nItems > 0) { outText = text + '\\n\\n[Для тебя: у клиента ' + nItems + ' файлов ждут разбора в очереди. Ответь на его сообщение и в конце мягко напомни написать «готово», чтобы разобрать их вместе.]'; }\n" +
"return [{ json: { message: Object.assign({}, msg, { text: outText }), route } }];",
  [-40, -360]);
byName['Текст: финал?'] = ifCond('f8000000-0000-4000-8000-000000000003', 'Текст: финал?', "={{ $json.route }}", { operator: { type: 'string', operation: 'equals' }, rv: 'finalize' }, [180, -360]);

// ===== ЧАСТЬ 4: финализация =====
byName['Финал: захват'] = pg('f8000000-0000-4000-8000-000000000010', 'Финал: захват',
  "WITH claimed AS (DELETE FROM photo_batch WHERE bot_id=$1 AND user_id=$2 RETURNING chat_id), it AS (DELETE FROM photo_batch_item WHERE bot_id=$1 AND user_id=$2 AND EXISTS(SELECT 1 FROM claimed) RETURNING file_id, caption, added_at) SELECT (SELECT chat_id FROM claimed) AS chat_id, COALESCE(json_agg(json_build_object('file_id',file_id,'caption',caption) ORDER BY added_at) FILTER (WHERE file_id IS NOT NULL), '[]') AS items FROM it;",
  "={{ [" + B + ", " + U + "] }}", [400, -520]);
byName['Финал: есть?'] = ifCond('f8000000-0000-4000-8000-000000000011', 'Финал: есть?', "={{ $json.chat_id }}", { operator: { type: 'number', operation: 'exists', singleValue: true } }, [620, -520]);
byName['Финал: тихо'] = { parameters: {}, id: 'f8000000-0000-4000-8000-000000000012', name: 'Финал: тихо', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [840, -420] };
byName['Финал: развернуть'] = code('f8000000-0000-4000-8000-000000000013', 'Финал: развернуть',
"const row = $('Финал: захват').first().json;\n" +
"let items = row.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e){ items = []; } }\n" +
"items = items || [];\n" +
"const CAP = 10; const dropped = Math.max(0, items.length - CAP); const use = items.slice(0, CAP);\n" +
"const chat_id = row.chat_id; const user_id = $('Normalize').first().json.message.from.id;\n" +
"if (!use.length) return [{ json: { file_id: '', caption: '', idx: 0, total: 0, dropped, chat_id, user_id, empty: true } }];\n" +
"return use.map((it, i) => ({ json: { file_id: it.file_id, caption: it.caption || '', idx: i, total: use.length, dropped, chat_id, user_id } }));",
  [840, -600]);
byName['Финал: getFile'] = { parameters: { url: "=https://api.telegram.org/bot{{ " + TOKEN + " }}/getFile?file_id={{ $json.file_id }}", options: { timeout: 20000 } },
  id: 'f8000000-0000-4000-8000-000000000014', name: 'Финал: getFile', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1060, -600], onError: 'continueRegularOutput', retryOnFail: true };
byName['Финал: download'] = { parameters: { url: "=https://api.telegram.org/file/bot{{ " + TOKEN + " }}/{{ $json.result.file_path }}", options: { response: { response: { responseFormat: 'file' } }, timeout: 60000 } },
  id: 'f8000000-0000-4000-8000-000000000015', name: 'Финал: download', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1280, -600], onError: 'continueRegularOutput', retryOnFail: true };
byName['Финал: собрать'] = code('f8000000-0000-4000-8000-000000000016', 'Финал: собрать',
"const all = $input.all();\n" +
"const meta = $('Финал: развернуть').all().map(x => x.json);\n" +
"const chat_id = meta[0] && meta[0].chat_id; const user_id = meta[0] && meta[0].user_id; const dropped = (meta[0] && meta[0].dropped) || 0;\n" +
"const binary = {}; let valid = 0, failed = 0; const captions = [];\n" +
"all.forEach((it, i) => {\n" +
"  if (it.binary && it.binary.data && !(meta[i] && meta[i].empty)) {\n" +
"    const bd = it.binary.data; let mt = String(bd.mimeType || ''); if (!/^image\\//.test(mt)) mt = 'image/jpeg';\n" +
"    binary['img' + valid] = Object.assign({}, bd, { mimeType: mt, fileName: 'photo' + valid + '.jpg' }); valid++;\n" +
"    const cap = meta[i] && meta[i].caption; if (cap) captions.push(cap);\n" +
"  } else if (!(meta[i] && meta[i].empty)) { failed++; }\n" +
"});\n" +
"const parts = [];\n" +
"if (valid > 1) parts.push('Клиент прислал ' + valid + ' файлов одной пачкой — посмотри их ВМЕСТЕ и дай ОДИН связный разбор, а не по каждому отдельно.');\n" +
"else if (valid === 1) parts.push('Клиент прислал файл на разбор — посмотри и помоги в рамках своих функций и границ.');\n" +
"else parts.push('Не удалось открыть ни одного из присланных файлов — извинись по-человечески и попроси прислать их ещё раз.');\n" +
"if (captions.length) parts.push('Подписи клиента: ' + captions.join(' | '));\n" +
"if (failed) parts.push(failed + ' файл(ов) из пачки не удалось открыть — честно учти это в ответе.');\n" +
"if (dropped) parts.push('Ещё ' + dropped + ' файлов сверх лимита не вошли — попроси прислать их отдельной пачкой.');\n" +
"const msg = { from: { id: user_id }, chat: { id: chat_id }, text: parts.join('\\n') };\n" +
"const out = { json: { message: msg } };\n" +
"if (valid > 0) out.binary = binary;\n" +
"return [out];",
  [1500, -600]);

wf.nodes.push(byName['Текст: копит?'], byName['Текст: разбор'], byName['Текст: финал?'], byName['Финал: захват'], byName['Финал: есть?'], byName['Финал: тихо'], byName['Финал: развернуть'], byName['Финал: getFile'], byName['Финал: download'], byName['Финал: собрать']);

// ===== Перевязка =====
// Switch[text] (индекс 3) теперь → Текст: копит?  (было → AI Agent)
conns['Switch'].main[3] = [{ node: 'Текст: копит?', type: 'main', index: 0 }];
conns['Текст: копит?'] = { main: [[{ node: 'Текст: разбор', type: 'main', index: 0 }]] };
conns['Текст: разбор'] = { main: [[{ node: 'Текст: финал?', type: 'main', index: 0 }]] };
conns['Текст: финал?'] = { main: [ [{ node: 'Финал: захват', type: 'main', index: 0 }], [{ node: 'AI Agent', type: 'main', index: 0 }] ] };
conns['Финал: захват'] = { main: [[{ node: 'Финал: есть?', type: 'main', index: 0 }]] };
conns['Финал: есть?'] = { main: [ [{ node: 'Финал: развернуть', type: 'main', index: 0 }], [{ node: 'Финал: тихо', type: 'main', index: 0 }] ] };
conns['Финал: развернуть'] = { main: [[{ node: 'Финал: getFile', type: 'main', index: 0 }]] };
conns['Финал: getFile'] = { main: [[{ node: 'Финал: download', type: 'main', index: 0 }]] };
conns['Финал: download'] = { main: [[{ node: 'Финал: собрать', type: 'main', index: 0 }]] };
conns['Финал: собрать'] = { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK photo-batch-34: Switch[text]→' + conns['Switch'].main[3][0].node + ', узлов+10');
