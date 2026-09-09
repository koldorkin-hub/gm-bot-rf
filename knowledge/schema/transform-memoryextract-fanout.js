#!/usr/bin/env node
/*
 * ФИКС MemoryExtract: узел «Промпт» обрабатывал только ПЕРВУЮ сессию за ночь
 * ($input.first()), остальные с новыми сообщениями отбрасывались → watermark
 * догонял по 1 сессии/ночь, на масштабе не догоняет НИКОГДА. Переписываем на
 * fan-out по ВСЕМ сессиям ($input.all()) с явным pairedItem — чтобы «Разобрать»
 * ($('Промпт').item) корректно сопоставлял ответ Anthropic его сессии (иначе
 * факты одной сессии применятся к другой и watermark прыгнет без извлечения).
 *
 * Систем-промпт переносится ДОСЛОВНО из существующего кода (indexOf, не переписываем).
 * Опц. argv[3] — новое cron-выражение scheduleTrigger (для нудж-теста; потом вернуть).
 * Идемпотентен (маркер '$input.all()'). Запуск: node transform-memoryextract-fanout.js <path> [cron]
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/me-work.json';
const newCron = process.argv[3] || null;
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;

const prm = wf.nodes.find(n => n.name === 'Промпт');
if (!prm) throw new Error('нет узла Промпт');
let code = prm.parameters.jsCode;

if (!code.includes('$input.all()')) {
  const a = code.indexOf('const system = ');
  const b = code.indexOf('const body =');
  if (a < 0 || b < 0) throw new Error('не нашёл system/body в Промпт');
  const systemStmt = code.slice(a, b).trim(); // "const system = '...';" — дословно

  const nl = String.fromCharCode(92, 110); // литерал \n внутри итогового jsCode
  const newCode = [
    'const items = $input.all();',
    systemStmt,
    'const out = [];',
    'for (let i = 0; i < items.length; i++) {',
    '  const d = items[i].json;',
    '  const transcript = String(d.transcript || "").trim();',
    '  if (!transcript) continue;',
    '  const cur = String(d.current_summary || "").trim() || "(выжимки пока нет)";',
    '  const user = "ТЕКУЩАЯ ВЫЖИМКА О КЛИЕНТЕ:' + nl + '" + cur + "' + nl + nl + 'НОВЫЕ СООБЩЕНИЯ:' + nl + '" + transcript;',
    '  const body = JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, system: system, messages: [{ role: "user", content: user }] });',
    '  out.push({ json: { bot_id: d.bot_id, user_id: d.user_id, max_id: d.max_id, body: body }, pairedItem: { item: i } });',
    '}',
    'return out;'
  ].join('\n');
  prm.parameters.jsCode = newCode;
  console.log('OK: Промпт переписан на fan-out ($input.all), системный промпт перенесён дословно:', systemStmt.length, 'симв');
} else {
  console.log('Промпт уже fan-out — пропускаю');
}

// Разобрать ТОЖЕ использовал $input.first() → схлопывал N ответов в 1. Fan-out по всем,
// метаданные берём из $('Промпт').all()[i] (порядок Промпт→Извлечь→Разобрать выровнен 1:1).
const raz = wf.nodes.find(n => n.name === 'Разобрать');
if (!raz) throw new Error('нет узла Разобрать');
if (!raz.parameters.jsCode.includes('$input.all()')) {
  const razCode = [
    'const out = [];',
    'const inp = $input.all();',
    'const prompts = $("Промпт").all();',
    'for (let i = 0; i < inp.length; i++) {',
    '  const r = inp[i].json;',
    '  const p = prompts[i].json;',
    '  let text = "";',
    '  try { text = r.content[0].text; } catch (e) { text = ""; }',
    '  text = String(text).replace(/^```json\\s*/i, "").replace(/^```\\s*/, "").replace(/```\\s*$/, "").trim();',
    '  const si = text.indexOf("{"); const ei = text.lastIndexOf("}");',
    '  let payload = "{}";',
    '  if (si >= 0 && ei > si) payload = text.slice(si, ei + 1);',
    '  try { JSON.parse(payload); } catch (e) { payload = "{}"; }',
    '  out.push({ json: { bot_id: p.bot_id, user_id: p.user_id, max_id: p.max_id, payload: payload }, pairedItem: { item: i } });',
    '}',
    'return out;'
  ].join('\n');
  raz.parameters.jsCode = razCode;
  console.log('OK: Разобрать переписан на fan-out по всем ответам');
} else {
  console.log('Разобрать уже fan-out — пропускаю');
}

if (newCron) {
  const trig = wf.nodes.find(n => (n.type || '').includes('scheduleTrigger'));
  if (!trig) throw new Error('нет scheduleTrigger');
  trig.parameters.rule.interval[0].expression = newCron;
  console.log('cron scheduleTrigger =', newCron);
}

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('записано', p);
