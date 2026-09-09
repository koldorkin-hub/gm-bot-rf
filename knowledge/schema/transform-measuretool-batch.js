/**
 * MeasureTool00001: приём НЕСКОЛЬКИХ показателей одним вызовом.
 *
 * Повод — сбой 18.08.2026: клиентка прислала расширенную биохимию, агент начал
 * писать показатели по одному и упёрся в потолок шагов (log_measurement вызван
 * 10 раз подряд — ровно лимит). Разбор не дошёл до конца, клиентка получила отказ.
 *
 * Что меняется: новый вход `items` — JSON-список объектов {metric,value,unit,measured_on}.
 * Одиночный вызов (metric/value/unit/measured_on) продолжает работать как раньше.
 *
 * Тонкость: узел «Снимок веса в профиль» брал значения через .first() — при пачке
 * это записало бы в профиль вес из ПЕРВОГО элемента для каждого. Переведён на .item
 * (парная привязка к своему элементу).
 *
 * Прогон:  node schema/transform-measuretool-batch.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-measuretool-batch.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// --- 1. Триггер: добавить вход items ---
const trig = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger') || fail('нет триггера');
const vals = trig.parameters.workflowInputs.values;
if (!vals.some((v) => v.name === 'items')) vals.push({ name: 'items', type: 'string' });

// --- 2. Нормализация: список или одиночное ---
const norm = byName('Нормализовать') || fail('нет узла Нормализовать');
norm.parameters.jsCode = [
  'const d = $input.first().json;',
  "const today = new Date().toISOString().slice(0, 10);",
  '',
  'const one = (m) => {',
  "  const metric = String(m.metric || '').trim();",
  "  if (!metric) throw new Error('metric пуст');",
  '  const value = Number(m.value);',
  "  if (!isFinite(value)) throw new Error('value не число - ' + m.value);",
  "  let mo = String(m.measured_on || '').trim();",
  '  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(mo)) mo = today;',
  '  if (mo > today) mo = today; // будущая дата = ошибка модели, ставим сегодня',
  "  const unit = String(m.unit || '').trim() || null;",
  '  return { bot_id: d.bot_id, user_id: d.user_id, metric, value, unit, measured_on: mo };',
  '};',
  '',
  '// Пачка: агент шлёт список за один вызов (панель анализов, серия замеров).',
  '// Без этого он писал по одному и упирался в потолок шагов.',
  'let list;',
  "const rawItems = (d.items === undefined || d.items === null) ? '' : d.items;",
  "if (String(rawItems).trim() !== '' && String(rawItems).trim() !== '[]') {",
  '  let arr = rawItems;',
  "  try { if (typeof arr === 'string') arr = JSON.parse(arr); } catch (e) { throw new Error('items не разобрался как JSON'); }",
  "  if (!Array.isArray(arr)) throw new Error('items должен быть списком объектов');",
  "  if (!arr.length) throw new Error('items пуст');",
  "  if (arr.length > 50) throw new Error('слишком много показателей за раз - максимум 50');",
  '  list = arr.map(one);',
  '} else {',
  '  list = [one(d)];',
  '}',
  'return list.map((json) => ({ json }));',
].join('\n');

// --- 3. Снимок веса: .first() -> .item (иначе пачка запишет в профиль чужое значение) ---
const snap = byName('Снимок веса в профиль') || fail('нет узла Снимок веса в профиль');
snap.parameters.options.queryReplacement =
  "={{ [$('Нормализовать').item.json.bot_id, $('Нормализовать').item.json.user_id, " +
  "$('Нормализовать').item.json.value, $('Нормализовать').item.json.measured_on, " +
  "$('Нормализовать').item.json.metric] }}";

// --- 4. Ответ агенту: перечислить всё записанное, одним item ---
const ans = byName('Ответ агенту') || fail('нет узла Ответ агенту');
ans.parameters.assignments.assignments[0].value =
  "={{ 'Записал в трекинг: ' + $('Нормализовать').all()" +
  ".map(i => i.json.metric + ' = ' + i.json.value + (i.json.unit ? ' ' + i.json.unit : '') + ' (' + i.json.measured_on + ')')" +
  ".join('; ') }}";
ans.executeOnce = true;

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// Проверка фактом
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const t = w.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
if (!t.parameters.workflowInputs.values.some((v) => v.name === 'items')) fail('вход items не добавился');
const code = w.nodes.find((n) => n.name === 'Нормализовать').parameters.jsCode;
if (!/items/.test(code)) fail('код нормализации не обновился');
new Function(code);
if (!/\.item\.json/.test(w.nodes.find((n) => n.name === 'Снимок веса в профиль').parameters.options.queryReplacement)) fail('снимок веса не переведён на .item');
if (w.nodes.find((n) => n.name === 'Ответ агенту').executeOnce !== true) fail('ответ агенту не одиночный');
console.log('OK ->', OUT, '| входов:', t.parameters.workflowInputs.values.length, '| код компилируется');
