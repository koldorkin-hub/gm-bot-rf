#!/usr/bin/env node
/*
 * Мгновенное подтверждение на финализации пачки: сразу после атомарного захвата
 * (пачка уже забрана из БД) и ДО долгой транскрипции/ответа — шлём клиенту
 * «взял в работу, минутку», чтобы он видел процесс и не писал зря.
 * Логику не меняет (захват уже защищает от гонок), только обратная связь.
 *
 * Вставка: Финал: есть? [true] → Финал: подтверждение → Финал: развернуть.
 * onError=continueRegularOutput — если ack не ушёл, обработка всё равно идёт.
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

for (const n of ['Финал: есть?', 'Финал: развернуть', 'Финал: захват', 'Load Config'])
  if (!nodes.find(x => x.name === n)) throw new Error('нет узла ' + n);

let ack = nodes.find(x => x.name === 'Финал: подтверждение');
const params = {
  method: 'POST', url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage",
  sendBody: true, bodyParameters: { parameters: [
    { name: 'chat_id', value: "={{ $('Финал: захват').first().json.chat_id }}" },
    { name: 'text', value: '🔎 Взял файлы в работу — разбираю все разом. Это займёт до минуты, отвечу одним сообщением. Подожди немного.' }
  ] }, options: { timeout: 20000 }
};
if (!ack) {
  ack = { parameters: params, id: 'final-ack-0001', name: 'Финал: подтверждение', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [980, 720], onError: 'continueRegularOutput' };
  nodes.push(ack); console.log('+ Финал: подтверждение');
} else { ack.parameters = params; ack.onError = 'continueRegularOutput'; console.log('~ Финал: подтверждение'); }

const mk = (node) => ({ node, type: 'main', index: 0 });
// Финал: есть? [true] -> подтверждение -> развернуть  ([false] -> Финал: тихо не трогаем)
const es = conns['Финал: есть?'].main;
es[0] = [ mk('Финал: подтверждение') ];
conns['Финал: подтверждение'] = { main: [ [ mk('Финал: развернуть') ] ] };
console.log('Финал: есть?[true] -> подтверждение -> развернуть');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
