#!/usr/bin/env node
/*
 * main: апгрейд рассылки до awaiting-state (тап /broadcast → бот спрашивает текст →
 * следующее сообщение владельца = черновик → превью).
 * 'Команда: broadcast?' теперь гейт ТОЛЬКО bot_type=='owner' (не по тексту).
 * [да] → 'Broadcast: чек' (PG: есть ли свежий awaiting_text) → 'Broadcast: как?' (Code:
 *   определить isBroadcast + cmdText: команда /broadcast* ИЛИ текст-в-режиме-ожидания) →
 *   'Broadcast: это рассылка?' → [да] 'Broadcast: вызов' (command_text из 'Broadcast: как?') /
 *   [нет] 'Язык: чек' (обычный поток). [нет owner] → 'Язык: чек'.
 * Идемпотентно (маркер: узел 'Broadcast: чек'). Запуск: node transform-main-broadcast-await.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const C = wf.connections;
const bif = byName['Команда: broadcast?']; if (!bif) throw new Error('нет Команда: broadcast? (сначала transform-main-broadcast-command.js)');
const call = byName['Broadcast: вызов']; if (!call) throw new Error('нет Broadcast: вызов');
if (!byName['Язык: чек']) throw new Error('нет Язык: чек');

if (byName['Broadcast: чек']) { console.log('уже awaiting-state — пропуск'); process.exit(0); }

// 1) broadcast? — только bot_type owner
bif.parameters = { conditions: { options: { caseSensitive: false, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [
  { id: 'bc-owner', leftValue: "={{ $('Load Config').first().json.bot_type }}", rightValue: 'owner', operator: { type: 'string', operation: 'equals' } }
] }, options: {} };

const bx = bif.position[0], by = bif.position[1];
// 2) Broadcast: чек (PG awaiting)
wf.nodes.push({
  parameters: { operation: 'executeQuery',
    query: "SELECT EXISTS(SELECT 1 FROM broadcast_pending WHERE bot_id=$1 AND owner_id=$2 AND stage='awaiting_text' AND created_at > now() - interval '15 minutes') AS awaiting;",
    options: { queryReplacement: "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}" } },
  id: 'bc-await-chk', name: 'Broadcast: чек', type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
  position: [bx + 220, by + 120], alwaysOutputData: true, credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } }
});
// 3) Broadcast: как? (Code)
wf.nodes.push({
  parameters: { jsCode: [
    "const text = String($('Normalize').first().json.message.text || '').trim();",
    "const isCmd = /^\\/broadcast/i.test(text);",
    "let awaiting = false; try { awaiting = $json.awaiting === true; } catch (e) {}",
    "let isBroadcast = false, cmdText = '';",
    "if (isCmd) { isBroadcast = true; cmdText = text; }",
    "else if (awaiting && text.length > 0) { isBroadcast = true; cmdText = '/broadcast ' + text; }",
    "return [{ json: { isBroadcast, cmdText } }];"
  ].join("\n") },
  id: 'bc-await-how', name: 'Broadcast: как?', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [bx + 440, by + 120]
});
// 4) Broadcast: это рассылка? (IF) — клон broadcast? для typeVersion
const isB = JSON.parse(JSON.stringify(bif));
isB.name = 'Broadcast: это рассылка?'; isB.id = 'bc-await-isb';
isB.position = [bx + 660, by + 120];
isB.parameters = { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [
  { id: 'bc-isb', leftValue: '={{ $json.isBroadcast }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }
] }, options: {} };
wf.nodes.push(isB);

// 5) command_text из 'Broadcast: как?'
call.parameters.workflowInputs.value.command_text = "={{ $('Broadcast: как?').first().json.cmdText }}";

// 6) rewire
C['Команда: broadcast?'].main = [ [ { node: 'Broadcast: чек', type: 'main', index: 0 } ], [ { node: 'Язык: чек', type: 'main', index: 0 } ] ];
C['Broadcast: чек'] = { main: [ [ { node: 'Broadcast: как?', type: 'main', index: 0 } ] ] };
C['Broadcast: как?'] = { main: [ [ { node: 'Broadcast: это рассылка?', type: 'main', index: 0 } ] ] };
C['Broadcast: это рассылка?'] = { main: [ [ { node: 'Broadcast: вызов', type: 'main', index: 0 } ], [ { node: 'Язык: чек', type: 'main', index: 0 } ] ] };

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: awaiting-state рассылки (Broadcast: чек/как?/это рассылка?), command_text из Как?');
