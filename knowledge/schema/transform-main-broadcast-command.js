#!/usr/bin/env node
/*
 * main: команда /broadcast* (owner-бот) → вызов подворкфлоу Broadcast01.
 * Ветка: 'Команда: quiet?'[нет] → 'Команда: broadcast?' (bot_type=owner И текст startsWith /broadcast)
 *   → [да] 'Broadcast: вызов' (executeWorkflow Broadcast01) ; [нет] → 'Язык: чек' (как было).
 * Плюс systemMessage: инструкция раскладывать составные блюда на ингредиенты (lookup_food).
 * Идемпотентно (маркер: узел 'Команда: broadcast?'). Запуск: node transform-main-broadcast-command.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const C = wf.connections;
if (!byName['Команда: quiet?']) throw new Error('нет Команда: quiet?');
if (!byName['Язык: чек']) throw new Error('нет Язык: чек');
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');

if (!byName['Команда: broadcast?']) {
  // IF-узел (клон quiet? для typeVersion)
  const iff = JSON.parse(JSON.stringify(byName['Команда: quiet?']));
  iff.name = 'Команда: broadcast?'; iff.id = 'cmd-broadcast-if';
  iff.position = [ (byName['Команда: quiet?'].position[0]) , (byName['Команда: quiet?'].position[1]) + 140 ];
  iff.parameters = { conditions: { options: { caseSensitive: false, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [
    { id: 'bc-c1', leftValue: "={{ ($('Normalize').first().json.message.text || '').trim().toLowerCase() }}", rightValue: '/broadcast', operator: { type: 'string', operation: 'startsWith' } },
    { id: 'bc-c2', leftValue: "={{ $('Load Config').first().json.bot_type }}", rightValue: 'owner', operator: { type: 'string', operation: 'equals' } }
  ] }, options: {} };
  wf.nodes.push(iff);

  // executeWorkflow → Broadcast01
  const call = {
    parameters: {
      workflowId: { __rl: true, mode: 'list', value: 'Broadcast01', cachedResultName: 'Рассылка — сервисные уведомления' },
      workflowInputs: { mappingMode: 'defineBelow', value: {
        command_text: "={{ $('Normalize').first().json.message.text }}",
        owner_bot_id: "={{ $('Load Config').first().json.bot_id }}",
        owner_bot_token: "={{ $('Load Config').first().json.bot_token }}",
        owner_chat_id: "={{ $('Normalize').first().json.message.chat.id }}"
      }, matchingColumns: [], schema: [
        { id: 'command_text', displayName: 'command_text', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'owner_bot_id', displayName: 'owner_bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'owner_bot_token', displayName: 'owner_bot_token', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'owner_chat_id', displayName: 'owner_chat_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} },
    id: 'cmd-broadcast-call', name: 'Broadcast: вызов', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2,
    position: [ iff.position[0] + 220, iff.position[1] ]
  };
  wf.nodes.push(call);

  // rewire: quiet?[false] → broadcast? ; broadcast?[true]→call, [false]→Язык: чек
  const qc = C['Команда: quiet?'].main;
  qc[1] = [ { node: 'Команда: broadcast?', type: 'main', index: 0 } ];
  C['Команда: broadcast?'] = { main: [ [ { node: 'Broadcast: вызов', type: 'main', index: 0 } ], [ { node: 'Язык: чек', type: 'main', index: 0 } ] ] };
  console.log('OK: ветка /broadcast → Broadcast01 (owner-бот)');
} else { console.log('Команда: broadcast? уже есть — пропуск ветки'); }

// systemMessage: составные блюда
let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');
if (!sm.includes('составное блюдо')) {
  const a = 'Затем вызови log_food (description обязательно; kcal и БЖУ — из справочника/расчёта, не с потолка).';
  if (!sm.includes(a)) throw new Error('якорь lookup_food не найден в systemMessage');
  sm = sm.replace(a, a + ' Если это составное блюдо (лазанья, борщ, бефстроганов, паста и т.п.) и в справочнике его нет целиком — разложи на основные ингредиенты, найди каждый через lookup_food, сложи и честно пометь итог как приблизительный.');
  ai.parameters.options.systemMessage = sm;
  console.log('OK: systemMessage — разложение составных блюд');
} else { console.log('systemMessage уже про составные блюда — пропуск'); }

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('DONE');
