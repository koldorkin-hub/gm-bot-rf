// Фаза 2, подэтап 2.1: ветка ФОТО. message.photo → getFile → download → собрать → тот же AI Agent
// (агент сам прокидывает бинарь-изображение в vision, systemMessage/границы/память применяются нативно).
// Идемпотентно (признак узла 'Photo: getFile'). Запуск: node transform-main-photo-2-1.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Photo: getFile']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }

const TOKEN = "$('Load Config').first().json.bot_token";
const NORMMSG = "$('Normalize').first().json.message";

// --- 1. Узлы ветки ---
byName['Photo: getFile'] = {
  parameters: {
    url: "=https://api.telegram.org/bot{{ " + TOKEN + " }}/getFile?file_id={{ " + NORMMSG + ".photo[" + NORMMSG + ".photo.length - 1].file_id }}",
    options: { timeout: 20000 }
  },
  id: 'f6000000-0000-4000-8000-000000000001', name: 'Photo: getFile',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [-40, 620],
  onError: 'continueErrorOutput', retryOnFail: true
};
byName['Photo: download'] = {
  parameters: {
    url: "=https://api.telegram.org/file/bot{{ " + TOKEN + " }}/{{ $json.result.file_path }}",
    options: { response: { response: { responseFormat: 'file' } }, timeout: 60000 }
  },
  id: 'f6000000-0000-4000-8000-000000000002', name: 'Photo: download',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [180, 620],
  onError: 'continueErrorOutput', retryOnFail: true
};
byName['Photo: собрать'] = {
  parameters: { jsCode:
"const norm = $('Normalize').first().json.message || {};\n" +
"const cap = String(norm.caption || '').trim();\n" +
"const text = cap || 'Клиент прислал фото без подписи. Посмотри, что на нём, и помоги в рамках своих функций (тренировки, техника, питание, прогресс, восстановление) и границ безопасности.';\n" +
"const item = $input.first();\n" +
"const bin = (item.binary && item.binary.data) ? item.binary.data : null;\n" +
"if (!bin) throw new Error('нет бинарника изображения');\n" +
"let mt = String(bin.mimeType || '');\n" +
"if (!/^image\\//.test(mt)) {\n" +
"  let fp = '';\n" +
"  try { fp = String(($('Photo: getFile').first().json.result || {}).file_path || '').toLowerCase(); } catch (e) {}\n" +
"  mt = fp.endsWith('.png') ? 'image/png' : fp.endsWith('.webp') ? 'image/webp' : 'image/jpeg';\n" +
"}\n" +
"return [{ json: { message: Object.assign({}, norm, { text }) }, binary: { data: Object.assign({}, bin, { mimeType: mt, fileName: bin.fileName || 'photo.jpg' }) } }];"
  },
  id: 'f6000000-0000-4000-8000-000000000003', name: 'Photo: собрать',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 620]
};
// клон узла ошибки голоса
const err = JSON.parse(JSON.stringify(byName['Голос не распознан']));
err.id = 'f6000000-0000-4000-8000-000000000004';
err.name = 'Фото: не обработал';
err.position = [180, 800];
const t = err.parameters.bodyParameters.parameters.find(p => p.name === 'text');
t.value = 'Не смог обработать изображение — пришли, пожалуйста, ещё раз или опиши текстом, помогу.';
byName['Фото: не обработал'] = err;

wf.nodes.push(byName['Photo: getFile'], byName['Photo: download'], byName['Photo: собрать'], byName['Фото: не обработал']);

// --- 2. Правило Switch 'photo' на позицию 2 (перед text) ---
const rules = byName['Switch'].parameters.rules.values;
rules.splice(2, 0, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
    conditions: [{ id: 'photo-rule-0001', leftValue: '={{ $json.message.photo !== undefined }}', rightValue: 'true', operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and'
  },
  renameOutput: true, outputKey: 'photo'
});

// --- 3. Перевязка Switch: вставляем выход photo на индекс 2 (text уезжает на 3) ---
conns['Switch'].main.splice(2, 0, [{ node: 'Photo: getFile', type: 'main', index: 0 }]);

// --- 4. Связи ветки фото ---
conns['Photo: getFile'] = { main: [ [{ node: 'Photo: download', type: 'main', index: 0 }], [{ node: 'Фото: не обработал', type: 'main', index: 0 }] ] };
conns['Photo: download'] = { main: [ [{ node: 'Photo: собрать', type: 'main', index: 0 }], [{ node: 'Фото: не обработал', type: 'main', index: 0 }] ] };
conns['Photo: собрать'] = { main: [ [{ node: 'AI Agent', type: 'main', index: 0 }] ] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK photo 2.1: Switch выходов=' + byName['Switch'].parameters.rules.values.length + ', Switch.main=' + JSON.stringify(conns['Switch'].main.map(a => a.map(x => x.node))));
