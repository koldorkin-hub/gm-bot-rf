// research-B, доводка по живому тесту (3 фикса):
// (1) Детерминированное уточнение цели: сохранить тему -> «Research: вопрос цели» (фикс. один вопрос,
//     БЕЗ основного агента) — агент раньше уходил в онбординг и терял нить.
// (2) Агент перенаправляет просьбы «разбор/исследование/расклад» на /research (блок в systemMessage),
//     чтобы не подменять PDF текстом в чате.
// (3) Фарма в /research: «к врачу» теперь не снимает состояние, а УДЕРЖИВАЕТ интейк (awaiting_topic)
//     для легальной части + текст предлагает написать легальную тему.
// Идемпотентно (признак 'Research: вопрос цели'). Запуск: node transform-main-research-b2.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Research: вопрос цели']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const BOT = "$('Load Config').first().json.bot_id";
const UID = "$('Normalize').first().json.message.from.id";
const CHAT = "$('Normalize').first().json.message.chat.id";
function sendMsg(id, name, textExpr, pos) {
  const n = JSON.parse(JSON.stringify(byName['Голос не распознан']));
  n.id = id; n.name = name; n.position = pos;
  n.parameters.bodyParameters.parameters.find(p => p.name === 'text').value = textExpr;
  return n;
}

// (1) детерминированный вопрос цели
byName['Research: вопрос цели'] = sendMsg('fb000000-0000-4000-8000-000000000001', 'Research: вопрос цели',
  "=Понял, тема: «{{ $json.topic }}».\nДля чего тебе этот разбор — какая цель? Напиши одним сообщением (например: сбросить вес, набрать массу, энергия и сон, восстановление). Профиль твой у меня уже есть — подберу под тебя, потом пришлю PDF.",
  [380, 640]);
wf.nodes.push(byName['Research: вопрос цели']);
// перевязка: сохранить тему -> вопрос цели (было -> спросить цель/агент)
conns['Research: сохранить тему'] = { main: [[{ node: 'Research: вопрос цели', type: 'main', index: 0 }]] };

// (3) легальный пивот вместо снятия состояния
byName['Research: легальный пивот'] = { parameters: { operation: 'executeQuery',
    query: "INSERT INTO research_state(bot_id,user_id,stage,topic,chat_id,started_at) VALUES ($1,$2,'awaiting_topic',NULL,$3,now())\n" +
           "ON CONFLICT (bot_id,user_id) DO UPDATE SET stage='awaiting_topic', topic=NULL, chat_id=$3, started_at=now();",
    options: { queryReplacement: "={{ [" + BOT + ", " + UID + ", " + CHAT + "] }}" } },
  id: 'fb000000-0000-4000-8000-000000000002', name: 'Research: легальный пивот',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [2000, 1150], credentials: PG };
wf.nodes.push(byName['Research: легальный пивот']);
// текст «к врачу» + удержание интейка
byName['Research: к врачу'].parameters.bodyParameters.parameters.find(p => p.name === 'text').value =
  "Доказательные разборы по рецептурным и гормональным препаратам, стероидам и дозировкам я не делаю — это вне компетенции фитнес-сервиса, такие вопросы решаются с врачом. Попытка не засчитана.\n\nНо легальную часть разберу полноценно — тренировки, питание, восстановление, безрецептурные добавки. Напиши тему для разбора (например: «жиросжигание без препаратов») — задам один вопрос про цель и соберу PDF.";
conns['Research: к врачу'] = { main: [[{ node: 'Research: легальный пивот', type: 'main', index: 0 }]] };

// (2) systemMessage: перенаправление на /research
const agent = byName['AI Agent'];
let sm = agent.parameters.options.systemMessage;
if (!sm.includes('РАЗБОРЫ И ИССЛЕДОВАНИЯ')) {
  const block = "=== РАЗБОРЫ И ИССЛЕДОВАНИЯ ===\n" +
    "Доказательные разборы, исследования, «расклады», подборки научных данных по теме ты САМ в чате НЕ пишешь — для этого есть отдельный режим /research (он собирает полноценный PDF-отчёт по научным источникам). Если клиент просит доказательный разбор / исследование / «дай расклад» / «что говорит наука» по теме — НЕ выдавай это текстом и НЕ начинай собирать данные вопросами. Коротко ответь, что это делается командой /research, и попроси запустить её и назвать тему. Обычные тренерские вопросы (как тренироваться, что поесть, техника, мотивация, разбор его собственных данных) отвечай как обычно, без перенаправления.\n\n";
  const anchor = "=== ТЕКУЩАЯ ДАТА ===";
  if (!sm.includes(anchor)) throw new Error('нет анкера ТЕКУЩАЯ ДАТА');
  sm = sm.replace(anchor, block + anchor);
  agent.parameters.options.systemMessage = sm;
  console.log('systemMessage: блок РАЗБОРЫ добавлен, len=' + sm.length);
} else console.log('systemMessage: блок РАЗБОРЫ уже есть');

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research-b2: сохранить тему→вопрос цели; к врачу→легальный пивот; +systemMessage');
