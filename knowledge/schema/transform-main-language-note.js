// Мелкий фикс грамотности: модель путает «ешь» (еда) и «едешь» (движение) — добавляем глобальную заметку.
// Идемпотентно (признак 'ГРАМОТНОСТЬ'). Запуск: node transform-main-language-note.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const agent = wf.nodes.find(n => n.name === 'AI Agent');
let sm = agent.parameters.options.systemMessage;
if (sm.includes('ГРАМОТНОСТЬ')) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const block = "=== ГРАМОТНОСТЬ ===\nПиши грамотно по-русски. Следи за спряжением: не путай глаголы «есть/ешь/поешь/поел» (о еде и питании) и «ехать/едешь/поедешь/поехал» (о движении). О питании всегда «ешь», «сколько раз в день ешь», «что ты ел» — никогда «едешь» в этом смысле.\n\n";
const anchor = "=== ТЕКУЩАЯ ДАТА ===";
if (!sm.includes(anchor)) throw new Error('нет якоря ТЕКУЩАЯ ДАТА');
sm = sm.replace(anchor, block + anchor);
agent.parameters.options.systemMessage = sm;
fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: заметка ГРАМОТНОСТЬ добавлена; systemMessage=' + sm.length);
