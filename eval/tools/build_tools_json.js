/**
 * Сборка tools.json из ЭТАЛОННОЙ ВЫГРУЗКИ боевого workflow + ужесточение схем для РФ-версии.
 *
 * Что берётся из эталона дословно: имя инструмента (parameters.name), его описание и список
 * параметров, которые заполняет МОДЕЛЬ, — то есть те входы подчинённого workflow, где стоит
 * $fromAI(...). Остальные входы (bot_id, user_id, chat_id, client_today, src_message_id и
 * прочие) подставляет n8n выражениями, модель их не видит и видеть не должна.
 *
 * Что дописывает стенд и зачем. В боевом боте у аргументов НЕТ схемы: $fromAI знает только
 * 'string' и 'number', а формат даты и перечисление значений живут в тексте подсказки.
 * У Claude это работает, у открытой модели — самое уязвимое место (числа и даты в аргументах).
 * Поэтому здесь к каждому параметру добавляются перечисления, форматы дат и обязательность:
 * по ним стенд считает долю валидных аргументов, а РФ-версия будет отбивать кривые вызовы
 * первым узлом подчинённого workflow (backstops/validate_args.js).
 *
 * Расхождения между эталоном и ужесточением печатаются отчётом: если в боевом появится новый
 * параметр или исчезнет старый, это будет видно сразу, а не через кривой прогон.
 *
 * Прогон: node eval/tools/build_tools_json.js
 */
const fs = require('fs');
const path = require('path');

