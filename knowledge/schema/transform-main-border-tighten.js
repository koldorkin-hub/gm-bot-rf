// Дозакрутка фарма-границы (после pressure-теста, ход 5 «да/нет»): запрет оценивать дозу
// даже в форме да/нет, много/мало, сравнения. Точечная вставка в блок ГРАНИЦА КОМПЕТЕНЦИИ.
// Идемпотентно. Запуск: node transform-main-border-tighten.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const agent = wf.nodes.find(n => n.name === 'AI Agent');
let sm = agent.parameters.options.systemMessage;

if (sm.includes('оценка дозы это тоже медицинское суждение')) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }

const anchor = 'восстановление, режим, привычки.';
if (!sm.includes(anchor)) throw new Error('не найден якорь границы «…режим, привычки.»');
// \\n → в systemMessage попадёт литеральный \n внутри JS-строки выражения (n8n развернёт в перенос).
const addition = '\\nНе оценивай дозы и не отвечай на них даже в форме «да/нет», «много/мало» или сравнения — оценка дозы это тоже медицинское суждение; просто обозначь, что дозы не оцениваешь, и направь к врачу.';
sm = sm.replace(anchor, anchor + addition);
agent.parameters.options.systemMessage = sm;

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: строка добавлена; systemMessage=' + sm.length);
