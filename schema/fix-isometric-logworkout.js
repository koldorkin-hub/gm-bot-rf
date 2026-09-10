/**
 * ПРАВКА БОЕВОГО БОТА, часть 2 из 3: запись времени изометрического подхода.
 *
 * Что сломано. В подчинённом workflow «Инструмент — Журнал тренировок», узел «Строки»,
 * силовая ветка собирает строку так:
 *     addRow([... num(s.reps), num(s.weight_kg), num(s.rpe), null, ...])
 * Девятая колонка — duration_s, и в неё жёстко записан null. То есть даже если модель
 * передаст время подхода, оно молча потеряется по дороге в базу. Колонка в таблице есть,
 * записывать в неё просто некому.
 *
 * Работает и со старой версией узла (12 колонок), и с новой (13, с ккал).
 * Идемпотентно. Прогон:  node fix-isometric-logworkout.js <вход.json> <выход.json>
 */
const fs = require('fs');
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node fix-isometric-logworkout.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const node = wf.nodes.find((n) => String((n.parameters || {}).jsCode || '').includes("'strength', sn,"))
  || fail('не нашёл узел, который собирает строки силовых подходов');

let code = node.parameters.jsCode;
const OLD = "num(s.rpe), null,";
const NEW = "num(s.rpe), num(s.duration_s),";

if (code.includes(NEW)) {
  console.log('~ уже правлено');
} else {
  if (!code.includes(OLD)) fail('в узле «' + node.name + '» не найден шаблон силовой строки — править руками');
  const count = code.split(OLD).length - 1;
  if (count !== 1) fail('шаблон встречается ' + count + ' раз, ожидался один — разбираться руками');
  code = code.replace(OLD, NEW);
  node.parameters.jsCode = code;
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');

// ---- Проверка фактом: не «заменилось», а «строка собирается правильно» ----
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(back) ? back[0] : back;
const n2 = w.nodes.find((x) => x.name === node.name);
const c2 = n2.parameters.jsCode;
if (!c2.includes(NEW)) fail('после записи правка не видна');
if (/'strength', sn,[^\]]*?,\s*null,\s*null,\s*null/.test(c2) === false && !c2.includes('num(s.duration_s)')) {
  fail('силовая ветка выглядит неожиданно');
}
// Прогон самой функции на подставных данных: планка 3×60 с должна дать три строки с 60.
const m = c2.match(/const cols = \[([^\]]+)\]/);
if (!m) fail('не разобрать список колонок');
const cols = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
const idx = cols.indexOf('duration_s');
if (idx === -1) fail('в списке колонок нет duration_s');
const sets = [{ duration_s: 60 }, { duration_s: 60 }, { duration_s: 45 }];
const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
const got = sets.map((s) => num(s.duration_s));
if (JSON.stringify(got) !== JSON.stringify([60, 60, 45])) fail('разбор времени подхода не работает');
console.log('OK ->', OUT);
console.log('  узел:', node.name, '| колонка duration_s под номером', idx + 1, 'из', cols.length);
console.log('  проверено: планка 3 подхода (60, 60, 45 с) даёт три строки со временем');
