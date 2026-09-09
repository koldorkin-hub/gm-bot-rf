#!/usr/bin/env node
/*
 * main: кнопочная guided-выдача доступа (/grant). Роутер после роутера рассылки:
 * 'Broadcast: это рассылка?'[нет] → 'Grant: чек' (PG: свежий grant_awaiting?) → 'Grant: как?'
 *   (Code: isGrant + cmdText — команда /grant* ИЛИ текст-в-ожидании) → 'Grant: это выдача?'
 *   → [да] 'Grant: вызов' (executeWorkflow AccessGrant01) / [нет] 'Язык: чек'.
 * '/grant' убран из 'Админ?' (там остаются revoke/access/list — одиночные через fn_admin_access).
 * Идемпотентно (маркер: 'Grant: чек'). Запуск: node transform-main-grant-menu.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const C = wf.connections;
const isb = byName['Broadcast: это рассылка?']; if (!isb) throw new Error('нет Broadcast: это рассылка? (сначала broadcast-await)');
if (!byName['Язык: чек']) throw new Error('нет Язык: чек');
if (!byName['Админ?']) throw new Error('нет Админ?');

if (byName['Grant: чек']) { console.log('уже есть grant-роутер — пропуск'); process.exit(0); }

// 1) убрать grant из Админ?
const admCond = byName['Админ?'].parameters.conditions.conditions[0];
if (admCond.leftValue.includes('(grant|revoke|access|list)')) {
  admCond.leftValue = admCond.leftValue.replace('(grant|revoke|access|list)', '(revoke|access|list)');
  console.log('OK: /grant убран из Админ?');
}

const bx = isb.position[0], by = isb.position[1];
// 2) Grant: чек
wf.nodes.push({ parameters: { operation: 'executeQuery',
    query: "SELECT EXISTS(SELECT 1 FROM grant_awaiting WHERE bot_id=$1 AND owner_id=$2 AND created_at > now() - interval '15 minutes') AS awaiting;",
    options: { queryReplacement: "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}" } },
  id: 'grant-chk', name: 'Grant: чек', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [bx + 220, by + 140], alwaysOutputData: true, credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } } });
// 3) Grant: как?
wf.nodes.push({ parameters: { jsCode: [
    "const text = String($('Normalize').first().json.message.text || '').trim();",
    "const isCmd = /^\\/grant/i.test(text);",
    "let awaiting = false; try { awaiting = $json.awaiting === true; } catch (e) {}",
    "let isGrant = false, cmdText = '';",
    "if (isCmd) { isGrant = true; cmdText = text; }",
    "else if (awaiting && text.length > 0) { isGrant = true; cmdText = '/grant ' + text; }",
    "return [{ json: { isGrant, cmdText } }];"
  ].join("\n") }, id: 'grant-how', name: 'Grant: как?', type: 'n8n-nodes-base.code', typeVersion: 2, position: [bx + 440, by + 140] });
// 4) Grant: это выдача? (IF)
wf.nodes.push({ parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'grant-isg', leftValue: '={{ $json.isGrant }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } } ] }, options: {} },
  id: 'grant-isg-if', name: 'Grant: это выдача?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [bx + 660, by + 140] });
// 5) Grant: вызов
wf.nodes.push({ parameters: {
    workflowId: { __rl: true, mode: 'list', value: 'AccessGrant01', cachedResultName: 'Доступ — выдача владельцем' },
    workflowInputs: { mappingMode: 'defineBelow', value: {
      command_text: "={{ $('Grant: как?').first().json.cmdText }}",
      owner_bot_id: "={{ $('Load Config').first().json.bot_id }}",
      owner_bot_token: "={{ $('Load Config').first().json.bot_token }}",
      owner_chat_id: "={{ $('Normalize').first().json.message.chat.id }}"
    }, matchingColumns: [], schema: [
      { id: 'command_text', displayName: 'command_text', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'owner_bot_id', displayName: 'owner_bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'owner_bot_token', displayName: 'owner_bot_token', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'owner_chat_id', displayName: 'owner_chat_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
    ], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} },
  id: 'grant-call', name: 'Grant: вызов', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [bx + 880, by + 140] });

// 6) rewire: это рассылка?[нет] → Grant: чек ; grant-chain
isb.__x = 1;
C['Broadcast: это рассылка?'].main = [ C['Broadcast: это рассылка?'].main[0], [ { node: 'Grant: чек', type: 'main', index: 0 } ] ];
C['Grant: чек'] = { main: [ [ { node: 'Grant: как?', type: 'main', index: 0 } ] ] };
C['Grant: как?'] = { main: [ [ { node: 'Grant: это выдача?', type: 'main', index: 0 } ] ] };
C['Grant: это выдача?'] = { main: [ [ { node: 'Grant: вызов', type: 'main', index: 0 } ], [ { node: 'Язык: чек', type: 'main', index: 0 } ] ] };

delete isb.__x;
fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: guided grant-роутер (Grant: чек/как?/это выдача?/вызов) + /grant вне Админ?');
