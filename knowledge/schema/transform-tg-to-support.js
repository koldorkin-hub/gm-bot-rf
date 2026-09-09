#!/usr/bin/env node
/*
 * Переключает Telegram-узлы с кред-бота-тревог (372DoMw3VRfbXpFL) на саппорт-бота
 * (credential SupportTg0000001, создаётся импортом при деплое). Технический шум —
 * сбои и владельческие дайджесты — уезжает в чат с @GymAK_Support_Bot.
 * Универсален: применяется к любому workflow-JSON. Идемпотентен.
 * Запуск: node transform-tg-to-support.js <path>
 */
const fs = require('fs');
const p = process.argv[2];
if (!p) throw new Error('нужен путь к workflow json');
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
let n = 0;
for (const node of wf.nodes) {
  const c = node.credentials && node.credentials.telegramApi;
  if (c && c.id === '372DoMw3VRfbXpFL') {
    node.credentials.telegramApi = { id: 'SupportTg0000001', name: 'Telegram Support Bot' };
    n++;
  }
}
fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: ' + p + ' — переключено узлов: ' + n + (n === 0 ? ' (уже применено или нечего менять)' : ''));
