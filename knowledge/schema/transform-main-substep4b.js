// Трансформ основного workflow под подэтап 4b-1 (Исключения + защита).
// Работает поверх текущего main (с 4a). Идемпотентно.
// Запуск: node transform-main-substep4b.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

// --- 1. Load Profile: добавить активные ограничения в общий запрос ---
byName['Load Profile'].parameters.query =
  "SELECT (SELECT to_jsonb(p) FROM client_profile p WHERE p.bot_id=$1 AND p.user_id=$2) AS profile, " +
  "(SELECT json_agg(jsonb_build_object('substance',substance,'severity',severity,'confirmed',confirmed)) FROM allergen WHERE bot_id=$1 AND user_id=$2) AS allergens, " +
  "(SELECT json_agg(jsonb_build_object('area',area,'status',status)) FROM injury WHERE bot_id=$1 AND user_id=$2 AND status<>'resolved') AS injuries, " +
  "(SELECT json_agg(jsonb_build_object('name',name)) FROM condition WHERE bot_id=$1 AND user_id=$2 AND active) AS conditions, " +
  "(SELECT json_agg(jsonb_build_object('name',name,'dose',dose)) FROM medication WHERE bot_id=$1 AND user_id=$2 AND active) AS medications, " +
  "(SELECT json_agg(jsonb_build_object('item',item,'stance',stance)) FROM food_preference WHERE bot_id=$1 AND user_id=$2) AS preferences, " +
  "(SELECT json_agg(jsonb_build_object('scope',scope,'value',value,'source',source_type)) FROM exclusion WHERE bot_id=$1 AND user_id=$2 AND active) AS exclusions;";

// --- 2. Build Profile Context: инъекция активных ограничений (точечная правка jsCode) ---
let bpc = byName['Build Profile Context'].parameters.jsCode;
if (!bpc.includes('row.exclusions')) {
  bpc = bpc.replace(
    "const preferences = asObj(row.preferences) || [];",
    "const preferences = asObj(row.preferences) || [];\nconst exclusions = asObj(row.exclusions) || [];"
  );
  bpc = bpc.replace(
    "if (preferences.length) lines.push('предпочтения в еде: ' + preferences.map(p => p.item + '/' + p.stance).join(', '));",
    "if (preferences.length) lines.push('предпочтения в еде: ' + preferences.map(p => p.item + '/' + p.stance).join(', '));\nif (exclusions.length) lines.push('АКТИВНЫЕ ОГРАНИЧЕНИЯ (не рекомендовать эти нагрузки/активности): ' + exclusions.map(e => e.scope + ':' + e.value + (e.source ? ' [' + e.source + ']' : '')).join('; '));"
  );
  byName['Build Profile Context'].parameters.jsCode = bpc;
}

// --- 3. add_exclusion (toolWorkflow) ---
ensure({
  parameters: {
    name: 'add_exclusion',
    description: 'Фиксирует ограничение клиента, которое код будет проверять перед выдачей рекомендаций. Вызывай, когда установил ограничение из травмы, состояния, препарата или прямой просьбы клиента чего-то избегать. scope: load_tag (тип нагрузки — предпочтительно), activity (конкретное упражнение), ingredient (продукт), other. value: для load_tag один из тегов — axial, impact, knee_dominant, hip_hinge, overhead, shoulder_load, spinal_flexion, rotational, lateral, grip, sprint, low_impact; для activity/ingredient — название. source_type: injury|condition|medication|client_request. Одно ограничение за вызов. Пример: травма колена → два вызова: (load_tag, knee_dominant, injury) и (load_tag, impact, injury).',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'AddExclusionTool01', cachedResultName: 'Инструмент — Ограничение' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        scope: "={{ $fromAI('scope', 'load_tag|activity|ingredient|other', 'string') }}",
        value: "={{ $fromAI('value', 'тег нагрузки или название', 'string') }}",
        source_type: "={{ $fromAI('source_type', 'injury|condition|medication|client_request', 'string') }}",
        note: "={{ $fromAI('note', 'краткая причина', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'scope', displayName: 'scope', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'value', displayName: 'value', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'source_type', displayName: 'source_type', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'note', displayName: 'note', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000040',
  name: 'add_exclusion',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [900, 700]
});
conns['add_exclusion'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- 4. check_activities (toolWorkflow) ---
ensure({
  parameters: {
    name: 'check_activities',
    description: 'ДЕТЕРМИНИРОВАННО проверяет список активностей/упражнений против ограничений клиента (по тегам нагрузки и названиям). Вызывай ОБЯЗАТЕЛЬНО перед тем, как предложить клиенту любой набор упражнений, тренировку или план. activities — JSON-массив названий (например ["присед со штангой","бег","жим лёжа"]). Возвращает, какие ЗАПРЕЩЕНЫ (убери и замени), какие не в библиотеке (проверь вручную), какие допустимы.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'CheckActivitiesT01', cachedResultName: 'Инструмент — Проверка активностей' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        activities: "={{ $fromAI('activities', 'JSON-массив названий активностей', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'activities', displayName: 'activities', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000041',
  name: 'check_activities',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [900, 840]
});
conns['check_activities'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- 5. systemMessage: блок БЕЗОПАСНОСТЬ РЕКОМЕНДАЦИЙ (перед профилем) ---
let sm = byName['AI Agent'].parameters.options.systemMessage;
if (!sm.includes('БЕЗОПАСНОСТЬ РЕКОМЕНДАЦИЙ')) {
  const safety =
    "=== БЕЗОПАСНОСТЬ РЕКОМЕНДАЦИЙ ===\n" +
    "Когда узнаёшь об ограничении клиента (травма, состояние, препарат или прямая просьба чего-то избегать) — сразу создай ограничение инструментом add_exclusion. Для типа нагрузки scope=load_tag и тег из набора: axial, impact, knee_dominant, hip_hinge, overhead, shoulder_load, spinal_flexion, rotational, lateral, grip, sprint, low_impact. Для конкретного упражнения scope=activity, для продукта scope=ingredient. Одно ограничение — один вызов (травма колена → knee_dominant и impact отдельно).\n" +
    "ПЕРЕД тем как предложить клиенту ЛЮБОЙ набор упражнений, тренировку или активности — ОБЯЗАТЕЛЬНО вызови check_activities со списком их названий (JSON-массив) и убери из плана всё, что помечено запрещённым, заменив на безопасную альтернативу. Не полагайся на память — проверяй инструментом. Активные ограничения клиента продублированы в блоке профиля ниже.\n\n";
  sm = sm.replace("=== ПРОФИЛЬ КЛИЕНТА", safety + "=== ПРОФИЛЬ КЛИЕНТА");
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', add_exclusion=' + !!byName['add_exclusion'] + ', check_activities=' + !!byName['check_activities'] + ', bpc.excl=' + byName['Build Profile Context'].parameters.jsCode.includes('row.exclusions') + ', sm.safety=' + byName['AI Agent'].parameters.options.systemMessage.includes('БЕЗОПАСНОСТЬ РЕКОМЕНДАЦИЙ'));
