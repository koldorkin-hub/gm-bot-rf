// Фикс: узел «Финал: захват» — CTE it не возвращал file_size, а json_build_object на него ссылается.
// Добавляем file_size в RETURNING. Идемпотентно. Запуск: node transform-main-photo-fix-zahvat.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const zx = (wf.nodes || []).find(n => n.name === 'Финал: захват');
if (!zx) { console.error('НЕ найден Финал: захват'); process.exit(1); }
const q = zx.parameters.query;
if (/RETURNING file_id, caption, added_at, file_size/.test(q)) { console.log('уже пропатчено'); }
else if (q.includes('RETURNING file_id, caption, added_at)')) {
  zx.parameters.query = q.replace('RETURNING file_id, caption, added_at)', 'RETURNING file_id, caption, added_at, file_size)');
  console.log('OK: file_size добавлен в RETURNING');
} else { console.error('не найден ожидаемый RETURNING в захвате'); process.exit(1); }
fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
