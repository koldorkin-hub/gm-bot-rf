#!/usr/bin/env node
/*
 * ФИКС: голосовая ветка теряла message.text перед AI Agent.
 *
 * Регресс от доводки research-B (01.08.2026): между Edit Fields и AI Agent
 * вставлены Research: интейк? (Postgres) → маршрут → обычный?. Postgres-узел
 * заменяет item результатом SELECT (stage/topic) и срезает message. Текст
 * уцелел — у него есть «Текст: разбор», восстанавливающий message.text из
 * Normalize. У голоса такого узла не было: обычный?[0] шёл прямо в AI Agent →
 * промпт пустой → langchain «No prompt specified» → «ядро не ответило».
 *
 * Фикс: добавить Code-узел «Голос: разбор» на голосовую ветку
 * (обычный? output0 → Голос: разбор → AI Agent). Он берёт message из Normalize
 * и кладёт расшифровку из Edit Fields в message.text — зеркало текстового пути,
 * ровно возвращая дорегрессное поведение голоса (Edit Fields → AI Agent).
 *
 * Идемпотентен: повторный прогон ничего не дублирует.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;

const NODE_NAME = 'Голос: разбор';
const nodes = wf.nodes;
const conns = wf.connections;

// --- проверки предпосылок ---
const obychnyi = nodes.find(n => n.name === 'Research: обычный?');
const agent = nodes.find(n => n.name === 'AI Agent');
const editFields = nodes.find(n => n.name === 'Edit Fields');
const normalize = nodes.find(n => n.name === 'Normalize');
if (!obychnyi || !agent || !editFields || !normalize) {
  throw new Error('Нет одного из опорных узлов (обычный?/AI Agent/Edit Fields/Normalize)');
}

// --- код узла-восстановителя ---
const jsCode = [
  "// Восстановить message.text из голосовой расшифровки перед AI Agent.",
  "// message берём из Normalize (from/chat/voice-метаданные), text — из Edit Fields (Groq).",
  "const msg = $('Normalize').first().json.message || {};",
  "const text = String((($('Edit Fields').first().json.message) || {}).text || '').trim();",
  "return [{ json: { message: Object.assign({}, msg, { text }), route: 'agent' } }];"
].join('\n');

// --- создать/обновить узел (идемпотентно) ---
let node = nodes.find(n => n.name === NODE_NAME);
if (!node) {
  node = {
    parameters: { jsCode },
    id: 'voice-parse-0001-4c2a-9f10-a1b2c3d4e5f6',
    name: NODE_NAME,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [ (obychnyi.position[0] + agent.position[0]) / 2, obychnyi.position[1] ]
  };
  nodes.push(node);
  console.log('+ узел создан:', NODE_NAME);
} else {
  node.parameters.jsCode = jsCode;
  node.type = 'n8n-nodes-base.code';
  node.typeVersion = 2;
  console.log('~ узел уже был — код обновлён:', NODE_NAME);
}

// --- перевесить связи ---
// обычный? main[0] (голос/TRUE): AI Agent -> Голос: разбор
const oconn = conns['Research: обычный?'];
if (!oconn || !oconn.main || !oconn.main[0]) throw new Error('У обычный? нет main[0]');
const before = JSON.stringify(oconn.main[0]);
oconn.main[0] = [{ node: NODE_NAME, type: 'main', index: 0 }];
console.log('обычный?[0]:', before, '->', JSON.stringify(oconn.main[0]));

// Голос: разбор -> AI Agent
conns[NODE_NAME] = { main: [ [ { node: 'AI Agent', type: 'main', index: 0 } ] ] };
console.log(NODE_NAME, '-> AI Agent');

// --- сохранить ---
const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
