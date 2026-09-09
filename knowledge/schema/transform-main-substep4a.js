// Трансформ основного workflow под подэтап 4a (Коллекции здоровья + бот-ведомый онбординг).
// Работает поверх текущего main. Обновляет Load Profile и Build Profile Context ВПЛОТЬ (не только add).
// Запуск: node transform-main-substep4a.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

// --- 1. Load Profile: профиль + карта здоровья одним запросом (всегда одна строка) ---
byName['Load Profile'].parameters.query =
  "SELECT (SELECT to_jsonb(p) FROM client_profile p WHERE p.bot_id=$1 AND p.user_id=$2) AS profile, " +
  "(SELECT json_agg(jsonb_build_object('substance',substance,'severity',severity,'confirmed',confirmed)) FROM allergen WHERE bot_id=$1 AND user_id=$2) AS allergens, " +
  "(SELECT json_agg(jsonb_build_object('area',area,'status',status)) FROM injury WHERE bot_id=$1 AND user_id=$2 AND status<>'resolved') AS injuries, " +
  "(SELECT json_agg(jsonb_build_object('name',name)) FROM condition WHERE bot_id=$1 AND user_id=$2 AND active) AS conditions, " +
  "(SELECT json_agg(jsonb_build_object('name',name,'dose',dose)) FROM medication WHERE bot_id=$1 AND user_id=$2 AND active) AS medications, " +
  "(SELECT json_agg(jsonb_build_object('item',item,'stance',stance)) FROM food_preference WHERE bot_id=$1 AND user_id=$2) AS preferences;";

// --- 2. Build Profile Context: полный бот-ведомый онбординг ---
const bpc = `
const msg = $('Normalize').first().json.message;
let row = {};
try { row = $('Load Profile').first().json || {}; } catch (e) { row = {}; }
const asObj = v => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const prof = asObj(row.profile) || {};
const allergens = asObj(row.allergens) || [];
const injuries = asObj(row.injuries) || [];
const conditions = asObj(row.conditions) || [];
const medications = asObj(row.medications) || [];
const preferences = asObj(row.preferences) || [];
const has = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
const discList = () => { let a = prof.disciplines; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = []; } } return Array.isArray(a) ? a : []; };
const known1 = k => { if (k === 'disciplines') return discList().length > 0; return has(prof[k]); };
const baseFields = [['sex','пол'],['birth_date','дата рождения'],['height_cm','рост'],['current_weight_kg','вес'],['timezone','часовой пояс'],['units','единицы']];
const ctxFields = [['experience_level','опыт'],['equipment','оборудование'],['days_per_week','дней в неделю'],['session_minutes','длительность тренировки'],['diet_type','тип питания']];
const goalKnown = known1('main_goal') && discList().length > 0;
const baseMissing = baseFields.filter(f => !known1(f[0])).map(f => f[1]);
const ctxMissing = ctxFields.filter(f => !known1(f[0])).map(f => f[1]);
const safetyDone = prof.onboarding_safety_done === true;
const onbDone = prof.onboarding_done === true;
const lines = [];
if (known1('main_goal')) lines.push('цель: ' + prof.main_goal);
if (discList().length) lines.push('виды спорта: ' + discList().map(d => d.discipline + (d.goal ? ' (' + d.goal + ')' : '')).join(', '));
for (const f of baseFields) if (known1(f[0])) lines.push(f[1] + ': ' + prof[f[0]]);
for (const f of ctxFields) if (known1(f[0])) lines.push(f[1] + ': ' + prof[f[0]]);
if (allergens.length) lines.push('аллергии/непереносимости: ' + allergens.map(a => a.substance + '/' + a.severity).join(', '));
if (injuries.length) lines.push('травмы: ' + injuries.map(i => i.area + '/' + i.status).join(', '));
if (conditions.length) lines.push('состояния: ' + conditions.map(c => c.name).join(', '));
if (medications.length) lines.push('препараты: ' + medications.map(m => m.name + (m.dose ? ' ' + m.dose : '')).join(', '));
if (preferences.length) lines.push('предпочтения в еде: ' + preferences.map(p => p.item + '/' + p.stance).join(', '));
const dir = [];
if (!onbDone) {
  dir.push('');
  dir.push('=== ОНБОРДИНГ: ВЕДЁШЬ ТЫ, НЕ КЛИЕНТ ===');
  dir.push('ЖЕЛЕЗНОЕ ПРАВИЛО: пока onboarding_done=false, ты НЕ выдаёшь тренировочные и пищевые планы, меню, схемы упражнений или добавок — НИ ПРИ КАКИХ просьбах клиента, даже если данных уже достаточно. Это требование безопасности. Порядок строгий: собрать данные → выдать саммари → получить подтверждение → и только потом планы.');
  dir.push('Сбор данных ведёшь ты: сам задавай вопросы, не жди, что клиент всё расскажет. Клиент может не знать, что тебе важно — твоя задача выяснить. Напомни, что отвечать можно и голосом.');
  if (!goalKnown) {
    if (!lines.length) {
      dir.push('ЭТО ПЕРВЫЙ КОНТАКТ С НОВЫМ КЛИЕНТОМ. Сначала коротко представься: ты персональный ИИ-тренер — поможешь с тренировками и питанием, будешь вести прогресс (вес, замеры, история), запоминаешь клиента, по запросу делаешь доказательные разборы. Скажи, что задашь несколько вопросов, чтобы всё было персонально и безопасно, и что отвечать можно текстом или голосом.');
    }
    dir.push('СЕЙЧАС выясни: основную цель и виды спорта/дисциплины (их может быть несколько). Сохрани через save_profile.');
  } else if (baseMissing.length) {
    dir.push('СЕЙЧАС собери базовые параметры (по одному-двум за раз): ' + baseMissing.join(', ') + '. Сохраняй через save_profile (возраст переведи в дату рождения).');
  } else if (!safetyDone) {
    dir.push('СЕЙЧАС обязательный этап — БЕЗОПАСНОСТЬ И ЗДОРОВЬЕ (идёт до вопросов о тренировочном контексте). Выясни по одной теме за реплику, даже если клиент сам не заговорил: (1) травмы текущие и перенесённые, (2) хронические состояния и болезни, (3) аллергии и пищевые непереносимости, (4) препараты и добавки. Каждый факт сразу сохраняй через save_health (kind = allergen | condition | injury | medication; confirmed=true при прямом ответе; «нет травм»/«аллергий нет» просто прими к сведению, сохранять нечего).');
    dir.push('КАК ТОЛЬКО по всем четырём темам есть ответ ИЛИ клиент сказал, что по здоровью добавить нечего — ПЕРВЫМ ЖЕ ДЕЙСТВИЕМ вызови save_profile с onboarding_safety_done=true. Это единственный способ отметить тему закрытой. НЕ задавай вопросы про дни, оборудование, опыт и питание, пока не выставил этот флаг.');
  } else if (ctxMissing.length) {
    dir.push('СЕЙЧАС уточни тренировочный и пищевой контекст: ' + ctxMissing.join(', ') + '. Сохрани через save_profile.');
  } else {
    dir.push('ВСЁ СОБРАНО, но onboarding_done ещё false. Твоя ЕДИНСТВЕННАЯ задача в этой реплике: выдай клиенту КРАТКОЕ САММАРИ всего собранного (цель, виды спорта, параметры, здоровье и ограничения, контекст тренировок и питания) и спроси, всё ли верно. НИКАКИХ планов, меню, упражнений или добавок сейчас — даже не начинай. Только после явного подтверждения клиента («да», «верно», «всё так») вызови save_profile с onboarding_done=true — и лишь в СЛЕДУЮЩЕЙ реплике сможешь строить план.');
  }
  dir.push('Если клиент прямо отказывается что-то называть — не настаивай, отметь пропуск и иди дальше; вернись к этому позже, только когда без факта нельзя дать безопасный ответ.');
} else {
  dir.push('');
  dir.push('Онбординг завершён. Новые факты профиля сохраняй через save_profile, здоровья — через save_health. Используй известное выше, не переспрашивай.');
}
let block;
if (!lines.length) block = 'Профиль клиента ПУСТ — это НОВЫЙ клиент, о нём пока ничего не известно.';
else block = 'Что уже известно о клиенте (НЕ переспрашивай это):\\n- ' + lines.join('\\n- ');
block += '\\n' + dir.join('\\n');
return [{ json: { message: msg, profile_block: block } }];
`.trim();
byName['Build Profile Context'].parameters.jsCode = bpc;