const EXPORT = path.join(__dirname, '..', '..', 'knowledge', 'schema', 'ЭТАЛОН-main-workflow.json');
const OUT = path.join(__dirname, '..', 'tools.json');
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(EXPORT, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes.filter((n) => String(n.type || '').includes('toolWorkflow'));
// 11.09.2026 добавлен training_program — инструментов стало 21.
if (nodes.length !== 21) fail('в выгрузке ' + nodes.length + ' инструментов вместо 21');

// ---- Ужесточение: перечисления, форматы, обязательность и структура вложенных аргументов ----
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const TIME = { type: 'string', pattern: '^\\d{2}:\\d{2}$' };
const enu = (v) => ({ type: 'string', enum: v });
const STRICT = {
  log_food: { props: { eaten_on: DATE, meal_type: enu(['breakfast', 'lunch', 'dinner', 'snack']) },
    required: ['description'] },
  log_measurement: { props: { measured_on: DATE,
    items: { type: 'array', maxItems: 50, items: { type: 'object',
      properties: { metric: { type: 'string' }, value: { type: 'number' },
        unit: { type: 'string' }, measured_on: DATE }, required: ['metric', 'value'] } } } },
  log_workout: { props: { performed_on: DATE,
    session_type: enu(['strength', 'cardio', 'mixed', 'sport']),
    entries: { type: 'array', items: { type: 'object', properties: {
      activity: { type: 'string' }, kind: enu(['strength', 'cardio']),
      sets: { type: 'array', items: { type: 'object', properties: {
        reps: { type: 'number' }, weight_kg: { type: 'number' }, rpe: { type: 'number' } } } },
      duration_s: { type: 'number' }, distance_m: { type: 'number' },
      hr_avg: { type: 'number' }, steps: { type: 'number' } }, required: ['activity'] } } },
    required: ['entries'] },
  get_progress: { props: { domain: enu(['food', 'workout', 'measurement', 'records']),
    date: DATE, date_from: DATE, date_to: DATE }, required: ['domain'] },
  get_period_report: { required: ['period_days'] },
  get_progress_chart: { required: ['metric'] },
  calculate: { props: { kind: enu(['calories', 'one_rep_max']),
    goal_direction: enu(['cut', 'bulk', 'maintain']) }, required: ['kind'] },
  save_health: { props: { kind: enu(['allergen', 'preference', 'condition', 'injury', 'medication']),
    payload: { type: 'object' }, confirmed: { type: 'boolean' } }, required: ['kind', 'payload'] },
  add_exclusion: { props: { scope: enu(['load_tag', 'activity', 'ingredient', 'other']),
    // РФ-версия: ссылки на медицинский первоисточник в открытом контуре нет (КОНТУР-ЗДОРОВЬЯ.md),
    // поэтому source_type сужен до client_request на уровне схемы.
    source_type: enu(['client_request']) }, required: ['scope', 'value'] },
  check_activities: { props: { activities: { type: 'array', items: { type: 'string' } } },
    required: ['activities'] },
  check_recipe_allergens: { props: { ingredients: { type: 'array', items: { type: 'string' } } },
    required: ['ingredients'] },
  resolve_injury: { required: ['injury_id'] },
  // plan_started_on приходит внутри updates, отдельным аргументом его в эталоне нет.
  save_profile: { props: { updates: { type: 'object' } } },
  save_recipe: { props: { tags: { type: 'object' }, source: enu(['bot', 'client', 'found']),
    status: enu(['saved', 'favorite']),
    ingredients: { type: 'array', items: { type: 'object', properties: {
      item: { type: 'string' }, amount: { type: 'number' }, unit: { type: 'string' },
      kcal: { type: 'number' }, protein_g: { type: 'number' }, fat_g: { type: 'number' },
      carb_g: { type: 'number' } }, required: ['item'] } } },
    required: ['title', 'ingredients'] },
  correct_log: { props: { action: enu(['list_food', 'list_workout', 'list_measurement',
    'update_food', 'update_workout', 'update_measurement', 'delete_food', 'delete_workout',
    'delete_measurement', 'delete_workout_session']), date: DATE, fields: { type: 'object' } },
    required: ['action'] },
  set_reminder: { props: { action: enu(['create', 'list', 'cancel']),
    when_date: DATE, when_time: TIME, repeat: enu(['daily', 'weekly']),
    // Чем напоминание закрывается само (11.09.2026). Белый список тот же, что в
    // backstops/done_when.js — там же принудительный none для лекарств.
    // body_fat_pct в РФ-версии исключён: он уходит в контур здоровья, а тикер смотрит
    // открытую measurement (обоснование — в backstops/done_when.js).
    done_when: enu(['none',
      'measurement:weight', 'measurement:waist', 'measurement:hip',
      'food:breakfast', 'food:lunch', 'food:dinner', 'food:snack',
      'workout:strength', 'workout:cardio']) },
    required: ['action'] },
  training_program: { props: { action: enu(['get', 'set']),
    // days и cardio приходят строками с JSON внутри ($fromAI умеет только строку и число),
    // поэтому схемой проверяем тип, а состав — предохранителем program_days.js:
    // кардио в силовом дне отклоняется кодом, не передан cardio — прежний сохраняется.
    days: { type: 'string' }, cardio: { type: 'string' } },
    required: ['action'] },
  lookup_food: { required: ['query'] },
  web_search: { required: ['query'] },
  find_recipes: {},
  get_research_report: {},
};

const FROM_AI = /\$fromAI\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']+)'/;
const drift = [];
const tools = nodes.map((node) => {
  const name = node.parameters.name || fail('у узла ' + node.name + ' нет имени инструмента');
  const description = String(node.parameters.description || '').trim();
  if (!description) fail(name + ': пустое описание в эталоне');

  const props = {};
  const inputs = (node.parameters.workflowInputs || {}).value || {};
  for (const [key, expr] of Object.entries(inputs)) {
    const m = String(expr).match(FROM_AI);
    if (!m) continue;                       // подставляет n8n, модель этого не видит
    const [, argName, hint, type] = m;
    props[argName] = { type: type === 'number' ? 'number' : 'string', description: hint };
  }
  if (!Object.keys(props).length) fail(name + ': в эталоне нет ни одного аргумента модели');

  const strict = STRICT[name] || {};
  for (const [key, override] of Object.entries(strict.props || {})) {
    if (!props[key]) { drift.push(`${name}.${key}: ужесточение есть, а параметра в эталоне нет`); continue; }
    props[key] = { ...override, description: props[key].description };
  }
  for (const key of strict.required || []) {
    if (!props[key]) drift.push(`${name}.${key}: помечен обязательным, а в эталоне его нет`);
  }
  return { name, description,
    input_schema: { type: 'object', properties: props,
      required: (strict.required || []).filter((k) => props[k]), additionalProperties: false } };
});

fs.writeFileSync(OUT, JSON.stringify(tools, null, 2) + '\n', 'utf8');

// ---- Проверка фактом ----
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (back.length !== 21) fail('в tools.json ' + back.length + ' инструментов вместо 21');
const names = new Set(back.map((t) => t.name));
for (const must of ['lookup_food', 'log_food', 'log_workout', 'log_measurement', 'get_progress',
  'calculate', 'save_health', 'add_exclusion', 'check_activities', 'check_recipe_allergens',
  'set_reminder', 'correct_log', 'web_search', 'get_progress_chart', 'training_program']) {
  if (!names.has(must)) fail('в эталоне не нашёлся инструмент ' + must);
}
for (const key of Object.keys(STRICT)) {
  if (!names.has(key)) drift.push(`ужесточение для ${key}, а такого инструмента в эталоне нет`);
}
back.forEach((t) => (t.input_schema.required || []).forEach((r) => {
  if (!t.input_schema.properties[r]) fail(t.name + ': обязательный параметр ' + r + ' не описан');
}));

const bytes = JSON.stringify(back).length;
const args = back.reduce((a, t) => a + Object.keys(t.input_schema.properties).length, 0);
console.log('OK -> eval/tools.json | инструментов:', back.length, '| аргументов модели:', args,
  '| знаков:', bytes, '| ~токенов:', Math.round(bytes / 2.7));
console.log('  источник: эталонная выгрузка (имена, описания и состав аргументов — дословно)');
if (drift.length) {
  console.log('  РАСХОЖДЕНИЯ со схемой ужесточения (' + drift.length + '):');
  drift.forEach((d) => console.log('   -', d));
} else {
  console.log('  расхождений между эталоном и ужесточением нет');
}
