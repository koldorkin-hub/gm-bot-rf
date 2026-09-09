// Фикс: изображения, присланные как ДОКУМЕНТ (message.document, mime image/*), идут в тот же vision-путь,
// что и сжатые фото. PDF/прочие документы — вежливый отказ (PDF = подэтап 2.5).
// Switch: research→voice→photo→docimage→docother→text. FID берёт photo ИЛИ document.file_id.
// Идемпотентно (признак правила docimage). Запуск: node transform-main-photo-doc.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
const rules = byName['Switch'].parameters.rules.values;
if (rules.some(r => r.outputKey === 'docimage')) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }

// --- 1. FID: photo ИЛИ document.file_id (в getFile одиночного пути и в докопить) ---
const OLD_FID = "$('Normalize').first().json.message.photo[$('Normalize').first().json.message.photo.length - 1].file_id";
const NEW_FID = "(($('Normalize').first().json.message.photo) ? $('Normalize').first().json.message.photo[$('Normalize').first().json.message.photo.length - 1].file_id : $('Normalize').first().json.message.document.file_id)";
let patched = [];
for (const nm of ['Photo: getFile', 'Фото: докопить']) {
  const n = byName[nm];
  const target = nm === 'Photo: getFile' ? 'url' : null;
  if (target) { if (n.parameters[target].includes(OLD_FID)) { n.parameters[target] = n.parameters[target].split(OLD_FID).join(NEW_FID); patched.push(nm + '.url'); } }
  else { const qr = n.parameters.options.queryReplacement; if (qr.includes(OLD_FID)) { n.parameters.options.queryReplacement = qr.split(OLD_FID).join(NEW_FID); patched.push(nm + '.qr'); } }
}

// --- 2. Узел вежливого отказа для не-image документов ---
const rej = JSON.parse(JSON.stringify(byName['Голос не распознан']));
rej.id = 'fb000000-0000-4000-8000-000000000001'; rej.name = 'Док: формат'; rej.position = [180, 1000];
rej.parameters.bodyParameters.parameters.find(p => p.name === 'text').value =
  'Такой файл я пока не разбираю 📄 Пришли, пожалуйста, изображение — фото или скриншот, и я посмотрю. (Разбор PDF добавим позже.)';
byName['Док: формат'] = rej; wf.nodes.push(rej);

// --- 3. Правила Switch: docimage + docother на позиции 3,4 (после photo, перед text) ---
function rule(id, key, expr) {
  return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
    conditions: [{ id, leftValue: expr, rightValue: 'true', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
    renameOutput: true, outputKey: key };
}
rules.splice(3, 0,
  rule('docimg-0001', 'docimage', "={{ $json.message.document !== undefined && ($json.message.document.mime_type || '').startsWith('image/') }}"),
  rule('docoth-0001', 'docother', "={{ $json.message.document !== undefined }}"));

// --- 4. Перевязка Switch: docimage(3)→Фото: режим, docother(4)→Док: формат; text уезжает на 5 ---
conns['Switch'].main.splice(3, 0,
  [{ node: 'Фото: режим', type: 'main', index: 0 }],
  [{ node: 'Док: формат', type: 'main', index: 0 }]);

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK photo-doc: FID пропатчен [' + patched.join(', ') + '], Switch.main=' + JSON.stringify(conns['Switch'].main.map(a => a.map(x => x.node))));
