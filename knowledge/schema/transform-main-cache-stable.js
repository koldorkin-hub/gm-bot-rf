/**
 * Главный workflow: убрать ВРЕМЯ из кэшируемой части промпта.
 *
 * Факт из консоли Anthropic за месяц: запись в кэш — $255 (63% счёта), чтение — $16.
 * Отношение чтения к записи 0.80 вместо ожидаемых 3–5. Причина: в системный блок
 * (он и есть кэшируемый префикс) попадало время, округлённое до 5 минут, — и префикс
 * менялся ровно с той периодичностью, с какой истекает кэш. Почти каждое сообщение
 * платило за новую запись.
 *
 * Время остаётся ТОЛЬКО в коротком штампе в сообщении пользователя — он не является
 * началом префикса и кэш не рвёт.
 *
 * Прогон:  node schema/transform-main-cache-stable.js <вход.json> <выход.json>
 */
const fs = require('fs');
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-cache-stable.js <in.json> <out.json>'); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const bpc = wf.nodes.find((n) => n.name === 'Build Profile Context') || fail('нет Build Profile Context');
const FROM = "_todayLines.push('СЕГОДНЯ: ' + _DOW[_dow].toUpperCase() + ', ' + _longDate + (_clock ? ', ' + _clock : '') + ' (пояс ' + _tz + ', дата в формате ' + _today + ')');";
const TO   = "// Время намеренно НЕ пишем: этот блок уходит в кэшируемый префикс, и метка времени рвала кэш каждые 5 минут. Время есть в штампе сообщения.\n_todayLines.push('СЕГОДНЯ: ' + _DOW[_dow].toUpperCase() + ', ' + _longDate + ' (пояс ' + _tz + ', дата в формате ' + _today + ')');";
if (bpc.parameters.jsCode.indexOf(FROM) === -1) fail('строка календаря не найдена — код изменился');
bpc.parameters.jsCode = bpc.parameters.jsCode.replace(FROM, () => TO);
fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const c = w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode;
new Function(c);
const sysLines = c.split('\n').filter((l) => l.includes("_todayLines.push('СЕГОДНЯ"));
if (sysLines.some((l) => l.includes('_clock'))) fail('время всё ещё в системном блоке');
if (!c.includes("const todayStamp = 'СЕГОДНЯ '") || !c.includes("(_clock ? ' ' + _clock : '')")) fail('штамп потерял время — а он должен его сохранить');
console.log('OK ->', OUT, '| время убрано из префикса, в штампе осталось');
