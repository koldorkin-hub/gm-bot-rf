#!/usr/bin/env node
/*
 * Техдолг: убрать фолбэк-креатин в ResearchTool/Инициализация → throw при пустой теме.
 * (query || 'эффективность...креатина' → защита: пустой query = ошибка, не дефолтный разбор.)
 * Идемпотентно. Запуск: node transform-research-creatine-throw.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/rt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const n = wf.nodes.find(x => x.name === 'Инициализация');
if (!n) throw new Error('нет узла Инициализация');
let code = n.parameters.jsCode;

if (code.includes("throw new Error('Research без темы")) { console.log('уже есть throw — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }

const before = code;
// 1) вставить throw после вычисления q
code = code.replace(
  "const q = String(inp.query || '').trim();",
  "const q = String(inp.query || '').trim();\nif (!q) { throw new Error('Research без темы: query пуст — защита от пустого прогона (фолбэк-креатин убран)'); }"
);
// 2) убрать фолбэк-креатин в самом query
code = code.replace(
  "query: q || 'эффективность и безопасность креатина моногидрата',",
  "query: q,"
);
if (code === before) throw new Error('шаблоны не найдены — jsCode изменился, проверить вручную');
n.parameters.jsCode = code;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: фолбэк-креатин заменён на throw при пустой теме');
