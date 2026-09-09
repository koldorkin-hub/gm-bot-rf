// Трансформ основного workflow под 7b: инструмент get_research_report + правило.
// Поверх текущего main. Идемпотентно.
// Запуск: node transform-main-substep7b.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

ensure({
  parameters: {
    name: 'get_research_report',
    description: 'Достаёт ранее сохранённый доказательный разбор (/research) клиента из памяти. Вызывай, когда клиент просит скинуть, напомнить или показать прошлый разбор/исследование по теме — вместо запуска нового /research (экономит суточный лимит и токены). query — ключевое слово темы или пусто для последнего. Возвращает саммари и текст отчёта.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'GetResearchRep01', cachedResultName: 'Инструмент — Найти разбор' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        query: "={{ $fromAI('query', 'ключевое слово темы разбора или пусто', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'query', displayName: 'query', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000080',
  name: 'get_research_report',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [1400, 700]
});
conns['get_research_report'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// systemMessage: правило про сохранённые разборы
let sm = byName['AI Agent'].parameters.options.systemMessage;
if (!sm.includes('get_research_report')) {
  const add = "Когда клиент просит скинуть, напомнить или показать ПРОШЛЫЙ доказательный разбор (/research) по теме — вызови get_research_report и отдай сохранённый отчёт, НЕ запускай /research заново (это экономит суточный лимит и токены). Новый /research — только если сохранённого нет или клиент явно хочет свежий.\n\n";
  sm = sm.replace("=== ПРОФИЛЬ КЛИЕНТА", add + "=== ПРОФИЛЬ КЛИЕНТА");
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: get_research_report=' + !!byName['get_research_report'] + ', sm=' + byName['AI Agent'].parameters.options.systemMessage.includes('get_research_report'));
