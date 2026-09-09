// #2 research-B: стейт-машина интейка разбора.
// Таблица research_state(bot_id,user_id,stage,topic,chat_id,started_at) PK(bot_id,user_id).
// stage: awaiting_topic (ждём тему) / awaiting_goal (ждём цель) / running (идёт разбор).
//
// A) Ранний гейт занятости: Пущен?[true] -> Research: занят? -> занят! -> [running] подожди / [нет] Load Profile.
// B) /research: Switch out0 -> Research: старт -> есть тема? -> [да] сохранить тему+спросить цель / [нет] ждём тему + спроси тему.
// C) Текст+голос: Switch out5 / Edit Fields -> Research: интейк? -> маршрут:
//      awaiting_topic -> взять тему -> сохранить тему -> спросить цель (агент) ;
//      awaiting_goal  -> взять цель -> списать лимит -> [ok] пометить running + ушёл искать -> цикл ;
//      none           -> обычный? -> [голос] AI Agent / [текст] Текст: копит?.
// D) Снятие running: успех/возврат/к врачу/лимит/не смог -> снять running (DELETE строки).
// Цикл теперь берёт query из «Research: взять цель», а не из /research-текста.
//
// Идемпотентно (признак 'Research: занят?'). Запуск: node transform-main-research-b.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Research: занят?']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const BOT = "$('Load Config').first().json.bot_id";
const UID = "$('Normalize').first().json.message.from.id";
const CHAT = "$('Normalize').first().json.message.chat.id";
let idc = 0; const nid = () => 'db000000-0000-4000-8000-' + String(++idc).padStart(12, '0');

function pg(name, query, qr, pos) {
  return { parameters: { operation: 'executeQuery', query, options: qr ? { queryReplacement: qr } : {} },
    id: nid(), name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG };
}
function ifBool(name, expr, pos) {
  return { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: name + '-c', leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    id: nid(), name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos };
}
function code(name, js, pos) {
  return { parameters: { jsCode: js }, id: nid(), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos };
}
function sendMsg(name, textExpr, pos) {
  const n = JSON.parse(JSON.stringify(byName['Голос не распознан']));
  n.id = nid(); n.name = name; n.position = pos;
  n.parameters.bodyParameters.parameters.find(p => p.name === 'text').value = textExpr;
  return n;
}
function setText(name, textExpr, pos) {
  const n = JSON.parse(JSON.stringify(byName['Edit Fields']));
  n.id = nid(); n.name = name; n.position = pos;
  n.parameters.assignments.assignments = [{ id: name + '-a', name: 'message.text', value: textExpr, type: 'string' }];
  return n;
}
const add = [];

// === A) ранний гейт занятости ===
const zanyat = pg('Research: занят?',
  "SELECT EXISTS(SELECT 1 FROM research_state WHERE bot_id=$1 AND user_id=$2 AND stage='running') AS busy;",
  "={{ [" + BOT + ", " + UID + "] }}", [-940, -40]);
const zanyatIf = ifBool('Research: занят!', "={{ $json.busy }}", [-740, -40]);
const podozhdi = sendMsg('Research: подожди', "Секунду, ещё ищу — как найду, сразу пришлю разбор. Потом продолжим 🙏", [-540, 120]);
add.push(zanyat, zanyatIf, podozhdi);

// === B) /research entry ===
const start = code('Research: старт',
  "const t = String($('Normalize').first().json.message.text||'').replace(/^\\/research/i,'').trim();\n" +
  "return [{ json: { topic: t, hasTopic: t.length>0 } }];", [-260, 760]);
const hasTopicIf = ifBool('Research: есть тема?', "={{ $json.hasTopic }}", [-60, 760]);
const zhdemTemu = pg('Research: ждём тему',
  "INSERT INTO research_state(bot_id,user_id,stage,topic,chat_id,started_at) VALUES ($1,$2,'awaiting_topic',NULL,$3,now())\n" +
  "ON CONFLICT (bot_id,user_id) DO UPDATE SET stage='awaiting_topic', topic=NULL, chat_id=$3, started_at=now();",
  "={{ [" + BOT + ", " + UID + ", " + CHAT + "] }}", [160, 900]);
