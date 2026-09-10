/**
 * ПРАВКА БОЕВОГО БОТА: изометрия (планка, вис, стойка) записывается временем, а не повторами.
 *
 * Что сломано. В описании инструмента log_workout силовой подход описан как
 * {reps, weight_kg, rpe} — места для времени там нет вообще. Планку модели записать нечем,
 * поэтому она либо теряет секунды, либо выдумывает повторы. Ответ бота клиенту
 * («время передаётся через duration_s») верен только для кардио, а не для силового подхода.
 *
 * Это первая из трёх правок, они независимы, но нужны все три:
 *   fix-isometric-main.js       — эта: схема инструмента и правило в системнике;
 *   fix-isometric-logworkout.js — запись: в силовой ветке duration_s жёстко ставился null;
 *   fix-isometric-querytool.js  — чтение: подход показывался только как «вес × повторы».
 *
 * Идемпотентно (признак — слово ИЗОМЕТРИЯ в системнике).
 * Прогон:  node fix-isometric-main.js <вход.json> <выход.json>
 */
const fs = require('fs');
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node fix-isometric-main.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const node = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);

// ---- 1. Схема инструмента: в силовом подходе появляется время ----
const tool = node('log_workout');
const before = String(tool.parameters.description || '');
const OLD = 'силовое {activity, kind:"strength", sets:[{reps, weight_kg, rpe}]}';
const NEW = 'силовое {activity, kind:"strength", sets:[{reps, weight_kg, rpe, duration_s}]} '
  + '— в изометрии (планка, вис, стойка, уголок, стульчик у стены) подход задаётся ВРЕМЕНЕМ: '
  + 'duration_s на каждый подход, reps не выдумывать';
if (before.includes('duration_s}]')) {
  console.log('~ описание инструмента уже правлено');
} else {
  if (!before.includes(OLD)) fail('в описании log_workout не найден силовой шаблон — схема изменилась, править руками');
  tool.parameters.description = before.replace(OLD, NEW);
}

// ---- 2. Правило в системнике ----
const agent = node('AI Agent');
let sm = String(agent.parameters.options.systemMessage || '');
const RULE = '\nИЗОМЕТРИЯ (планка, вис на турнике, стойка, уголок, стульчик у стены, удержание моста): '
  + 'подход измеряется ВРЕМЕНЕМ, а не повторами. Передавай duration_s в каждом подходе '
  + '(«планка 3 по 60 секунд» → sets:[{duration_s:60},{duration_s:60},{duration_s:60}]), повторы не придумывай. '
  + 'Клиент не назвал время — спроси ОДИН раз и дождись ответа. Если он не помнит или не хочет уточнять, '
  + 'запиши подходы без времени и честно скажи, что время не указано: переспрашивать по второму кругу нельзя. '
  + 'Пересказывая записанное, называй секунды, а не повторы.';

if (sm.includes('ИЗОМЕТРИЯ')) {
  console.log('~ правило в системнике уже стоит');
} else {
  const anchor = '=== ТРЕКИНГ И ЗАПИСЬ ДАННЫХ ===';
  if (!sm.includes(anchor)) fail('не найден блок ТРЕКИНГ И ЗАПИСЬ ДАННЫХ');
  // Правило встаёт в конец блока трекинга: перед следующим заголовком.
  const start = sm.indexOf(anchor);
  const next = sm.indexOf('\n===', start + anchor.length);
  const cut = next === -1 ? sm.length : next;
  sm = sm.slice(0, cut) + RULE + sm.slice(cut);
  agent.parameters.options.systemMessage = sm;
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');

// ---- Проверка фактом ----
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(back) ? back[0] : back;
const t = w.nodes.find((x) => x.name === 'log_workout');
const s = w.nodes.find((x) => x.name === 'AI Agent').parameters.options.systemMessage;
if (!String(t.parameters.description).includes('duration_s}]')) fail('время не попало в схему инструмента');
if (!s.includes('ИЗОМЕТРИЯ')) fail('правило не попало в системник');
if (!s.includes('duration_s:60')) fail('в правиле потерялся пример вызова');
const open = (s.match(/\{\{/g) || []).length, close = (s.match(/\}\}/g) || []).length;
if (open !== close) fail('непарные {{ }} в системнике: ' + open + ' против ' + close);
if (s.indexOf('ИЗОМЕТРИЯ') > s.indexOf('=== РАСЧЁТЫ')) fail('правило встало не в блок трекинга');
console.log('OK ->', OUT);
const inRaw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const inWf = Array.isArray(inRaw) ? inRaw[0] : inRaw;
const wasLen = inWf.nodes.find((x) => x.name === 'AI Agent').parameters.options.systemMessage.length;
console.log('  системник:', s.length, 'знаков (было', wasLen + ')');
