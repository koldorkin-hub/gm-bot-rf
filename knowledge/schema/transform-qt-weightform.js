#!/usr/bin/env node
/*
 * QueryTool00001: формат подходов в привычной форме «40 кг×16, 50 кг×14» (по подходам
 * в порядке выполнения) вместо «16/14/10/8 40–80кг». Полная замена кода «Ответ агенту»
 * из qt-answer-code.js. Идемпотентно (маркер: «кг×»). Запуск: node transform-qt-weightform.js <path>
 */
const fs = require('fs');
const path = require('path');
const p = process.argv[2] || '/tmp/deploy/qt-w.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const answer = wf.nodes.find(n => n.name === 'Ответ агенту');
if (!answer) throw new Error('нет узла Ответ агенту');
if (answer.parameters.jsCode.includes('кг×')) { console.log('уже применено — пропуск'); process.exit(0); }
const code = fs.readFileSync(path.join(__dirname, 'qt-answer-code.js'), 'utf8');
if (!code.includes('кг×')) throw new Error('qt-answer-code.js без нового формата');
answer.parameters.jsCode = code;
fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: QueryTool — подходы в форме «вес кг×повторы»');
