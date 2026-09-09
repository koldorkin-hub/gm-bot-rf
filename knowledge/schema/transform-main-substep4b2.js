// Трансформ основного workflow под подэтап 4b-2 (жизненный цикл исключений).
// Поверх текущего main (с 4b-1). Идемпотентно.
// Запуск: node transform-main-substep4b2.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

// --- 1. Load Profile: травмы с id ---
byName['Load Profile'].parameters.query =
  "SELECT (SELECT to_jsonb(p) FROM client_profile p WHERE p.bot_id=$1 AND p.user_id=$2) AS profile, " +
  "(SELECT json_agg(jsonb_build_object('substance',substance,'severity',severity,'confirmed',confirmed)) FROM allergen WHERE bot_id=$1 AND user_id=$2) AS allergens, " +
  "(SELECT json_agg(jsonb_build_object('id',id,'area',area,'status',status)) FROM injury WHERE bot_id=$1 AND user_id=$2 AND status<>'resolved') AS injuries, " +
  "(SELECT json_agg(jsonb_build_object('name',name)) FROM condition WHERE bot_id=$1 AND user_id=$2 AND active) AS conditions, " +
  "(SELECT json_agg(jsonb_build_object('name',name,'dose',dose)) FROM medication WHERE bot_id=$1 AND user_id=$2 AND active) AS medications, " +
  "(SELECT json_agg(jsonb_build_object('item',item,'stance',stance)) FROM food_preference WHERE bot_id=$1 AND user_id=$2) AS preferences, " +
  "(SELECT json_agg(jsonb_build_object('scope',scope,'value',value,'source',source_type)) FROM exclusion WHERE bot_id=$1 AND user_id=$2 AND active) AS exclusions;";

// --- 2. Build Profile Context: показать id рядом с травмой ---
let bpc = byName['Build Profile Context'].parameters.jsCode;
if (bpc.includes("i.area + '/' + i.status") && !bpc.includes("id ' + i.id")) {
  bpc = bpc.replace(
    "injuries.map(i => i.area + '/' + i.status)",
    "injuries.map(i => i.area + '/' + i.status + ' (id ' + i.id + ')')"
  );
  byName['Build Profile Context'].parameters.jsCode = bpc;
}

// --- 3. add_exclusion: добавить source_ref во вход инструмента ---
const ae = byName['add_exclusion'];
if (ae && !ae.parameters.workflowInputs.value.source_ref) {
  ae.parameters.workflowInputs.value.source_ref =
    "={{ $fromAI('source_ref', 'id травмы-первопричины из save_health (если ограничение из конкретной травмы), иначе не указывай', 'number') }}";
  ae.parameters.workflowInputs.schema.push(
    { id: 'source_ref', displayName: 'source_ref', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' }
  );
}

// --- 4. resolve_injury (toolWorkflow) ---
ensure({
  parameters: {
    name: 'resolve_injury',
    description: 'Закрывает травму клиента (статус resolved) и АВТОМАТИЧЕСКИ снимает связанные с ней ограничения. Вызывай, когда клиент сообщил, что травма зажила, прошла или больше не беспокоит. injury_id — id травмы (показан в профиле рядом с травмой). Одна травма за вызов.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'ResolveInjuryTool1', cachedResultName: 'Инструмент — Закрыть травму' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        injury_id: "={{ $fromAI('injury_id', 'id травмы для закрытия (из профиля)', 'number') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'injury_id', displayName: 'injury_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000042',
  name: 'resolve_injury',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [900, 980]
});
conns['resolve_injury'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- 5. systemMessage: правила связывания и закрытия ---
let sm = byName['AI Agent'].parameters.options.systemMessage;
if (!sm.includes('resolve_injury')) {
  const extra =
    "Когда создаёшь ограничение из КОНКРЕТНОЙ травмы — передавай в add_exclusion source_ref = id этой травмы (его вернул save_health). Тогда при заживлении ограничение снимется само.\n" +
    "Когда клиент говорит, что травма зажила, прошла или больше не беспокоит — вызови resolve_injury с id этой травмы (id показан в профиле рядом с травмой): травма закроется и связанные ограничения снимутся автоматически. Не снимай такие ограничения вручную.\n\n";
  sm = sm.replace("=== ПРОФИЛЬ КЛИЕНТА", extra + "=== ПРОФИЛЬ КЛИЕНТА");
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', resolve_injury=' + !!byName['resolve_injury'] + ', add_excl.source_ref=' + !!byName['add_exclusion'].parameters.workflowInputs.value.source_ref + ', bpc.id=' + byName['Build Profile Context'].parameters.jsCode.includes("id ' + i.id") + ', sm.resolve=' + byName['AI Agent'].parameters.options.systemMessage.includes('resolve_injury'));
