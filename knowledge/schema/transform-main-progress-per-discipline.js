#!/usr/bin/env node
/*
 * main: усиление блока /progress — гарантировать хотя бы один график на КАЖДУЮ
 * основную дисциплину клиента (мультиспорт), лимит поднят до 3–4.
 * Идемпотентно (маркер: наличие 'на КАЖДУЮ основную дисциплину').
 * Запуск: node transform-main-progress-per-discipline.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');
let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');
if (sm.includes('на КАЖДУЮ основную дисциплину')) { console.log('уже усилено — пропуск'); process.exit(0); }

const a1 = '2) Покажи 2–3 ГРАФИКА через get_progress_chart, выбирая показатели по ВИДУ СПОРТА клиента';
const a1r = '2) Покажи ГРАФИКИ через get_progress_chart, выбирая показатели по ВИДУ СПОРТА клиента';
if (!sm.includes(a1)) throw new Error('якорь intro графиков не найден');
sm = sm.replace(a1, a1r);

const a2 = '   Не заваливай десятком графиков — выбери 2–3 самых осмысленных под его спорт и цель. Если данных для графика мало, инструмент так и ответит и картинка не появится — это нормально, просто отметь в тексте.';
const a2r = '   ВАЖНО: если у клиента НЕСКОЛЬКО видов спорта — покажи хотя бы ОДИН график на КАЖДУЮ основную дисциплину (приоритет 1–2): силовые → объём или 1ПМ, бег/кардио → км или темп, и т.д.; плюс вес тела. Итого обычно 3–4 графика (не больше 5, не дублируй одно и то же). Если данных для графика мало, инструмент так и ответит и картинка не появится — это нормально, просто отметь в тексте.';
if (!sm.includes(a2)) throw new Error('якорь лимита графиков не найден');
sm = sm.replace(a2, a2r);

ai.parameters.options.systemMessage = sm;
fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: /progress — гарантия графика на каждую дисциплину, лимит 3–4');