// --- 3. save_health (toolWorkflow) ---
ensure({
  parameters: {
    name: 'save_health',
    description: 'Сохраняет медицинский или пищевой факт клиента в карту здоровья. Вызывай, когда клиент сообщил: аллергию или непереносимость, хроническое состояние/болезнь, травму, принимаемый препарат или добавку, либо пищевое предпочтение (любит/не любит). kind — одно из: allergen, preference, condition, injury, medication. payload — JSON с полями по типу: allergen {substance, severity: allergy|intolerance}; preference {item, stance: like|dislike}; condition {name, since?(YYYY-MM-DD)}; injury {area, status: active|rehab|resolved, since?}; medication {name, dose?, schedule?, reason?, started_on?}. confirmed — true, если клиент сказал это прямо; false, если ты вывел из контекста (тогда переспроси у клиента). Одна запись за вызов.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'SaveHealthTool001', cachedResultName: 'Инструмент — Здоровье' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        kind: "={{ $fromAI('kind', 'тип факта: allergen|preference|condition|injury|medication', 'string') }}",
        payload: "={{ $fromAI('payload', 'JSON с полями факта по его типу', 'string') }}",
        confirmed: "={{ $fromAI('confirmed', 'true если клиент сказал прямо, иначе false', 'boolean') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'kind', displayName: 'kind', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'payload', displayName: 'payload', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'confirmed', displayName: 'confirmed', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'boolean' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c3000000-0000-4000-8000-000000000030',
  name: 'save_health',
  type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1,
  position: [660, 980]
});
conns['save_health'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', save_health=' + !!byName['save_health'] + ', LoadProfile.query.len=' + byName['Load Profile'].parameters.query.length + ', bpc.len=' + byName['Build Profile Context'].parameters.jsCode.length);
