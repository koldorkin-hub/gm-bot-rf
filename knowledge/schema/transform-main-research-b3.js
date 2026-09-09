// research-B доводка b3: убрать ПОВТОРНЫЙ вопрос о цели после фарма-пивота.
// Было: пивот → awaiting_topic → клиент даёт легальную тему → снова «вопрос цели» (раздражает, цель уже названа).
// Стало: пивот → awaiting_goal с пустой темой → следующий ответ клиента идёт СРАЗУ в запуск (взять цель),
//        query = сам текст (тема самодостаточна). Вопрос цели не повторяется.
// + «взять цель»: query = [topic, text].filter(Boolean).join(' — ') — при пустой теме query = текст (без ведущего тире).
// + текст «к врачу»: убрать обещание «задам вопрос про цель».
// Идемпотентно (признак filter(Boolean) во «взять цель»). Запуск: node transform-main-research-b3.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
let changed = 0;

// 1) взять цель: устойчивая склейка (пустая тема → query = текст)
const vz = byName['Research: взять цель'];
if (vz.parameters.jsCode.includes('filter(Boolean)')) { console.log('взять цель: уже пропатчен'); }
else {
  const FIND = "const query = (topic + (text ? ' — ' + text : '')).trim();";
  const REPL = "const query = [topic, text].filter(Boolean).join(' — ');";
  if (!vz.parameters.jsCode.includes(FIND)) throw new Error('шаблон query во взять цель не найден');
  vz.parameters.jsCode = vz.parameters.jsCode.replace(FIND, REPL);
  changed++; console.log('взять цель: ✓ склейка починена');
}

// 2) легальный пивот: awaiting_topic → awaiting_goal (следующий ответ = сразу запуск)
const pv = byName['Research: легальный пивот'];
if (pv.parameters.query.includes("'awaiting_goal'")) { console.log('пивот: уже awaiting_goal'); }
else {
  pv.parameters.query = pv.parameters.query.replace(/'awaiting_topic'/g, "'awaiting_goal'");
  changed++; console.log('пивот: ✓ → awaiting_goal');
}

// 3) текст «к врачу»: без обещания вопроса о цели
const doc2 = byName['Research: к врачу'].parameters.bodyParameters.parameters.find(p => p.name === 'text');
doc2.value = "Доказательные разборы по рецептурным и гормональным препаратам, стероидам и дозировкам я не делаю — это вне компетенции фитнес-сервиса, такие вопросы решаются с врачом. Попытка не засчитана.\n\nНо легальную часть разберу полноценно — тренировки, питание, восстановление, безрецептурные добавки. Напиши легальную тему для разбора (например: «жиросжигание без препаратов») — и я сразу соберу PDF.";
changed++; console.log('к врачу: ✓ текст обновлён');

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research-b3: изменено ' + changed);
console.log('взять цель query-строка:', vz.parameters.jsCode.split('\n').find(l => l.includes('query =')).trim());
console.log('пивот stage:', pv.parameters.query.match(/'awaiting_\w+'/)[0]);
