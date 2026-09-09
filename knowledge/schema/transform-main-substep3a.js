// Трансформ основного workflow под подэтап 3a (Измерения).
// Работает поверх текущего main (уже с профилем). Идемпотентно по именам узлов.
// Запуск: node transform-main-substep3a.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

// --- log_measurement (toolWorkflow) ---
ensure({
  parameters: {
    name: 'log_measurement',
    description: 'Сохраняет ОДНО измерение клиента в трекинг (универсальный ряд дата→метрика→число). Вызывай, когда клиент сообщил измеримый факт: вес, обхваты, % жира, давление, пульс покоя, часы сна, воду, настроение или любую метрику для отслеживания. metric — короткий латинский ключ (weight, waist, hip, chest, body_fat_pct, systolic, diastolic, resting_hr, sleep_hours, water_ml, mood или произвольный). value — число. unit — единица (kg, cm, %, mmHg, bpm, h, ml, score). measured_on — дата YYYY-MM-DD; если клиент не назвал дату — оставь пустым (запишется сегодня). Вес автоматически обновляет снимок в профиле.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'MeasureTool00001', cachedResultName: 'Инструмент — Измерение' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        metric: "={{ $fromAI('metric', 'короткий латинский ключ метрики, напр. weight', 'string') }}",
        value: "={{ $fromAI('value', 'числовое значение метрики', 'number') }}",
        unit: "={{ $fromAI('unit', 'единица измерения, напр. kg', 'string') }}",
        measured_on: "={{ $fromAI('measured_on', 'дата YYYY-MM-DD или пусто для сегодня', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'metric', displayName: 'metric', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'value', displayName: 'value', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'unit', displayName: 'unit', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'measured_on', displayName: 'measured_on', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000020',
  name: 'log_measurement',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [660, 700]
});

// --- get_progress (toolWorkflow) ---
ensure({
  parameters: {
    name: 'get_progress',
    description: 'Читает динамику метрики клиента ИЗ БАЗЫ за период (последнее значение, мин/макс/среднее, ряд по датам). Вызывай ВСЕГДА, когда клиент спрашивает про прогресс, динамику, историю или конкретное значение за период — не вспоминай из переписки. metric — латинский ключ метрики (как в log_measurement). period_days — число дней (по умолчанию 30). Возвращает цифры из базы; если записей нет — так и сообщает.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'QueryTool00001', cachedResultName: 'Инструмент — Прогресс' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        metric: "={{ $fromAI('metric', 'латинский ключ метрики, напр. weight', 'string') }}",
        period_days: "={{ $fromAI('period_days', 'число дней периода, по умолчанию 30', 'number') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'metric', displayName: 'metric', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'period_days', displayName: 'period_days', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000021',
  name: 'get_progress',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [660, 840]
});

// --- связи ai_tool -> AI Agent ---
conns['log_measurement'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };
conns['get_progress'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- обновляем systemMessage: system_prompt + ТРЕКИНГ + профиль ---
byName['AI Agent'].parameters.options = byName['AI Agent'].parameters.options || {};
byName['AI Agent'].parameters.options.systemMessage =
  "={{ $('Load Config').first().json.system_prompt }}\n\n" +
  "=== ТЕКУЩАЯ ДАТА ===\n" +
  "Сегодня: {{ $now.toFormat('yyyy-MM-dd') }} ({{ $now.toFormat('cccc') }}). Используй именно эту дату для трекинга, расчёта возраста и сроков. Никогда не выдумывай даты.\n\n" +
  "=== ТРЕКИНГ ДАННЫХ (память клиента) ===\n" +
  "Когда клиент сообщает измеримый факт — вес, обхват, % жира, давление, пульс покоя, сон, воду, настроение или любую метрику, которую просит отслеживать — вызови инструмент log_measurement (metric латиницей: weight, waist, hip, chest, body_fat_pct, systolic, diastolic, resting_hr, sleep_hours, water_ml, mood или произвольный короткий; value — число; unit — единица). Дату не спрашивай без нужды: если клиент не назвал другую, засчитывается сегодня.\n" +
  "Когда клиент спрашивает про свой прогресс, динамику, историю или «сколько/какой был» за период — НЕ вспоминай из переписки, вызови get_progress (metric + период в днях) и отвечай строго по цифрам из базы. Если база вернула «нет записей» — так и скажи, не придумывай.\n" +
  "Записи трекинга подтверждай коротко, без лишних уточнений.\n\n" +
  "=== ПРОФИЛЬ КЛИЕНТА (долговременная память) ===\n" +
  "{{ $('Build Profile Context').first().json.profile_block }}";

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', log_measurement=' + !!byName['log_measurement'] + ', get_progress=' + !!byName['get_progress']);
