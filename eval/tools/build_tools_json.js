/**
 * Сборка tools.json — двадцати схем инструментов агента для стенда.
 *
 * Описания берутся ДОСЛОВНО из knowledge/schema/transform-main-tools-slim.js (последняя
 * правка описаний в боевом боте), имена параметров сверены с входами подчинённых
 * workflow (knowledge/schema/*Tool*.json, узел Execute Workflow Trigger).
 * Типы, перечисления и форматы дописаны здесь: в n8n все параметры проходят строками
 * через $fromAI, а стенду нужна настоящая JSON-схема — по ней считается доля валидных
 * аргументов, главный порог качества (≥ 97%).
 *
 * Прогон: node eval/tools/build_tools_json.js
 */
const fs = require('fs');
const path = require('path');
const SCHEMA = path.join(__dirname, '..', '..', 'knowledge', 'schema');
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// ---- описания: дословно из трансформа ----
const src = fs.readFileSync(path.join(SCHEMA, 'transform-main-tools-slim.js'), 'utf8');
const desc = new Map();
for (let m, re = /^D\['([^']+)'\]\s*=\s*'([\s\S]*?)';$/gm; (m = re.exec(src)); ) {
  desc.set(m[1], m[2].replace(/\\'/g, "'"));
}
if (desc.size !== 20) fail('описаний извлечено ' + desc.size + ', а инструментов должно быть 20');

// Имя узла в n8n -> имя инструмента, каким его видит модель (как в системнике).
const NAME = { 'Web Search': 'web_search', 'Progress Chart': 'get_progress_chart' };
const d = (node) => desc.get(node) || fail('нет описания инструмента ' + node);

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'дата ГГГГ-ММ-ДД' };
const TIME = { type: 'string', pattern: '^\\d{2}:\\d{2}$', description: 'время ЧЧ:ММ' };
const num = (t) => ({ type: 'number', description: t });
const str = (t) => ({ type: 'string', description: t });
const enu = (v, t) => ({ type: 'string', enum: v, description: t });

