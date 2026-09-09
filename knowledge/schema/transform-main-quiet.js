#!/usr/bin/env node
/*
 * Команда /quiet (кнопка меню) — переключатель тихого режима (проактивные сообщения вкл/выкл).
 * Врезается в цепочку команд: Команда: support?[1] (было → Язык: чек) → Команда: quiet?
 *   [да] → Тихий: переключить (upsert toggle proactive_enabled RETURNING) → Тихий: ответ (терминал)
 *   [нет] → Язык: чек
 * Узлы клонируются из существующих (IF←Пущен?, HTTP←Язык: вопрос, PG←Пачка: занят?).
 * Идемпотентно (маркер 'Команда: quiet?'). Запуск: node transform-main-quiet.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

if (byName['Команда: quiet?']) { console.log('уже есть — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }

const IFTPL = 'Пущен?', HTTPTPL = 'Язык: вопрос', PGTPL = 'Пачка: занят?';
let idc = 0; const nid = () => 'quietnode' + (++idc).toString().padStart(3, '0');
const clone = (nm) => JSON.parse(JSON.stringify(byName[nm]));

function mkIf(name, leftExpr, operator, right, pos) {
  const n = clone(IFTPL); n.name = name; n.id = nid(); n.position = pos; delete n.credentials; delete n.onError;
  n.parameters = { conditions: { options: { caseSensitive: false, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [{ id: nid(), leftValue: leftExpr, rightValue: right, operator: operator }] } };
  return n;
}
function mkSend(name, bodyParams, pos) {
  const n = clone(HTTPTPL); n.name = name; n.id = nid(); n.position = pos;
  n.parameters.bodyParameters.parameters = bodyParams; n.onError = 'continueRegularOutput';
  return n;
}
function mkPg(name, query, queryReplacement, pos) {
  const n = clone(PGTPL); n.name = name; n.id = nid(); n.position = pos;
  n.parameters = { operation: 'executeQuery', query: query, options: { queryReplacement: queryReplacement } };
  return n;
}

const textLc = "={{ ($('Normalize').first().json.message.text || '').trim().toLowerCase() }}";
const swOp = { type: 'string', operation: 'startsWith' };
const chatId = "={{ $('Normalize').first().json.message.chat.id }}";

const toggleQuery = "INSERT INTO client_profile (bot_id, user_id, proactive_enabled) VALUES ($1,$2,false) ON CONFLICT (bot_id,user_id) DO UPDATE SET proactive_enabled = NOT COALESCE(client_profile.proactive_enabled, true), updated_at=now() RETURNING proactive_enabled;";
const toggleRepl = "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}";
const replyText = "={{ $json.proactive_enabled ? '🔔 Напоминания включены. Буду присылать недельную сводку прогресса и по-доброму напоминать, если пропадёшь на время. Выключить — снова нажми /quiet.' : '🔕 Тихий режим включён. Я больше не пишу первым — отвечаю только когда пишешь ты. Вернуть напоминания — снова нажми /quiet.' }}";

const add = [
  mkIf('Команда: quiet?', textLc, swOp, '/quiet', [100, 940]),
  mkPg('Тихий: переключить', toggleQuery, toggleRepl, [320, 940]),
  mkSend('Тихий: ответ', [{ name: 'chat_id', value: chatId }, { name: 'text', value: replyText }], [520, 940]),
];
add.forEach(n => wf.nodes.push(n));

const C = wf.connections;
const setMain = (from, i, targets) => { if (!C[from]) C[from] = { main: [] }; while (C[from].main.length <= i) C[from].main.push([]); C[from].main[i] = targets.map(t => ({ node: t, type: 'main', index: 0 })); };

if (!C['Команда: support?']) throw new Error('нет Команда: support? — сначала transform-main-buttons');
setMain('Команда: support?', 1, ['Команда: quiet?']);
setMain('Команда: quiet?', 0, ['Тихий: переключить']);
setMain('Команда: quiet?', 1, ['Язык: чек']);
setMain('Тихий: переключить', 0, ['Тихий: ответ']);

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: /quiet добавлен (Команда: support?[1]→Команда: quiet?→переключить→ответ / иначе→Язык: чек)');
