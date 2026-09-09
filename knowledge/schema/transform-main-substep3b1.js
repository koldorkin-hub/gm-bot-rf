// Трансформ основного workflow под подэтап 3b-1 (Журналы тренировок и еды — запись).
// Поверх текущего main. Идемпотентно.
// Запуск: node transform-main-substep3b1.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }
function schemaCols(names) { return names.map(n => ({ id: n[0], displayName: n[0], required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: n[1] })); }

// --- log_workout ---
ensure({
  parameters: {
    name: 'log_workout',
    description: 'Записывает ПРОВЕДЁННУЮ клиентом тренировку в журнал. Вызывай, когда клиент рассказал, что сделал на тренировке. entries — JSON-массив упражнений. Силовое: {activity:"название", kind:"strength", sets:[{reps,weight_kg,rpe}]} (по подходу). Кардио: {activity:"название", kind:"cardio", duration_s, distance_m, pace_s_per_km, hr_avg}. Разные виды можно в одной тренировке. performed_on — дата YYYY-MM-DD или пусто (сегодня). session_type, duration_min, note — по желанию.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'LogWorkoutTool001', cachedResultName: 'Инструмент — Журнал тренировок' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        performed_on: "={{ $fromAI('performed_on', 'дата YYYY-MM-DD или пусто для сегодня', 'string') }}",
        session_type: "={{ $fromAI('session_type', 'тип: strength|cardio|mixed|sport', 'string') }}",
        duration_min: "={{ $fromAI('duration_min', 'длительность, мин', 'number') }}",
        note: "={{ $fromAI('note', 'заметка', 'string') }}",
        entries: "={{ $fromAI('entries', 'JSON-массив упражнений с подходами/метриками', 'string') }}"
      },
      matchingColumns: [],
      schema: schemaCols([['bot_id','string'],['user_id','number'],['performed_on','string'],['session_type','string'],['duration_min','number'],['note','string'],['entries','string']]),
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000060',
  name: 'log_workout',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [1140, 840]
});
conns['log_workout'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- log_food ---
ensure({
  parameters: {
    name: 'log_food',
    description: 'Записывает приём пищи клиента в дневник еды. Вызывай, когда клиент рассказал, что съел. description — что съел (обязательно). kcal, protein_g, fat_g, carb_g — оцени по составу и весу порции и заполни (пока справочника нет, оцениваешь ты). meal_type — breakfast|lunch|dinner|snack. eaten_on — дата YYYY-MM-DD или пусто (сегодня).',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'LogFoodTool000001', cachedResultName: 'Инструмент — Дневник еды' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        eaten_on: "={{ $fromAI('eaten_on', 'дата YYYY-MM-DD или пусто для сегодня', 'string') }}",
        meal_type: "={{ $fromAI('meal_type', 'breakfast|lunch|dinner|snack', 'string') }}",
        description: "={{ $fromAI('description', 'что съел', 'string') }}",
        kcal: "={{ $fromAI('kcal', 'калории порции (оценка)', 'number') }}",
        protein_g: "={{ $fromAI('protein_g', 'белок, г', 'number') }}",
        fat_g: "={{ $fromAI('fat_g', 'жиры, г', 'number') }}",
        carb_g: "={{ $fromAI('carb_g', 'углеводы, г', 'number') }}"
      },
      matchingColumns: [],
      schema: schemaCols([['bot_id','string'],['user_id','number'],['eaten_on','string'],['meal_type','string'],['description','string'],['kcal','number'],['protein_g','number'],['fat_g','number'],['carb_g','number']]),
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000061',
  name: 'log_food',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [1140, 980]
});
conns['log_food'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- systemMessage: расширить блок трекинга на тренировки и еду ---
let sm = byName['AI Agent'].parameters.options.systemMessage;
if (!sm.includes('log_workout')) {
  const anchor = "Записи трекинга подтверждай коротко, без лишних уточнений.";
  const add =
    "Когда клиент рассказал о ПРОВЕДЁННОЙ тренировке — вызови log_workout (entries: силовое {activity,kind:'strength',sets:[{reps,weight_kg,rpe}]}, кардио {activity,kind:'cardio',duration_s,distance_m,pace_s_per_km,hr_avg}).\n" +
    "Когда клиент рассказал о приёме пищи — вызови log_food (description обязательно; kcal и БЖУ оцени сам по составу и весу порции).\n" +
    anchor;
  sm = sm.replace(anchor, add);
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', log_workout=' + !!byName['log_workout'] + ', log_food=' + !!byName['log_food'] + ', sm.workout=' + byName['AI Agent'].parameters.options.systemMessage.includes('log_workout'));
