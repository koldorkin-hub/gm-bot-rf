#!/usr/bin/env node
/*
 * BUSY-ГЕЙТ ПАЧЕК (research-стайл). Баг: пока пачка разбирается (долгая транскрипция),
 * промежуточное сообщение клиента («ок») уходило как обычное → агент отвечал в
 * контексте прошлого диалога, а разбор приходил позже. Атомарный захват защищает
 * саму пачку, но не гейтит промежуточные сообщения.
 *
 * Решение: на время финализации ставим флаг batch_busy; ранний гейт ловит ЛЮБОЕ
 * сообщение → «подожди». Флаг ставится после захвата, снимается после отправки
 * ответа пачки. Свежесть 3 мин страхует от зависшей финализации.
 *
 * Узлы: Пачка: занят?/занят!/подожди (гейт), Финал: занял (set), Финал: снял (clear).
 * Требует таблицу batch_busy. Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

for (const n of ['Пущен?', 'Research: занят?', 'Финал: есть?', 'Финал: подтверждение', 'Финал: захват', 'HTTP Request1', 'Normalize', 'Load Config'])
  if (!nodes.find(x => x.name === n)) throw new Error('нет узла ' + n);

const PGCRED = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const bot = "$('Load Config').first().json.bot_id";
const uid = "$('Normalize').first().json.message.from.id";

function upsert(name, type, tv, parameters, position, onError, credentials) {
  let n = nodes.find(x => x.name === name);
  if (!n) {
    n = { parameters, id: 'bbusy-' + Math.abs([...name].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 9)).toString(16), name, type, typeVersion: tv, position };
    if (onError) n.onError = onError; if (credentials) n.credentials = credentials;
    nodes.push(n); console.log('+', name);
  } else {
    n.parameters = parameters; n.type = type; n.typeVersion = tv; n.position = position;
    if (onError) n.onError = onError; else delete n.onError;
    if (credentials) n.credentials = credentials;
    console.log('~', name);
  }
}

// ---- гейт ----
upsert('Пачка: занят?', 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery',
  query: "SELECT EXISTS(SELECT 1 FROM batch_busy WHERE bot_id=$1 AND user_id=$2 AND started_at > now() - interval '3 minutes') AS busy;",
  options: { queryReplacement: "={{ [ " + bot + ", " + uid + " ] }}" }
}, [-620, -20], undefined, PGCRED);

upsert('Пачка: занят!', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
    conditions: [{ id: 'bb', leftValue: '={{ $json.busy }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {}
}, [-440, -20]);

upsert('Пачка: подожди', 'n8n-nodes-base.httpRequest', 4.4, {
  method: 'POST', url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage",
  sendBody: true, bodyParameters: { parameters: [
    { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" },
    { name: 'text', value: 'Секунду — ещё разбираю присланные файлы 🔎 Как закончу, пришлю разбор, и сразу продолжим 🙏' }
  ] }, options: { timeout: 20000 }
}, [-440, 160], 'continueRegularOutput');

// ---- set/clear флага ----
upsert('Финал: занял', 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery',
  query: "INSERT INTO batch_busy (bot_id,user_id,chat_id) VALUES ($1,$2,$3) ON CONFLICT (bot_id,user_id) DO UPDATE SET started_at=now();",
  options: { queryReplacement: "={{ [ " + bot + ", " + uid + ", $('Финал: захват').first().json.chat_id ] }}" }
}, [800, 720], undefined, PGCRED);

upsert('Финал: снял', 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery',
  query: "DELETE FROM batch_busy WHERE bot_id=$1 AND user_id=$2;",
  options: { queryReplacement: "={{ [ " + bot + ", " + uid + " ] }}" }
}, [2100, 40], 'continueRegularOutput', PGCRED);

// ---- связи ----
const mk = (node, index = 0) => ({ node, type: 'main', index });
const set = (from, arr) => { conns[from] = { main: arr }; };

// Пущен?[has_access] : Research: занят? -> Пачка: занят? -> Пачка: занят! -> [подожди / Research: занят?]
conns['Пущен?'].main[0] = [ mk('Пачка: занят?') ];
set('Пачка: занят?', [ [ mk('Пачка: занят!') ] ]);
set('Пачка: занят!', [ [ mk('Пачка: подожди') ], [ mk('Research: занят?') ] ]);
console.log('Пущен? -> Пачка: занят? -> занят! -> [подожди / Research: занят?]');

// Финал: есть?[взял] : подтверждение -> занял -> подтверждение
conns['Финал: есть?'].main[0] = [ mk('Финал: занял') ];
set('Финал: занял', [ [ mk('Финал: подтверждение') ] ]);
console.log('Финал: есть?[взял] -> Финал: занял -> подтверждение');

// HTTP Request1 -> Финал: снял (снять флаг после отправки ответа; для не-пачек — no-op)
const rep = conns['HTTP Request1'];
if (rep && rep.main && rep.main[0] && rep.main[0].length) console.log('HTTP Request1 уже имеет выход:', JSON.stringify(rep.main[0]));
conns['HTTP Request1'] = { main: [ [ mk('Финал: снял') ] ] };
console.log('HTTP Request1 -> Финал: снял');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
