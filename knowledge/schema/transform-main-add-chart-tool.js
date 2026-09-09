#!/usr/bin/env node
/*
 * Регистрирует инструмент get_progress_chart в главном workflow: узел toolWorkflow
 * "Progress Chart" (клон структуры "Web Search") → связь ai_tool к AI Agent.
 * Передаёт metric ($fromAI) + bot_id/user_id/chat_id/bot_token из родителя.
 * Идемпотентно (маркер узла "Progress Chart"). Запуск: node transform-main-add-chart-tool.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (byName['Progress Chart']) { console.log('уже есть — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }
if (!byName['Web Search']) throw new Error('нет шаблона Web Search');
if (!byName['AI Agent']) throw new Error('нет AI Agent');

const n = JSON.parse(JSON.stringify(byName['Web Search']));
n.name = 'Progress Chart';
n.id = 'progchartool01';
n.position = [ (byName['Web Search'].position ? byName['Web Search'].position[0] : 0) + 40, (byName['Web Search'].position ? byName['Web Search'].position[1] : 0) + 220 ];
n.parameters = {
  name: 'get_progress_chart',
  description: 'Отправляет клиенту КАРТИНКУ-график динамики его показателя (по умолчанию вес; также талия, % жира, бёдра). Вызывай, когда клиент просит показать прогресс/динамику/график веса или замеров («покажи график», «как меняется мой вес», «динамику талии»). Сам график уходит клиенту картинкой — тебе НЕ нужно пересказывать цифры; просто кратко подтверди по результату инструмента. Возвращает поле response (статус: отправлено или мало данных).',
  source: 'database',
  workflowId: { __rl: true, mode: 'list', value: 'ProgressChart01', cachedResultName: 'Инструмент — График прогресса' },
  workflowInputs: {
    mappingMode: 'defineBelow',
    value: {
      metric: "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('metric', 'показатель для графика: weight (вес, по умолчанию), waist (талия), body_fat (% жира), hip (бёдра)', 'string') }}",
      bot_id: "={{ $('Load Config').first().json.bot_id }}",
      user_id: "={{ $('Normalize').first().json.message.from.id }}",
      chat_id: "={{ $('Normalize').first().json.message.chat.id }}",
      bot_token: "={{ $('Load Config').first().json.bot_token }}"
    },
    matchingColumns: [],
    schema: [
      { id: 'metric', displayName: 'metric', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'chat_id', displayName: 'chat_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      { id: 'bot_token', displayName: 'bot_token', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
    ],
    attemptToConvertTypes: false,
    convertFieldsToString: false
  }
};
wf.nodes.push(n);

if (!wf.connections['Progress Chart']) wf.connections['Progress Chart'] = {};
wf.connections['Progress Chart'].ai_tool = [ [ { node: 'AI Agent', type: 'ai_tool', index: 0 } ] ];

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: инструмент get_progress_chart (узел Progress Chart) добавлен + ai_tool → AI Agent');
