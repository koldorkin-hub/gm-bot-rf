// Size-guard для фото/картинок-документов. Порог 4.5 МБ (Anthropic отвергает крупнее).
// SINGLE: проверка ДО getFile → большой → вежливый отказ. BATCH: храним file_size, на финализации
// отсеиваем крупные (не роняя пачку), честно считаем сколько не вошло.
// Требует колонку photo_batch_item.file_size (ALTER применяется отдельно).
// Идемпотентно (признак 'Фото: размер?'). Запуск: node transform-main-photo-sizeguard.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Фото: размер?']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const NM = "$('Normalize').first().json.message";
const SIZE = "(" + NM + ".document ? (" + NM + ".document.file_size || 0) : (" + NM + ".photo ? (" + NM + ".photo[" + NM + ".photo.length-1].file_size || 0) : 0))";
const LIMIT = 4500000;

// --- 1. Докопить: хранить file_size (для батч-фильтра) ---
const dk = byName['Фото: докопить'];
if (!/file_size/.test(dk.parameters.query)) {
  dk.parameters.query = "WITH ins AS (INSERT INTO photo_batch_item (bot_id,user_id,file_id,caption,file_size) VALUES ($1,$2,$3,$4,$5) RETURNING 1) UPDATE photo_batch SET last_file_at=now() WHERE bot_id=$1 AND user_id=$2;";
  dk.parameters.options.queryReplacement = dk.parameters.options.queryReplacement.replace(/\]\s*\}\}\s*$/, ", " + SIZE + "] }}");
}

// --- 2. Захват: вернуть file_size в json пачки ---
const zx = byName['Финал: захват'];
zx.parameters.query = zx.parameters.query.replace("json_build_object('file_id',file_id,'caption',caption)", "json_build_object('file_id',file_id,'caption',caption,'file_size',file_size)");

// --- 3. Развернуть: отсеять крупные, посчитать too_big ---
const rz = byName['Финал: развернуть'];
rz.parameters.jsCode = rz.parameters.jsCode
  .replace("const CAP = 10; const dropped = Math.max(0, items.length - CAP); const use = items.slice(0, CAP);",
    "const LIMIT = " + LIMIT + ";\nconst okSize = items.filter(it => !it.file_size || Number(it.file_size) <= LIMIT);\nconst tooBig = items.length - okSize.length;\nconst CAP = 10; const dropped = Math.max(0, okSize.length - CAP); const use = okSize.slice(0, CAP);")
  .replace(/dropped, chat_id, user_id, empty: true/g, "dropped, tooBig, chat_id, user_id, empty: true")
  .replace(/dropped, chat_id, user_id \}/g, "dropped, tooBig, chat_id, user_id }");

// --- 4. Собрать: учесть too_big в тексте ---
const sb = byName['Финал: собрать'];
sb.parameters.jsCode = sb.parameters.jsCode
  .replace("const dropped = (meta[0] && meta[0].dropped) || 0;", "const dropped = (meta[0] && meta[0].dropped) || 0; const tooBig = (meta[0] && meta[0].tooBig) || 0;")
  .replace("if (dropped) parts.push('Ещё '", "if (tooBig) parts.push(tooBig + ' файл(ов) были слишком большими для разбора — попроси прислать их сжатыми или скриншотом.');\nif (dropped) parts.push('Ещё '");

// --- 5. SINGLE: гейт размера перед getFile ---
byName['Фото: размер?'] = { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: 'sz-c', leftValue: "={{ " + SIZE + " <= " + LIMIT + " }}", rightValue: 'true', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} },
  id: 'fc000000-0000-4000-8000-000000000001', name: 'Фото: размер?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [80, 500] };
const big = JSON.parse(JSON.stringify(byName['Голос не распознан']));
big.id = 'fc000000-0000-4000-8000-000000000002'; big.name = 'Фото: большой'; big.position = [300, 420];
big.parameters.bodyParameters.parameters.find(p => p.name === 'text').value =
  'Файл великоват для разбора 📦 Пришли, пожалуйста, сжатым — как обычное фото (не файлом) или скриншот, и я посмотрю.';
byName['Фото: большой'] = big;
wf.nodes.push(byName['Фото: размер?'], big);

// перевязка single: Фото: single?[true] был → Photo: getFile; теперь → Фото: размер? → [ok]getFile [big]большой
conns['Фото: single?'].main[0] = [{ node: 'Фото: размер?', type: 'main', index: 0 }];
conns['Фото: размер?'] = { main: [ [{ node: 'Photo: getFile', type: 'main', index: 0 }], [{ node: 'Фото: большой', type: 'main', index: 0 }] ] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK size-guard: докопить file_size=' + /file_size/.test(dk.parameters.query) + ', single-гейт вставлен');
