#!/usr/bin/env node
/*
 * Main systemMessage — 2 уточнения по фидбеку владельца (15.08.2026):
 * 1. Формат прошлых результатов — привычная запись по подходам «40 кг×16, 50 кг×14».
 * 2. Research: если инструмент вернул список кандидатов — показать клиенту, дождаться
 *    выбора, затем повторный вызов со словами выбранной темы.
 * Идемпотентно (маркер: «40 кг×16»). Запуск: node transform-main-trainform.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/main-w2.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const agent = wf.nodes.find(n => (n.type || '').toLowerCase().includes('agent'));
if (!agent) throw new Error('нет AI Agent');
let sm = agent.parameters.options.systemMessage;
if (sm.includes('40 кг×16')) { console.log('уже применено — пропуск'); process.exit(0); }

const a1 = 'ПЕРЕД каждым упражнением напиши его прошлый результат («прошлый раз: жим штанги лёжа 16/14/10/8 по 40–80 кг») — клиенту удобно бить свои цифры;';
if (!sm.includes(a1)) throw new Error('якорь ведения тренировки не найден');
sm = sm.replace(a1, 'ПЕРЕД каждым упражнением напиши его прошлый результат в ПРИВЫЧНОЙ форме по подходам, в порядке выполнения «вес × повторы»: «прошлый раз: жим штанги лёжа — 40 кг×16, 50 кг×14, 60 кг×10, 80 кг×8» — клиенту удобно бить свои цифры;');

const a2 = 'ЗАПРЕЩЕНО отвечать «мы не делали разбор / в памяти пусто», не вызвав инструмент.';
if (!sm.includes(a2)) throw new Error('якорь research-правила не найден');
sm = sm.replace(a2, a2 + ' Если инструмент вернул СПИСОК тем (несколько кандидатов или промах) — покажи клиенту варианты (дата + тема) простым языком и, когда клиент подтвердит нужный, вызови get_research_report ещё раз со словами выбранной темы. Клиент НЕ обязан помнить точное название разбора — понимать, о чём речь, твоя задача.');
agent.parameters.options.systemMessage = sm;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — формат подходов + выбор разбора клиентом');