add.push(start, hasTopicIf, zhdemTemu);

// === Shared: сохранить тему + спросить цель (агент) ===
const savTopic = pg('Research: сохранить тему',
  "INSERT INTO research_state(bot_id,user_id,stage,topic,chat_id,started_at) VALUES ($1,$2,'awaiting_goal',$3,$4,now())\n" +
  "ON CONFLICT (bot_id,user_id) DO UPDATE SET stage='awaiting_goal', topic=$3, chat_id=$4, started_at=now()\n" +
  "RETURNING topic;",
  "={{ [" + BOT + ", " + UID + ", $json.topic, " + CHAT + "] }}", [160, 640]);
const askGoal = setText('Research: спросить цель',
  "=Клиент просит доказательный разбор по теме «{{ $json.topic }}». Задай ему ОДИН короткий уточняющий вопрос: для чего именно ему это нужно — цель (с учётом его профиля). Только вопрос, ничего пока не разбирай и инструменты не вызывай.",
  [380, 640]);
add.push(savTopic, askGoal);

// === C) интейк-чек (текст+голос) ===
const intake = pg('Research: интейк?',
  "SELECT COALESCE((SELECT stage FROM research_state WHERE bot_id=$1 AND user_id=$2 AND stage IN ('awaiting_topic','awaiting_goal')),'none') AS stage,\n" +
  "       (SELECT topic FROM research_state WHERE bot_id=$1 AND user_id=$2) AS topic;",
  "={{ [" + BOT + ", " + UID + "] }}", [640, 300]);
const marshrut = { parameters: { rules: { values: [
    { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
        conditions: [{ id: 'm0', leftValue: '={{ $json.stage }}', rightValue: 'awaiting_topic', operator: { type: 'string', operation: 'equals' } }] }, renameOutput: true, outputKey: 'topic' },
    { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
        conditions: [{ id: 'm1', leftValue: '={{ $json.stage }}', rightValue: 'awaiting_goal', operator: { type: 'string', operation: 'equals' } }] }, renameOutput: true, outputKey: 'goal' }
  ] }, options: { fallbackOutput: 'extra' } },
  id: nid(), name: 'Research: маршрут', type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [860, 300] };
const obychnyIf = ifBool('Research: обычный?', "={{ $('Normalize').first().json.message.voice !== undefined }}", [1080, 440]);
add.push(intake, marshrut, obychnyIf);

// === взять тему / взять цель (источник текста по типу сообщения) ===
const SRC = "const norm = $('Normalize').first().json.message;\n" +
  "const isVoice = norm.voice !== undefined;\n" +
  "const text = (isVoice ? ($('Edit Fields').first().json.message.text||'') : (norm.text||'')).trim();\n";
const takeTopic = code('Research: взять тему', SRC + "return [{ json: { topic: text } }];", [860, 120]);
const takeGoal = code('Research: взять цель',
  SRC + "const topic = String($('Research: интейк?').first().json.topic||'').trim();\n" +
  "const query = (topic + (text ? ' — ' + text : '')).trim();\n" +
  "return [{ json: { goal: text, topic, query } }];", [860, 560]);
add.push(takeTopic, takeGoal);

// === пометить running + ушёл искать ===
const markRun = pg('Research: пометить running',
  "UPDATE research_state SET stage='running', started_at=now() WHERE bot_id=$1 AND user_id=$2;",
  "={{ [" + BOT + ", " + UID + "] }}", [640, 1120]);
const ushel = sendMsg('Research: ушёл искать',
  "🔍 Ушёл искать — вернусь с разбором через несколько минут. Задачу держу, из головы отвечать не буду. Просто подожди.",
  [860, 1120]);
add.push(markRun, ushel);

// === D) снять running ===
const clearRun = pg('Research: снять running',
  "DELETE FROM research_state WHERE bot_id=$1 AND user_id=$2;",
  "={{ [" + BOT + ", " + UID + "] }}", [2200, 900]);
add.push(clearRun);

add.forEach(n => { byName[n.name] = n; wf.nodes.push(n); });

