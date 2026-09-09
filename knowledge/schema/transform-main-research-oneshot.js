#!/usr/bin/env node
/*
 * research-B: ОДНВОПРОСНЫЙ интейк (тема+цель одним сообщением).
 * Было: /research → спроси тему → (ответ=тема) → спроси цель → (ответ=цель) → run  (ДВА вопроса).
 * Стало:
 *   • Пустой /research → 'ждём тему' ставит awaiting_goal (topic=NULL), 'спроси тему' — ОДИН
 *     комбинированный вопрос; ответ клиента → маршрут[awaiting_goal] → 'взять цель' (query=text) → run.
 *   • Инлайн /research <текст> → 'есть тема?'[да] → 'сохранить тему' (создаёт строку research_state
 *     для UPDATE в 'пометить running') → перемычка на 'взять цель' → run НАПРЯМУЮ (без второго вопроса).
 * 'взять цель' делается inline-aware: если исполнение пришло через 'Research: старт' (инлайн) —
 * query = весь текст после /research; иначе (ответ в awaiting_goal) — прежняя склейка topic+text.
 * 'Research: вопрос цели' осиротеет (безвредно). Фарма-пивот/лимит/гонки не трогаются.
 * Идемпотентно (маркер: 'hasTopic' в коде 'взять цель'). Запуск: node transform-main-research-oneshot.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const need = ['Research: ждём тему','Research: спроси тему','Research: взять цель','Research: сохранить тему'];
for (const n of need) if (!byName[n]) throw new Error('нет узла ' + n);

if ((byName['Research: взять цель'].parameters.jsCode || '').includes('hasTopic')) {
  console.log('уже однвопросный (маркер hasTopic) — пропуск'); process.exit(0);
}

// 1) ждём тему: awaiting_topic → awaiting_goal (оба вхождения)
const q = byName['Research: ждём тему'].parameters.query;
byName['Research: ждём тему'].parameters.query = q.split("awaiting_topic").join("awaiting_goal");

// 2) спроси тему: комбинированный вопрос
const combinedQ = "🔍 О чём сделать разбор? Напиши ОДНИМ сообщением и тему, и зачем она тебе (цель). Например:\n• креатин — хочу набрать массу\n• магний и сон — плохо сплю\n• добавки для энергии — устаю на работе\nМожно сразу с командой: /research креатин для набора массы. Профиль твой у меня есть — подберу под тебя.";
const bp = byName['Research: спроси тему'].parameters.bodyParameters.parameters;
const tParam = bp.find(x => x.name === 'text');
if (!tParam) throw new Error('нет text-параметра в спроси тему');
tParam.value = combinedQ;

// 3) взять цель: inline-aware
byName['Research: взять цель'].parameters.jsCode =
`const norm = $('Normalize').first().json.message;
const isVoice = norm.voice !== undefined;
let start = null; try { start = $('Research: старт').first().json; } catch (e) {}
if (start && start.hasTopic) {
  // ИНЛАЙН: /research <тема+цель> — весь текст после команды = запрос, запускаем сразу
  const qy = String(start.topic || '').trim();
  return [{ json: { goal: qy, topic: qy, query: qy } }];
}
// ОТВЕТ в awaiting_goal: текст сообщения = цель, тема из сохранённого состояния
let intake = null; try { intake = $('Research: интейк?').first().json; } catch (e) {}
const text = (isVoice ? ($('Edit Fields').first().json.message.text || '') : (norm.text || '')).trim();
const topic = String((intake && intake.topic) || '').trim();
const query = [topic, text].filter(Boolean).join(' — ');
return [{ json: { goal: text, topic, query } }];`;

// 4) перемычка: сохранить тему → взять цель (было → вопрос цели)
if (!wf.connections['Research: сохранить тему']) throw new Error('нет связи сохранить тему');
wf.connections['Research: сохранить тему'].main[0] = [ { node: 'Research: взять цель', type: 'main', index: 0 } ];

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: research-B — однвопросный интейк (инлайн run напрямую + пустой = 1 комбинированный вопрос)');
