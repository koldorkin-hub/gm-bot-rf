#!/usr/bin/env node
/*
 * Подворкфлоу AccessGrant01 — кнопочная bulk-выдача доступа владельцем.
 * Вход: command_text, owner_bot_id, owner_bot_token, owner_chat_id.
 * Режимы: ask (пустой /grant → спросить формат, поставить grant_awaiting);
 *         grant (тир + id(ы) + срок → bulk upsert user_access → подтверждение с тиром);
 *         error (не хватает данных → подсказка).
 * Тир: user/client→бот 'users', trusted→бот 'trusted'. Срок: ГГГГ-ММ-ДД | DD.MM.ГГГГ | Nd | free.
 * Пишет /home/node/accessgrant.json. Запуск: node build-accessgrant.js <out>
 */
const fs = require('fs');
const out = process.argv[2] || '/home/node/accessgrant.json';
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

const razborCode = [
  "const d = $input.first().json;",
  "const raw = String(d.command_text || '').trim();",
  "const spec = raw.replace(/^\\/grant/i, '').trim();",
  "if (!spec) { return [{ json: { mode: 'ask' } }]; }",
  "const toks = spec.split(/\\s+/);",
  "let tier = null, until = null, hasUntil = false; const ids = [];",
  "for (const t of toks) {",
  "  const low = t.toLowerCase();",
  "  if (['user','users','client','клиент','юзер'].includes(low)) tier = 'users';",
  "  else if (['trusted','траст','трастед','доверенный'].includes(low)) tier = 'trusted';",
  "  else if (['free','бессрочно','навсегда'].includes(low)) { until = null; hasUntil = true; }",
  "  else if (/^\\d+d$/i.test(low)) { until = new Date(Date.now() + parseInt(low,10)*86400000).toISOString().slice(0,10); hasUntil = true; }",
  "  else if (/^\\d{4}-\\d{2}-\\d{2}$/.test(low)) { until = low; hasUntil = true; }",
  "  else if (/^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(low)) { const p = low.split('.'); until = p[2]+'-'+p[1]+'-'+p[0]; hasUntil = true; }",
  "  else if (/^\\d{5,}$/.test(low)) ids.push(Number(low));",
  "}",
  "const errors = [];",
  "if (!tier) errors.push('не указан тир (user или trusted)');",
  "if (!ids.length) errors.push('не указаны ID (числа, id пользователя Telegram)');",
  "if (!hasUntil) errors.push('не указан срок (ГГГГ-ММ-ДД, 30d, или free)');",
  "const help = 'Формат: <тир> <id id ...> <срок>\\nТир: user (клиентский бот) или trusted (доверенный)\\nСрок: ГГГГ-ММ-ДД, 30d (дней) или free\\nПример: user 111222333 444555666 2026-12-31';",
  "if (errors.length) { return [{ json: { mode: 'error', summary: '⚠️ Не понял: ' + errors.join('; ') + '.\\n\\n' + help } }]; }",
  "const tierLabel = tier === 'trusted' ? 'trusted (доверенный)' : 'user (клиент)';",
  "const uname = tier === 'trusted' ? '@TRD_Gymbot' : '@USER_GYMBOT';",
  "const untilStr = until ? ('до ' + until) : 'бессрочно';",
  "const note = until ? ('до ' + until) : 'free/бессрочно';",
  "const summary = '✅ Доступ выдан.\\nТир: ' + tierLabel + ' (' + uname + ')\\nСрок: ' + untilStr + '\\nВыдано ' + ids.length + ' id:\\n' + ids.join(', ');",
  "return [{ json: { mode: 'grant', bot_id: tier, ids, until, note, summary } }];"
].join("\n");

function ownerMsg(name, id, pos, textExpr) {
  return { parameters: { method: 'POST', url: "=https://api.telegram.org/bot{{ $('Триггер').first().json.owner_bot_token }}/sendMessage", sendBody: true,
      bodyParameters: { parameters: [ { name: 'chat_id', value: "={{ $('Триггер').first().json.owner_chat_id }}" }, { name: 'text', value: textExpr } ] }, options: { timeout: 20000 } },
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: pos, onError: 'continueRegularOutput' };
}
function pg(name, id, pos, query, qr, extra) {
  const p = { operation: 'executeQuery', query, options: {} }; if (qr) p.options.queryReplacement = qr;
  return Object.assign({ parameters: p, id, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG }, extra || {});
}