// ================= перевязка =================
// A) Пущен?[true] был → Load Profile; теперь → Research: занят?
conns['Пущен?'].main[0] = [{ node: 'Research: занят?', type: 'main', index: 0 }];
conns['Research: занят?'] = { main: [[{ node: 'Research: занят!', type: 'main', index: 0 }]] };
conns['Research: занят!'] = { main: [ [{ node: 'Research: подожди', type: 'main', index: 0 }], [{ node: 'Load Profile', type: 'main', index: 0 }] ] };

// B) Switch out0 (research) был → Research: тема?; теперь → Research: старт
conns['Switch'].main[0] = [{ node: 'Research: старт', type: 'main', index: 0 }];
conns['Research: старт'] = { main: [[{ node: 'Research: есть тема?', type: 'main', index: 0 }]] };
conns['Research: есть тема?'] = { main: [ [{ node: 'Research: сохранить тему', type: 'main', index: 0 }], [{ node: 'Research: ждём тему', type: 'main', index: 0 }] ] };
conns['Research: ждём тему'] = { main: [[{ node: 'Research: спроси тему', type: 'main', index: 0 }]] };

// Shared
conns['Research: сохранить тему'] = { main: [[{ node: 'Research: спросить цель', type: 'main', index: 0 }]] };
conns['Research: спросить цель'] = { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] };

// C) текст: Switch out5 был → Текст: копит?; теперь → Research: интейк?
conns['Switch'].main[5] = [{ node: 'Research: интейк?', type: 'main', index: 0 }];
// голос: Edit Fields был → AI Agent; теперь → Research: интейк?
conns['Edit Fields'] = { main: [[{ node: 'Research: интейк?', type: 'main', index: 0 }]] };
conns['Research: интейк?'] = { main: [[{ node: 'Research: маршрут', type: 'main', index: 0 }]] };
conns['Research: маршрут'] = { main: [
  [{ node: 'Research: взять тему', type: 'main', index: 0 }],   // awaiting_topic
  [{ node: 'Research: взять цель', type: 'main', index: 0 }],   // awaiting_goal
  [{ node: 'Research: обычный?', type: 'main', index: 0 }]      // none (fallback)
] };
conns['Research: обычный?'] = { main: [ [{ node: 'AI Agent', type: 'main', index: 0 }], [{ node: 'Текст: копит?', type: 'main', index: 0 }] ] };

// взять тему → сохранить тему (общий)
conns['Research: взять тему'] = { main: [[{ node: 'Research: сохранить тему', type: 'main', index: 0 }]] };
// взять цель → списать лимит
conns['Research: взять цель'] = { main: [[{ node: 'Research: списать лимит', type: 'main', index: 0 }]] };

// вставка running-пометки: Лимит не исчерпан?[true] был → Research: завести попытку; теперь → пометить running → ушёл искать → завести попытку
const limitTrue = conns['Лимит не исчерпан?'].main[0]; // [{node:'Research: завести попытку'...}]
conns['Лимит не исчерпан?'].main[0] = [{ node: 'Research: пометить running', type: 'main', index: 0 }];
conns['Research: пометить running'] = { main: [[{ node: 'Research: ушёл искать', type: 'main', index: 0 }]] };
conns['Research: ушёл искать'] = { main: [ limitTrue ] };

// цикл берёт query из «Research: взять цель»
byName['Research: цикл'].parameters.workflowInputs.value.query = "={{ $('Research: взять цель').first().json.query }}";

// D) снять running на терминалах
for (const term of ['Research: отметить успех','Research: вернуть попытку','Research: к врачу','Research: лимит исчерпан','Research: не смог запустить']) {
  if (byName[term]) {
    const ex = (conns[term] && conns[term].main && conns[term].main[0]) ? conns[term].main[0] : [];
    conns[term] = { main: [ ex.concat([{ node: 'Research: снять running', type: 'main', index: 0 }]) ] };
  }
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research-B: узлов +' + add.length + '; Switch out0→Research: старт, out5→Research: интейк?; Пущен?→занят?; цикл.query←взять цель');
