#!/usr/bin/env node
/*
 * Собирает подворкфлоу CorrectLogTool01 «Инструмент — Коррекция записей» (correct_log):
 * list/update/delete записей food_log / workout_entry(+session) / measurement,
 * жёстко скоуплено bot_id+user_id родителя; правки по одному id; белые списки полей.
 * Структура — клон QueryTool00001 (trigger 1.2 → code 2 → postgres 2.6 → code 2).
 * Код узлов — cl-params-code.js / cl-answer-code.js рядом.
 * Запуск: node build-correctlog.js <output.json>
 */
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || '/tmp/deploy/cl-work.json';
const paramsCode = fs.readFileSync(path.join(__dirname, 'cl-params-code.js'), 'utf8');
const answerCode = fs.readFileSync(path.join(__dirname, 'cl-answer-code.js'), 'utf8');
if (!paramsCode.includes('delete_workout_session')) throw new Error('cl-params-code.js неполный');
if (!answerCode.includes('УДАЛЕНО')) throw new Error('cl-answer-code.js неполный');

const wf = {
  id: 'CorrectLogTool01',
  name: 'Инструмент — Коррекция записей',
  active: true,
  isArchived: false,
  nodes: [
    {
      parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [
        { name: 'bot_id', type: 'string' },
        { name: 'user_id', type: 'number' },
        { name: 'action', type: 'string' },
        { name: 'date', type: 'string' },
        { name: 'id', type: 'number' },
        { name: 'fields', type: 'string' }
      ] } },
      id: 'c1000000-0000-4000-8000-000000000001',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [-600, 0]
    },
    {
      parameters: { jsCode: paramsCode },
      id: 'c1000000-0000-4000-8000-000000000002',
      name: 'Параметры', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-360, 0]
    },
    {
      parameters: { operation: 'executeQuery', query: '={{ $json.query }}', options: { queryReplacement: '={{ $json.params }}' } },
      id: 'c1000000-0000-4000-8000-000000000003',
      name: 'Данные', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-120, 0],
      alwaysOutputData: true,
      credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } }
    },
    {
      parameters: { jsCode: answerCode },
      id: 'c1000000-0000-4000-8000-000000000004',
      name: 'Ответ агенту', type: 'n8n-nodes-base.code', typeVersion: 2, position: [120, 0]
    }
  ],
  connections: {
    'When Executed by Another Workflow': { main: [[{ node: 'Параметры', type: 'main', index: 0 }]] },
    'Параметры': { main: [[{ node: 'Данные', type: 'main', index: 0 }]] },
    'Данные': { main: [[{ node: 'Ответ агенту', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1' },
  staticData: null, meta: null, pinData: null
};
fs.writeFileSync(out, JSON.stringify([wf], null, 2));
console.log('OK: CorrectLogTool01 →', out);