const nodes = [
  { parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [ { name: 'command_text', type: 'string' }, { name: 'owner_bot_id', type: 'string' }, { name: 'owner_bot_token', type: 'string' }, { name: 'owner_chat_id', type: 'string' } ] } },
    id: 'ag-node-000001', name: 'Триггер', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [-1000, 0] },
  { parameters: { jsCode: razborCode }, id: 'ag-node-000002', name: 'Разобрать', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-800, 0] },
  { parameters: { rules: { values: [
      { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'g0', leftValue: '={{ $json.mode }}', rightValue: 'ask', operator: { type: 'string', operation: 'equals' } } ] }, renameOutput: true, outputKey: 'ask' },
      { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'g1', leftValue: '={{ $json.mode }}', rightValue: 'grant', operator: { type: 'string', operation: 'equals' } } ] }, renameOutput: true, outputKey: 'grant' },
      { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'g2', leftValue: '={{ $json.mode }}', rightValue: 'error', operator: { type: 'string', operation: 'equals' } } ] }, renameOutput: true, outputKey: 'error' }
    ] }, options: {} }, id: 'ag-node-000003', name: 'Маршрут', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [-600, 0] },
  // ask
  pg('Ждём спеку', 'ag-node-000004', [-400, -160], "INSERT INTO grant_awaiting (bot_id, owner_id) VALUES ($1,$2) ON CONFLICT (bot_id,owner_id) DO UPDATE SET created_at=now();", "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}"),
  ownerMsg('Спроси спеку', 'ag-node-000005', [-200, -160], "=👥 Кому выдать доступ? Напиши одним сообщением:\n<тир> <id id ...> <срок>\n\nТир: user (клиентский бот) или trusted (доверенный)\nСрок: ГГГГ-ММ-ДД, 30d (дней) или free\n\nПример: user 111222333 444555666 2026-12-31"),
  // grant
  pg('Выдать', 'ag-node-000006', [-400, 0], "INSERT INTO user_access (bot_id,user_id,access_until,note,updated_at) SELECT $1, x, $2::date, $3, now() FROM unnest($4::bigint[]) AS x ON CONFLICT (bot_id,user_id) DO UPDATE SET access_until=EXCLUDED.access_until, note=EXCLUDED.note, updated_at=now();", "={{ [ $('Разобрать').first().json.bot_id, $('Разобрать').first().json.until, $('Разобрать').first().json.note, $('Разобрать').first().json.ids ] }}"),
  ownerMsg('Подтвердить', 'ag-node-000007', [-200, 0], "={{ $('Разобрать').first().json.summary }}"),
  pg('Очистить ожидание', 'ag-node-000008', [0, 0], "DELETE FROM grant_awaiting WHERE bot_id=$1 AND owner_id=$2;", "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}"),
  // error
  ownerMsg('Ошибка', 'ag-node-000009', [-400, 160], "={{ $('Разобрать').first().json.summary }}")
];

const c = {};
c['Триггер'] = { main: [ [ { node: 'Разобрать', type: 'main', index: 0 } ] ] };
c['Разобрать'] = { main: [ [ { node: 'Маршрут', type: 'main', index: 0 } ] ] };
c['Маршрут'] = { main: [ [ { node: 'Ждём спеку', type: 'main', index: 0 } ], [ { node: 'Выдать', type: 'main', index: 0 } ], [ { node: 'Ошибка', type: 'main', index: 0 } ] ] };
c['Ждём спеку'] = { main: [ [ { node: 'Спроси спеку', type: 'main', index: 0 } ] ] };
c['Выдать'] = { main: [ [ { node: 'Подтвердить', type: 'main', index: 0 } ] ] };
c['Подтвердить'] = { main: [ [ { node: 'Очистить ожидание', type: 'main', index: 0 } ] ] };

const wf = { id: 'AccessGrant01', name: 'Доступ — выдача владельцем', active: true, nodes, connections: c, settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001' } };
fs.writeFileSync(out, JSON.stringify([wf], null, 2));
console.log('OK: AccessGrant01 записан в ' + out + ' (узлов: ' + nodes.length + ')');
