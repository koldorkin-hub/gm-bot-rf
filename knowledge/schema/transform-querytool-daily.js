#!/usr/bin/env node
/*
 * QueryTool00001 (get_progress): ДНЕВНИК ПО ДНЯМ вместо агрегатов-кучи.
 * - food: разбивка по дням (дата+день недели+блюда с ккал+итоги дня), итоги периода в конце;
 *   ≤14 дней — с составом, ≤35 — итоги дней, больше — по неделям.
 * - workout: сессии по дням с упражнениями (подходы×повторы, веса, объём сессии).
 * - Новые входы date / date_from / date_to (ГГГГ-ММ-ДД) — конкретный день или диапазон
 *   («что я ел 11 августа»); без них — прежнее окно period_days от сегодня.
 * - measurement и records НЕ тронуты.
 * Новый код узлов — в файлах qt-params-code.js / qt-answer-code.js рядом с этим скриптом.
 * Идемпотентно (маркер: date_from в коде «Параметры»).
 * Запуск: node transform-querytool-daily.js <path-to-workflow-json>
 */
const fs = require('fs');
const path = require('path');
const p = process.argv[2] || '/tmp/qt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

const params = byName['Параметры']; if (!params) throw new Error('нет узла Параметры');
const answer = byName['Ответ агенту']; if (!answer) throw new Error('нет узла Ответ агенту');
const trig = wf.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
if (!trig) throw new Error('нет триггера');

if ((params.parameters.jsCode || '').includes('date_from')) { console.log('уже применено — пропуск'); process.exit(0); }

const newParams = fs.readFileSync(path.join(__dirname, 'qt-params-code.js'), 'utf8');
const newAnswer = fs.readFileSync(path.join(__dirname, 'qt-answer-code.js'), 'utf8');
if (!newParams.includes('GREATEST(fd0, td - 92)')) throw new Error('qt-params-code.js неполный');
if (!newAnswer.includes('по дням')) throw new Error('qt-answer-code.js неполный');
params.parameters.jsCode = newParams;
answer.parameters.jsCode = newAnswer;

const vals = trig.parameters.workflowInputs.values;
for (const nm of ['date', 'date_from', 'date_to']) {
  if (!vals.some(v => v.name === nm)) vals.push({ name: nm, type: 'string' });
}

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: QueryTool — дневник по дням (food/workout), входы date/date_from/date_to');
