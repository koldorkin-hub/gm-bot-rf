// Трансформ основного workflow под подэтап 2 (Профиль + онбординг).
// Идемпотентно: узлы добавляются по имени, повторный прогон не плодит дубли.
// Запуск: node transform-main-substep2.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

// --- 1. Load Profile (Postgres, не роняет бота при сбое БД) ---
ensure({
  parameters: {
    operation: 'executeQuery',
    query: 'SELECT * FROM client_profile WHERE bot_id = $1 AND user_id = $2;',
    options: { queryReplacement: "={{ [$('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id] }}" }
  },
  id: 'c3000000-0000-4000-8000-000000000010',
  name: 'Load Profile',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
  position: [130, 150],
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
  onError: 'continueRegularOutput',
  alwaysOutputData: true
});

// --- 2. Build Profile Context (Code): рендер блока профиля + директива онбординга ---
const bpc = `
const msg = $('Normalize').first().json.message;
let prof = {};
try { prof = $('Load Profile').first().json || {}; } catch (e) { prof = {}; }
if (typeof prof !== 'object' || prof === null) prof = {};
const has = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
const fields = [
  ['main_goal','основная цель тренировок'],
  ['disciplines','дисциплины / виды спорта (можно несколько)'],
  ['sex','пол'],
  ['birth_date','дата рождения'],
  ['height_cm','рост'],
  ['current_weight_kg','текущий вес'],
  ['timezone','часовой пояс'],
  ['units','единицы измерения (метрические / имперские)'],
  ['experience_level','уровень тренировочного опыта'],
  ['equipment','доступное оборудование'],
  ['days_per_week','сколько дней в неделю готов тренироваться'],
  ['session_minutes','сколько времени на одну тренировку'],
  ['diet_type','тип питания'],
  ['target_kcal','целевые калории и БЖУ'],
  ['cooking_time_pref','сколько времени готов тратить на готовку'],
  ['cooking_skill','навык готовки'],
];
function known1(k){ let v = prof[k]; if (k==='disciplines'){ if (typeof v==='string'){ try{v=JSON.parse(v);}catch(e){v=[];} } return Array.isArray(v)&&v.length>0; } return has(v); }
const known = [], missing = [];
let nextQ = null;
for (const [k,label] of fields){
  if (known1(k)){
    let disp = prof[k];
    if (k==='disciplines'){ let a=prof[k]; if(typeof a==='string'){try{a=JSON.parse(a);}catch(e){a=[];}} disp = a.map(d=>(d&&d.discipline)?d.discipline+(d.goal?' ('+d.goal+')':''):String(d)).join(', '); }
    known.push(label + ': ' + disp);
  } else { missing.push(label); if (!nextQ) nextQ = label; }
}
const onboarding_done = prof.onboarding_done === true;
let block;
if (!known.length) block = 'Профиль клиента ПУСТ — клиент новый, пока ничего не знаем.';
else block = 'Что уже известно о клиенте (НЕ переспрашивай это):\\n- ' + known.join('\\n- ');
if (!onboarding_done && nextQ){
  block += '\\n\\n=== ОНБОРДИНГ ИДЁТ — профиль неполный ===';
  block += '\\nПРАВИЛО: наполняй профиль в живом разговоре, по одному вопросу за раз. В ЭТОЙ своей реплике ОБЯЗАТЕЛЬНО задай следующий недостающий вопрос — даже если клиент просто поздоровался или сказал что-то короткое. Не откладывай сбор профиля.';
  block += '\\nСЛЕДУЮЩИЙ ВОПРОС (задай именно его): узнай — ' + nextQ + '.';
  block += '\\nЕсли клиент задал свой вопрос — сперва коротко ответь по существу, ЗАТЕМ задай этот онбординг-вопрос.';
  block += '\\nКак только узнал факт профиля — СРАЗУ вызови инструмент save_profile с JSON только реально узнанных полей (ничего не выдумывай). Медзначимые факты (аллергии, травмы, состояния, препараты) подтверждай эхом («записал аллергию на орехи, верно?») и запоминай в разговоре.';
  block += '\\nОставшиеся поля по порядку приоритета: ' + missing.join(', ') + '. Когда собраны цель, дисциплины и база (пол, возраст, рост, вес) — вызови save_profile с onboarding_done=true.';
} else {
  block += '\\n\\nОнбординг завершён. Если клиент сообщил новый факт профиля — сохрани его через save_profile. Профиль выше можешь использовать в ответах, не переспрашивая.';
}
return [{ json: { message: msg, profile_block: block } }];
`.trim();
ensure({
  parameters: { jsCode: bpc },
  id: 'c3000000-0000-4000-8000-000000000011',
  name: 'Build Profile Context',
  type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [130, -170],
  onError: 'continueRegularOutput',
  alwaysOutputData: true
});

// --- 3. save_profile (toolWorkflow, ai_tool) ---
ensure({
  parameters: {
    name: 'save_profile',
    description: 'Сохраняет факты профиля клиента в долговременную память. Вызывай СРАЗУ, как узнал в разговоре любой факт профиля: цель, дисциплины/виды спорта, пол, дату рождения, рост, вес, часовой пояс, единицы, уровень опыта, оборудование, частоту и длительность тренировок, тип питания, целевые калории/БЖУ, время и навык готовки. Вход updates — JSON-объект ТОЛЬКО с реально узнанными полями (ничего не выдумывай). Ключи: display_name, birth_date(YYYY-MM-DD), sex(male|female|other), height_cm, timezone(IANA), units(metric|imperial), main_goal, goal_targets, goal_deadline(YYYY-MM-DD), motivation, disciplines([{discipline,goal,priority}]), experience_level, equipment, days_per_week, session_minutes, diet_type, target_kcal, target_protein_g, target_fat_g, target_carb_g, cooking_time_pref, cooking_skill, current_weight_kg, current_weight_on(YYYY-MM-DD), onboarding_done(true когда собраны цель, дисциплины и база). Возвращает подтверждение с перечнем сохранённых полей.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'ProfileTool00001', cachedResultName: 'Инструмент — Профиль' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        updates: "={{ $fromAI('updates', 'JSON-объект только с реально узнанными полями профиля клиента', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'updates', displayName: 'updates', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000012',
  name: 'save_profile',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [660, 560]
});

// --- 4. Перевязка связей ---
// Access Gate true-выход (main[0]) теперь -> Load Profile (false-выход main[1] не трогаем)
conns['Access Gate'].main[0] = [{ node: 'Load Profile', type: 'main', index: 0 }];
conns['Load Profile'] = { main: [[{ node: 'Build Profile Context', type: 'main', index: 0 }]] };
conns['Build Profile Context'] = { main: [[{ node: 'Switch', type: 'main', index: 0 }]] };
// save_profile как второй ai_tool у агента (Web Search остаётся)
conns['save_profile'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// --- 5. Инжект профиля в системный промпт агента ---
byName['AI Agent'].parameters.options = byName['AI Agent'].parameters.options || {};
byName['AI Agent'].parameters.options.systemMessage =
  "={{ $('Load Config').first().json.system_prompt }}\n\n=== ПРОФИЛЬ КЛИЕНТА (долговременная память) ===\n{{ $('Build Profile Context').first().json.profile_block }}";

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', есть Load Profile=' + !!byName['Load Profile'] + ', Build=' + !!byName['Build Profile Context'] + ', save_profile=' + !!byName['save_profile']);
