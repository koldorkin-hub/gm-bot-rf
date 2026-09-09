#!/usr/bin/env node
/*
 * ФИКС регресса пачек: одиночный документ теперь идёт Switch out4 → Фото: режим
 * (Postgres, заменяет $json на {mode}) → … → Док: тип. Роутер и размер-гейты
 * читали $json.message — которого там больше нет → фолбэк-отказ «Док: формат».
 *
 * Решение: узлы Док: тип / Док: {txt,pdf,docx} размер? читают $('Normalize'),
 * а не $json — работают при любом пути (напрямую из Switch или через накопление).
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes;

const NORM = "$('Normalize').first().json.message";
let changed = 0;

function fixLeft(node) {
  const conds = ((node.parameters.conditions && node.parameters.conditions.conditions) || []);
  for (const c of conds) {
    if (typeof c.leftValue === 'string' && c.leftValue.indexOf('$json.message') >= 0) {
      c.leftValue = c.leftValue.split('$json.message').join(NORM);
      changed++;
    }
  }
}

// Док: тип — switch rules
const router = nodes.find(x => x.name === 'Док: тип');
if (router) {
  for (const rule of ((router.parameters.rules && router.parameters.rules.values) || [])) {
    for (const c of ((rule.conditions && rule.conditions.conditions) || [])) {
      if (typeof c.leftValue === 'string' && c.leftValue.indexOf('$json.message') >= 0) {
        c.leftValue = c.leftValue.split('$json.message').join(NORM);
        changed++;
      }
    }
  }
  console.log('~ Док: тип rules → Normalize');
}

// размер-гейты
for (const nm of ['Док: txt размер?', 'Док: pdf размер?', 'Док: docx размер?']) {
  const n = nodes.find(x => x.name === nm);
  if (n) { fixLeft(n); console.log('~ ' + nm + ' → Normalize'); }
}

console.log('заменено выражений:', changed);
const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
