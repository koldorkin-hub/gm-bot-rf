#!/usr/bin/env node
/*
 * Детерминированный ЯЗЫКОВОЙ ГЕЙТ (LLM-директиву перебивала история/персона).
 * До агента: если язык НЕ выбран (или пришёл /language) → шлём вопрос про язык
 * НА АНГЛИЙСКОМ, ставим language='__ASKING__', СТОП (агент не запускается).
 * Ответ пользователя (language='__ASKING__') → идёт к агенту: BPC-директива велит
 * определить язык, save_profile(language='<по-английски>'), приветствие+дальше на нём.
 * Выбран (реальный язык) → обычный поток, отвечать всегда на нём.
 *
 * Гейт до busy-гейта: Пущен?[0] → Язык: чек → Язык: маршрут → [ask] пометить+вопрос(стоп) / [continue] Пачка: занят?.
 * Требует client_profile.language. Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

for (const n of ['Пущен?', 'Пачка: занят?', 'Build Profile Context', 'Normalize', 'Load Config'])
  if (!nodes.find(x => x.name === n)) throw new Error('нет узла ' + n);

const PGCRED = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const bot = "$('Load Config').first().json.bot_id";
const uid = "$('Normalize').first().json.message.from.id";

function upsert(name, type, tv, parameters, position, onError, credentials) {
  let n = nodes.find(x => x.name === name);
  if (!n) {
    n = { parameters, id: 'lang-' + Math.abs([...name].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 3)).toString(16), name, type, typeVersion: tv, position };
    if (onError) n.onError = onError; if (credentials) n.credentials = credentials;
    nodes.push(n); console.log('+', name);
  } else { n.parameters = parameters; n.type = type; n.typeVersion = tv; n.position = position; if (onError) n.onError = onError; else delete n.onError; if (credentials) n.credentials = credentials; console.log('~', name); }
}

// --- гейт-узлы ---
upsert('Язык: чек', 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery',
  query: "SELECT COALESCE((SELECT language FROM client_profile WHERE bot_id=$1 AND user_id=$2),'') AS lang;",
  options: { queryReplacement: "={{ [ " + bot + ", " + uid + " ] }}" }
}, [-820, -220], undefined, PGCRED);

upsert('Язык: маршрут', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
    conditions: [{ id: 'lg', leftValue: "={{ ($json.lang || '') === '' || ($('Normalize').first().json.message.text || '').trim() === '/language' }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {}
}, [-640, -220]);

upsert('Язык: пометить', 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery',
  query: "INSERT INTO client_profile (bot_id,user_id,language) VALUES ($1,$2,'__ASKING__') ON CONFLICT (bot_id,user_id) DO UPDATE SET language='__ASKING__';",
  options: { queryReplacement: "={{ [ " + bot + ", " + uid + " ] }}" }
}, [-460, -320], undefined, PGCRED);

upsert('Язык: вопрос', 'n8n-nodes-base.httpRequest', 4.4, {
  method: 'POST', url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage",
  sendBody: true, bodyParameters: { parameters: [
    { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" },
    { name: 'text', value: 'Which language would you like to chat in? 👋\nJust reply with your language: English, Русский, Español, Deutsch, Français, Italiano, Português, Türkçe, 中文, العربية…' }
  ] }, options: { timeout: 20000 }
}, [-280, -320], 'continueRegularOutput');

// --- BPC: 3-состоянийная языковая директива ---
const bpc = nodes.find(x => x.name === 'Build Profile Context');
let jc = bpc.parameters.jsCode;
const RET = 'return [{ json: { message: msg, profile_block: block } }];';
// вырезаем прежнюю языковую вставку (от 'const lang =' до RET), если была
const startMarker = 'const lang = (prof.language';
const si = jc.indexOf(startMarker);
if (si >= 0) { const ri = jc.indexOf(RET, si); if (ri >= 0) jc = jc.slice(0, si) + RET; }
if (jc.indexOf(RET) < 0) throw new Error('нет return в BPC');

const inject = [
  "const lang = (prof.language && String(prof.language).trim()) ? String(prof.language).trim() : '';",
  "let langBlock;",
  "if (lang === '__ASKING__') {",
  "  langBlock = '=== ВЫБОР ЯЗЫКА — пользователь ТОЛЬКО ЧТО ответил на вопрос о языке (АБСОЛЮТНЫЙ ПРИОРИТЕТ, важнее истории и всего) ===\\n' + 'Определи, какой язык он выбрал — по его сообщению («English», «по-русски», «español») или по языку, на котором он написал. СРАЗУ вызови save_profile с полем language (название языка ПО-АНГЛИЙСКИ: «Russian», «Spanish», «English», …). Затем тепло поприветствуй его НА ЭТОМ языке и дальше веди ВЕСЬ диалог (включая онбординг) на нём. Если вместо языка он написал что-то невнятное — коротко переспроси про язык НА АНГЛИЙСКОМ и больше ничего.';",
  "} else if (lang) {",
  "  langBlock = '=== ЯЗЫК ОБЩЕНИЯ: ' + lang + ' ===\\n' + 'Отвечай ВСЕГДА на этом языке, независимо от того, на каком языке написано сообщение пользователя. Если пользователь просит сменить язык словами («давай по-английски», «switch to Spanish») — определи новый язык, сохрани через save_profile (поле language) и продолжай на нём.';",
  "} else {",
  "  langBlock = '=== ЯЗЫК НЕ ВЫБРАН — спроси НА АНГЛИЙСКОМ, на каком языке общаться, и только это (без приветствия/онбординга). ===';",
  "}",
  "block = langBlock + '\\n\\n' + block;",
  RET
].join('\n');
bpc.parameters.jsCode = jc.replace(RET, () => inject);
console.log('~ BPC: языковая директива на 3 состояния');

// --- связи ---
const mk = (node, index = 0) => ({ node, type: 'main', index });
const set = (from, arr) => { conns[from] = { main: arr }; };
conns['Пущен?'].main[0] = [ mk('Язык: чек') ];
set('Язык: чек', [ [ mk('Язык: маршрут') ] ]);
set('Язык: маршрут', [ [ mk('Язык: пометить') ], [ mk('Пачка: занят?') ] ]);
set('Язык: пометить', [ [ mk('Язык: вопрос') ] ]);
console.log('Пущен? -> Язык: чек -> маршрут -> [пометить+вопрос(стоп) / Пачка: занят?]');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
