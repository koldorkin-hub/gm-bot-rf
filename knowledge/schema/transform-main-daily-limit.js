#!/usr/bin/env node
/*
 * Main: суточный лимит сообщений для client-тира (защита экономики перед фокус-группой).
 * Пущен?[0] → «Лимит: чек» (PG: bot_type, счётчик human-сообщений за скользящие 24ч,
 * лимит из app_config.daily_msg_limit_client, дефолт 150) → «Лимит: исчерпан?» →
 * [да] «Лимит: ответ» (вежливое сообщение, стоп) / [нет] → прежний поток (about? + Usage).
 * Владелец (255171226) и trusted/owner-боты не ограничиваются. Лимит меняется UPDATE-ом
 * app_config без редеплоя. Заблокированное сообщение НЕ сохраняется в историю (агент не
 * запускается) — счётчик не растёт, окно само откроется по мере старения сообщений.
 * Идемпотентно (маркер: узел «Лимит: чек»). Запуск: node transform-main-daily-limit.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/main-w4.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (byName['Лимит: чек']) { console.log('уже применено — пропуск'); process.exit(0); }
const gate = byName['Пущен?']; if (!gate) throw new Error('нет Пущен?');
const outs = wf.connections['Пущен?'] && wf.connections['Пущен?'].main;
if (!outs || !outs[0] || !outs[0].length) throw new Error('нет выхода Пущен?[0]');
const oldTargets = outs[0];

const px = gate.position[0], py = gate.position[1];
wf.nodes.push({
  parameters: {
    operation: 'executeQuery',
    query: "SELECT (SELECT bot_type FROM clients WHERE bot_id=$1) = 'client' AS is_client, $2::bigint <> 255171226 AS not_owner, (SELECT count(*) FROM n8n_chat_histories h WHERE h.session_id = $1||':'||$2 AND h.message->>'type'='human' AND h.created_at > now() - interval '24 hours') AS msgs24, COALESCE((SELECT value::int FROM app_config WHERE key='daily_msg_limit_client'), 150) AS lim;",
    options: { queryReplacement: "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}" }
  },
  id: 'L1000000-0000-4000-8000-000000000001',
  name: 'Лимит: чек',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
  position: [px + 180, py - 160],
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } }
});
wf.nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
      combinator: 'and',
      conditions: [{
        id: 'L1-cond',
        leftValue: "={{ $json.is_client && $json.not_owner && Number($json.msgs24) >= Number($json.lim) }}",
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true }
      }]
    },
    options: {}
  },
  id: 'L1000000-0000-4000-8000-000000000002',
  name: 'Лимит: исчерпан?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2,
  position: [px + 360, py - 160]
});
wf.nodes.push({
  parameters: {
    method: 'POST',
    url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage",
    sendBody: true,
    bodyParameters: { parameters: [
      { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" },
      { name: 'text', value: '🕐 На сегодня мы достигли дневного лимита общения — продолжим завтра! Все твои записи и дневник в полной сохранности. / Daily chat limit reached — see you tomorrow! All your logs are safe.' }
    ] },
    options: { timeout: 20000 }
  },
  id: 'L1000000-0000-4000-8000-000000000003',
  name: 'Лимит: ответ',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4,
  position: [px + 540, py - 260]
});

wf.connections['Пущен?'].main[0] = [{ node: 'Лимит: чек', type: 'main', index: 0 }];
wf.connections['Лимит: чек'] = { main: [[{ node: 'Лимит: исчерпан?', type: 'main', index: 0 }]] };
wf.connections['Лимит: исчерпан?'] = { main: [
  [{ node: 'Лимит: ответ', type: 'main', index: 0 }],
  oldTargets
] };

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — суточный лимит client-тира (Лимит: чек → исчерпан? → ответ), прежний поток на [нет]');
