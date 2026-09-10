/**
 * ПРАВКА БОЕВОГО БОТА, часть 3 из 3: показывать время подхода при чтении журнала.
 *
 * Что сломано. Запрос уже достаёт из базы duration_s (поле 'sec'), но рендер силового
 * подхода умеет только «вес кг×повторы». У планки повторов нет, поэтому даже записанное
 * время клиенту не показывается — он видит «×0» и справедливо считает, что ничего не записано.
 *
 * Скрипт правит либо выгрузку workflow QueryTool (узел «Ответ агенту»), либо исходник
 * knowledge/schema/qt-answer-code.js — определяется по расширению файла.
 * Идемпотентно. Прогон:  node fix-isometric-querytool.js <вход> <выход>
 */
const fs = require('fs');
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node fix-isometric-querytool.js <in> <out>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const OLD = "return name + ': ' + st.map(e => { const w = Number(e.w) || 0; const rp = Number(e.reps) || 0; return w > 0 ? w + ' кг×' + rp : '×' + rp; }).join(', ');";
const NEW = "return name + ': ' + st.map(e => { const w = Number(e.w) || 0; const rp = Number(e.reps) || 0; const sec = Number(e.sec) || 0; "
  + "if (sec > 0) return w > 0 ? w + ' кг×' + sec + ' с' : sec + ' с'; "
  + "return w > 0 ? w + ' кг×' + rp : '×' + rp; }).join(', ');";

const patch = (code, where) => {
  if (code.includes("const sec = Number(e.sec)")) { console.log('~ уже правлено:', where); return code; }
  if (!code.includes(OLD)) fail('в ' + where + ' не найден рендер силового подхода — править руками');
  return code.replace(OLD, NEW);
};

const isJson = IN.toLowerCase().endsWith('.json');
if (isJson) {
  const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const wf = Array.isArray(raw) ? raw[0] : raw;
  const node = wf.nodes.find((n) => String((n.parameters || {}).jsCode || '').includes("st.map(e =>"))
    || fail('не нашёл узел с рендером подходов');
  node.parameters.jsCode = patch(node.parameters.jsCode, 'узле «' + node.name + '»');
  fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');
} else {
  fs.writeFileSync(OUT, patch(fs.readFileSync(IN, 'utf8'), IN), 'utf8');
}

// ---- Проверка фактом: прогоняем сам рендер на трёх видах подходов ----
const out = fs.readFileSync(OUT, 'utf8');
const src = isJson ? JSON.parse(out)[0].nodes.find((n) => String((n.parameters || {}).jsCode || '').includes('st.map(e =>')).parameters.jsCode : out;
const line = src.split('\n').find((l) => l.includes('const sec = Number(e.sec)')) || fail('правка не видна в результате');
const render = new Function('name', 'st', line.trim().replace(/^return /, 'return '));
const cases = [
  ['Планка', [{ sec: 60 }, { sec: 60 }, { sec: 45 }], 'Планка: 60 с, 60 с, 45 с'],
  ['Жим лёжа', [{ w: 45, reps: 8 }, { w: 45, reps: 8 }], 'Жим лёжа: 45 кг×8, 45 кг×8'],
  ['Подтягивания', [{ reps: 10 }], 'Подтягивания: ×10'],
  ['Вис с весом', [{ w: 10, sec: 30 }], 'Вис с весом: 10 кг×30 с'],
];
for (const [name, st, expect] of cases) {
  const got = render(name, st);
  if (got !== expect) fail('рендер «' + name + '»: получилось «' + got + '», ожидалось «' + expect + '»');
}
console.log('OK ->', OUT);
console.log('  проверено на четырёх видах подходов: планка, жим, подтягивания, вис с весом');