const T = [
  ['lookup_food', 'lookup_food', { query: str('название продукта по-русски') }, ['query']],
  ['log_food', 'log_food', {
    description: str('что съедено, словами'),
    kcal: num('калорийность порции'), protein_g: num('белки, г'), fat_g: num('жиры, г'), carb_g: num('углеводы, г'),
    meal_type: enu(['breakfast', 'lunch', 'dinner', 'snack'], 'приём пищи'),
    eaten_on: DATE,
  }, ['description']],
  ['log_workout', 'log_workout', {
    entries: { type: 'array', description: 'записи активности', items: { type: 'object', properties: {
      activity: str('движение, не тренажёр'), kind: enu(['strength', 'cardio'], 'тип'),
      sets: { type: 'array', items: { type: 'object', properties: {
        reps: num('повторения'), weight_kg: num('вес, кг'), rpe: num('RPE 1-10') } } },
      duration_s: num('длительность кардио, с'), distance_m: num('дистанция, м'),
      hr_avg: num('средний пульс'), steps: num('шаги'),
    }, required: ['activity'] } },
    performed_on: DATE, session_type: enu(['strength', 'cardio', 'mixed', 'sport'], 'тип занятия'),
    duration_min: num('общая длительность, мин'), note: str('заметка'),
  }, ['entries']],
  ['log_measurement', 'log_measurement', {
    metric: str('короткий латинский ключ: weight, waist, body_fat_pct, systolic…'),
    value: num('значение'), unit: str('единица измерения'), measured_on: DATE,
    items: { type: 'array', description: 'несколько показателей одним вызовом', maxItems: 50,
      items: { type: 'object', properties: { metric: str('ключ'), value: num('значение'), unit: str('единица'), measured_on: DATE }, required: ['metric', 'value'] } },
  }, []],
  ['get_progress', 'get_progress', {
    domain: enu(['food', 'workout', 'measurement', 'records'], 'раздел дневника'),
    metric: str('ключ показателя, для domain=measurement'),
    date: DATE, date_from: DATE, date_to: DATE, period_days: num('дней назад от сегодня'),
  }, ['domain']],
  ['get_period_report', 'get_period_report', { period_days: num('30 — месяц, 7 — неделя') }, ['period_days']],
  ['get_progress_chart', 'Progress Chart', { metric: str('weight | waist | body_fat | hip | volume | 1rm:<упражнение> | cardio | pace') }, ['metric']],
  ['calculate', 'calculate', {
    kind: enu(['calories', 'one_rep_max'], 'что считаем'),
    weight: num('вес снаряда, кг — для one_rep_max'), reps: num('повторения — для one_rep_max'),
    target_pct: num('процент от 1ПМ'), goal_direction: enu(['cut', 'bulk', 'maintain'], 'направление цели'),
  }, ['kind']],
  ['save_profile', 'save_profile', {
    updates: { type: 'object', description: 'JSON только с реально узнанными полями профиля' },
    custom_instructions: str('пожелания о поведении бота, ПОЛНЫМ текстом'),
    active_plan: str('долгосрочный план, ПОЛНЫМ текстом'), plan_month: str('план на месяц'),
    plan_week: str('план на неделю'), plan_started_on: DATE,
  }, []],
  ['save_health', 'save_health', {
    kind: enu(['allergen', 'preference', 'condition', 'injury', 'medication'], 'тип записи'),
    payload: { type: 'object', description: 'поля по типу записи' },
    confirmed: { type: 'boolean', description: 'true — клиент сказал прямо' },
  }, ['kind', 'payload']],
  ['add_exclusion', 'add_exclusion', {
    scope: enu(['load_tag', 'activity', 'ingredient', 'other'], 'вид ограничения'),
    value: str('для load_tag — axial|impact|knee_dominant|hip_hinge|overhead|shoulder_load|spinal_flexion|rotational|lateral|grip|sprint|low_impact'),
    source_type: enu(['injury', 'condition', 'medication', 'client_request'], 'откуда ограничение'),
    note: str('пояснение'), source_ref: str('id травмы из save_health'),
  }, ['scope', 'value']],
  ['check_activities', 'check_activities', { activities: { type: 'array', items: { type: 'string' }, description: 'названия упражнений' } }, ['activities']],
  ['resolve_injury', 'resolve_injury', { injury_id: str('id травмы из профиля') }, ['injury_id']],
  ['find_recipes', 'find_recipes', { query: str('ключевое слово или пусто') }, []],
  ['save_recipe', 'save_recipe', {
    title: str('название'), servings: num('порций'), prep_minutes: num('время готовки'),
    tags: { type: 'object', description: '{meal, cuisine, method}' },
    source: enu(['bot', 'client', 'found'], 'источник'), status: enu(['saved', 'favorite'], 'статус'),
    ingredients: { type: 'array', description: 'состав на указанный объём', items: { type: 'object', properties: {
      item: str('продукт'), amount: num('количество'), unit: str('единица'),
      kcal: num('ккал'), protein_g: num('белки'), fat_g: num('жиры'), carb_g: num('углеводы') }, required: ['item'] } },
  }, ['title', 'ingredients']],
  ['check_recipe_allergens', 'check_recipe_allergens', {
    ingredients: { type: 'array', items: { type: 'string' }, description: 'продукты, РАЗЛОЖЕННЫЕ на компоненты и скрытые источники' },
  }, ['ingredients']],
  ['correct_log', 'correct_log', {
    action: enu(['list_food', 'list_workout', 'list_measurement', 'update_food', 'update_workout', 'update_measurement',
      'delete_food', 'delete_workout', 'delete_measurement', 'delete_workout_session'], 'действие'),
    id: str('id записи для update_*/delete_*'), date: DATE,
    fields: { type: 'object', description: 'только изменяемые поля' },
  }, ['action']],
  ['set_reminder', 'set_reminder', {
    action: enu(['create', 'list', 'cancel'], 'действие'),
    text: str('текст напоминания'), when_date: DATE, when_time: TIME,
    in_minutes: num('через сколько минут'), repeat: enu(['daily', 'weekly'], 'повтор'),
    id: str('номер напоминания для cancel'),
  }, ['action']],
  ['get_research_report', 'get_research_report', { query: str('1–2 ключевых слова темы; пусто — самый свежий') }, []],
  ['web_search', 'Web Search', { query: str('поисковый запрос по-русски') }, ['query']],
];

const tools = T.map(([name, node, props, required]) => ({
  name,
  description: d(node),
  input_schema: { type: 'object', properties: props, required, additionalProperties: false },
}));

const OUT = path.join(__dirname, '..', 'tools.json');
fs.writeFileSync(OUT, JSON.stringify(tools, null, 2) + '\n', 'utf8');

// ---- проверка фактом ----
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (back.length !== 20) fail('в tools.json ' + back.length + ' инструментов вместо 20');
const used = new Set(T.map(([, node]) => node));
[...desc.keys()].forEach((k) => { if (!used.has(k)) fail('описание ' + k + ' никуда не попало'); });
back.forEach((t) => {
  if (!/^[a-z_]+$/.test(t.name)) fail('имя инструмента не в змеином регистре: ' + t.name);
  if (!t.description.trim()) fail(t.name + ': пустое описание');
  (t.input_schema.required || []).forEach((r) => {
    if (!t.input_schema.properties[r]) fail(t.name + ': обязательный параметр ' + r + ' не описан');
  });
});
const bytes = JSON.stringify(back).length;
console.log('OK -> eval/tools.json | инструментов:', back.length,
  '| знаков:', bytes, '| ~токенов (÷2.7):', Math.round(bytes / 2.7));
console.log('  имена, отличные от имени узла n8n:', Object.entries(NAME).map(([a, b]) => a + '→' + b).join(', '),
  '— сверить с экспортом боевого workflow');
