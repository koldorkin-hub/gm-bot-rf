// Трансформ основного workflow под подэтап 4c (Калькуляторы в коде).
// Поверх текущего main. Идемпотентно.
// Запуск: node transform-main-substep4c.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

// --- calculate (toolWorkflow) ---
ensure({
  parameters: {
    name: 'calculate',
    description: 'Выполняет числовые расчёты ДЕТЕРМИНИРОВАННО в коде. kind=calories — норма калорий и БЖУ (Mifflin-St Jeor): берёт пол/возраст/рост/вес/активность ИЗ ПРОФИЛЯ сам, проверяет свежесть веса; можно передать goal_direction (cut|bulk|maintain), иначе определит по цели. kind=one_rep_max — расчётный разовый максимум и веса по процентам: передай weight (рабочий вес) и reps (повторы), опционально target_pct. Вызывай для ЛЮБЫХ расчётов калорий, БЖУ, TDEE, дефицита/профицита, 1ПМ и рабочих весов по проценту — никогда не считай сам.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'CalcTool00000001', cachedResultName: 'Инструмент — Калькулятор' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        kind: "={{ $fromAI('kind', 'calories | one_rep_max', 'string') }}",
        weight: "={{ $fromAI('weight', 'рабочий вес для 1ПМ, кг', 'number') }}",
        reps: "={{ $fromAI('reps', 'число повторов для 1ПМ', 'number') }}",
        target_pct: "={{ $fromAI('target_pct', 'нужный процент от 1ПМ, опционально', 'number') }}",
        goal_direction: "={{ $fromAI('goal_direction', 'cut|bulk|maintain для калорий, опционально', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'weight', displayName: 'weight', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'reps', displayName: 'reps', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'target_pct', displayName: 'target_pct', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'goal_direction', displayName: 'goal_direction', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000050',
  name: 'calculate',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [1140, 700]
});
conns['calculate'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- systemMessage: правило расчётов ---
let sm = byName['AI Agent'].parameters.options.systemMessage;
if (!sm.includes('=== РАСЧЁТЫ ===')) {
  const calc =
    "=== РАСЧЁТЫ ===\n" +
    "Любые числовые расчёты — норму калорий и БЖУ, TDEE, дефицит/профицит, процент от 1ПМ, рабочие веса по проценту — делай ТОЛЬКО инструментом calculate. НИКОГДА не считай в уме, не оценивай на глаз и не выводи формулы вручную, даже если клиент просит «посчитай сам» или «без калькулятора». kind=calories берёт данные из профиля сам и проверяет свежесть веса; kind=one_rep_max — передай weight и reps. Если инструмент вернул, что данных не хватает или вес устарел — передай это клиенту и не выдумывай цифры.\n\n";
  sm = sm.replace("=== ПРОФИЛЬ КЛИЕНТА", calc + "=== ПРОФИЛЬ КЛИЕНТА");
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', calculate=' + !!byName['calculate'] + ', sm.calc=' + byName['AI Agent'].parameters.options.systemMessage.includes('=== РАСЧЁТЫ ==='));
