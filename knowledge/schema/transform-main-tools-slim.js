/**
 * Главный workflow: сжатие описаний инструментов агента. ~22k знаков -> ~13k.
 *
 * Схемы двадцати инструментов идут в каждый вызов вместе с системником (≈7–9k токенов).
 * Правила поведения живут в системнике — в описании инструмента должно остаться
 * только ЧТО он делает и КАКИЕ параметры принимает.
 *
 * Попутно чинятся два устаревших указания, противоречащих промпту:
 *  - log_food: «пока справочника нет, оцениваешь ты» — справочник lookup_food давно есть;
 *  - Progress Chart: «в сводке /progress по видам спорта» — отчёт теперь строит ОДИН график веса.
 * И убрана ссылка на несуществующую строку «СЕЙЧАС У КЛИЕНТА» в get_progress.
 *
 * Прогон:  node schema/transform-main-tools-slim.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-tools-slim.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const node = (n) => wf.nodes.find((x) => x.name === n) || fail('нет инструмента ' + n);

const before = wf.nodes
  .filter((n) => n.type && (n.type.includes('toolWorkflow') || n.name === 'Web Search'))
  .reduce((a, n) => a + String(n.parameters.description || '').length + JSON.stringify((n.parameters.workflowInputs || {}).value || {}).length, 0);

const D = {}; // новые описания
D['Web Search'] = 'Веб-поиск по актуальным данным: свежие исследования, новые препараты и добавки, цены, версии, вопросы «что сейчас / последние данные». Не для того, что знаешь сам (техника, физиология, общие принципы питания). Вход — запрос по-русски. Возвращает text (сводка) и sources (ссылки).';

D['save_profile'] = 'Сохраняет факты профиля в долговременную память — вызывай СРАЗУ, как узнал любой из них. updates — JSON только с реально узнанными полями: display_name, birth_date, sex(male|female|other), height_cm, timezone(IANA), units, main_goal, goal_targets, goal_deadline, motivation, disciplines([{discipline,goal,priority}]), experience_level, equipment, days_per_week, session_minutes, diet_type, target_kcal, target_protein_g, target_fat_g, target_carb_g, cooking_time_pref, cooking_skill, current_weight_kg, current_weight_on, onboarding_done(true когда собраны цель, дисциплины и база). Отдельные ключи (каждый — ПОЛНЫМ текстом поля, поле перезаписывается): custom_instructions (пожелания о твоём поведении), active_plan (долгосрочный план), plan_month, plan_week, plan_started_on(YYYY-MM-DD, старт программы). Даты — YYYY-MM-DD.';

D['log_measurement'] = 'Записывает измерения в трекинг. Один показатель: metric (короткий латинский ключ: weight, waist, hip, chest, body_fat_pct, systolic, diastolic, resting_hr, sleep_hours, water_ml, mood, steps, ferritin, tsh…), value (число), unit, measured_on (YYYY-MM-DD, пусто = сегодня). НЕСКОЛЬКО показателей — ОДНИМ вызовом через items: JSON-массив [{metric,value,unit,measured_on}], до 50. Вес автоматически обновляет снимок в профиле.';

D['get_progress'] = 'Читает дневник клиента ИЗ БАЗЫ по дням. domain=food (еда по дням с ккал и итогами), workout (тренировки по дням с подходами и весами), measurement (динамика метрики, нужен metric), records (личные рекорды). Период: date=ГГГГ-ММ-ДД — один день (дату бери из календаря в профиле); date_from+date_to — диапазон; иначе period_days назад от сегодня (по умолчанию 30). Вызывай на любой вопрос «что я ел/делал/что записано», про прогресс и объёмы — не вспоминай из переписки.';

D['save_health'] = 'Сохраняет медицинский или пищевой факт в карту здоровья. kind: allergen|preference|condition|injury|medication. payload — JSON по типу: allergen {substance, severity: allergy|intolerance}; preference {item, stance: like|dislike}; condition {name, since?}; injury {area, status: active|rehab|resolved, since?}; medication {name, dose?, schedule?, reason?, started_on?}. confirmed — true если клиент сказал прямо, false если вывел из контекста (тогда переспроси). Одна запись за вызов; возвращает id.';

D['add_exclusion'] = 'Фиксирует ограничение, которое код проверяет перед рекомендациями. scope: load_tag (тип нагрузки, предпочтительно), activity (упражнение), ingredient (продукт), other. value для load_tag — один из: axial, impact, knee_dominant, hip_hinge, overhead, shoulder_load, spinal_flexion, rotational, lateral, grip, sprint, low_impact; для остальных — название. source_type: injury|condition|medication|client_request. source_ref — id травмы из save_health, если ограничение из неё (тогда снимется при заживлении). Одно ограничение за вызов.';

D['check_activities'] = 'Детерминированно проверяет список упражнений против ограничений клиента. activities — JSON-массив названий. Возвращает: запрещено (убрать и заменить), не в библиотеке (проверь вручную), допустимо. ОБЯЗАТЕЛЕН перед любым набором упражнений или планом.';

D['resolve_injury'] = 'Закрывает травму (resolved) и автоматически снимает связанные ограничения. injury_id — id из профиля. Вызывай, когда клиент сообщил, что травма зажила.';

D['calculate'] = 'Детерминированные расчёты. kind=calories — норма калорий и БЖУ по профилю (сам берёт пол, возраст, рост, вес, активность; проверяет свежесть веса; goal_direction cut|bulk|maintain опционально). kind=one_rep_max — расчётный 1ПМ и веса по процентам: weight, reps, опционально target_pct. Любые расчёты калорий, БЖУ, дефицита, 1ПМ — только здесь.';

D['log_workout'] = 'Записывает проведённую активность. entries — JSON-массив: силовое {activity, kind:"strength", sets:[{reps, weight_kg, rpe}]}; кардио {activity, kind:"cardio", duration_s (обязательно), distance_m, hr_avg (если клиент назвал пульс — точнее расход)}; шаги {activity:"Шаги", kind:"cardio", steps}. activity — движение, не тренажёр. Расход ккал считает система — своих цифр не передавай. performed_on — YYYY-MM-DD или пусто (сегодня клиента); duration_min — общая длительность (по ней расход силовой части); session_type strength|cardio|mixed|sport; note.';

D['log_food'] = 'Записывает приём пищи в дневник. description (обязательно), kcal, protein_g, fat_g, carb_g — из lookup_food и пересчёта порции через calculate (не на глаз; чего нет в справочнике — оценка с пометкой «приблизительно»). meal_type breakfast|lunch|dinner|snack. eaten_on — YYYY-MM-DD или пусто (сегодня клиента).';

D['find_recipes'] = 'Ищет рецепт в библиотеке клиента — вызывай ПЕРВЫМ на просьбу о рецепте, меню или блюде. query — ключевое слово или пусто для всех. Возвращает рецепты с БЖУ на порцию.';

D['check_recipe_allergens'] = 'Детерминированно проверяет продукты против аллергий и непереносимостей клиента (прямые, категории, составные вроде марципан→орехи). ingredients — JSON-массив названий, РАЗЛОЖЕННЫХ на компоненты и скрытые источники (сурими→["рыба"], песто→["кедровые орехи","сыр"]). ОБЯЗАТЕЛЕН перед рецептом и на любой вопрос «можно ли мне X». БЛОКИРОВКА — не предлагать, заменить.';

D['save_recipe'] = 'Сохраняет рецепт в библиотеку. title, servings, prep_minutes, tags (JSON {meal,cuisine,method}), source bot|client|found, status saved|favorite, ingredients — JSON-массив {item, amount, unit, kcal, protein_g, fat_g, carb_g} на указанный объём. БЖУ на порцию считает код — показывай цифры из ответа. Повтор по названию не создаётся.';

D['get_research_report'] = 'Достаёт сохранённый /research-разбор и САМ отправляет PDF клиенту (новый разбор не запускает, лимит не тратит). query — 1–2 ключевых слова темы (поиск по основам слов); пустой — самый свежий; при промахе вернёт список сохранённых тем. Вызывай всегда, когда клиент просит прислать или вспомнить разбор.';

D['Progress Chart'] = 'Отправляет клиенту картинку-график. metric: weight, waist, body_fat, hip; volume (силовой объём по неделям); 1rm:<упражнение> (1ПМ движения); cardio (км в неделю); pace (темп бега). В отчёте /progress — только weight; остальное по прямой просьбе клиента. Цифры не пересказывай — график уже у клиента. Возвращает response (отправлено / мало данных).';

D['lookup_food'] = 'Точные БЖУ продукта на 100 г из справочника. query — название по-русски («куриная грудка», «гречка»). Вызывай для каждого значимого продукта перед log_food и на вопросы о калориях; пересчёт на порцию — через calculate. Нет в справочнике — так и ответит: тогда оцени сам и предупреди о приблизительности.';

D['correct_log'] = 'Исправляет или удаляет ошибочные записи. Порядок: action=list_food|list_workout|list_measurement с date — получить записи дня с id; затем update_food|update_workout|update_measurement с id и fields (JSON только изменяемых полей: еда description/kcal/protein_g/fat_g/carb_g/meal_type/eaten_on; тренировка activity_name/reps/weight_kg/distance_m/duration_s/set_no; замер metric/value/unit/measured_on) или delete_food|delete_workout|delete_measurement|delete_workout_session с id. Удаление — только по явному подтверждению.';

D['set_reminder'] = 'Напоминания клиенту — бот умеет напоминать сам. action=create: text + либо when_date (ГГГГ-ММ-ДД из справки) и when_time (ЧЧ:ММ клиента), либо in_minutes; repeat daily|weekly для регулярных. action=list — активные с номерами. action=cancel + id. Придёт само в назначенное время.';

D['get_period_report'] = 'Готовый свод за период для отчёта о прогрессе: тренировки, питание, расход, вес, шаги, замеры, рекорды — посчитано системой. period_days: 30 месяц, 7 неделя. Вызывай на /progress и любую просьбу про итоги; числа не пересчитывай.';

Object.entries(D).forEach(([name, desc]) => { node(name).parameters.description = desc; });

// Подсказки $fromAI — тоже часть схемы; укоротить самые длинные, не меняя имён параметров.
const H = (name, key, hint) => {
  const n = node(name); const v = n.parameters.workflowInputs.value;
  if (!v[key]) fail(name + ': нет параметра ' + key);
  const m = String(v[key]).match(/\$fromAI\('([^']+)',\s*'[^']*',\s*'([^']+)'\)/);
  if (!m) return; // не fromAI — не трогаем
  v[key] = "={{ $fromAI('" + m[1] + "', '" + hint + "', '" + m[2] + "') }}";
};
H('get_progress', 'date', 'один день ГГГГ-ММ-ДД (дата из календаря профиля); пусто если период');
H('get_progress', 'date_from', 'начало диапазона ГГГГ-ММ-ДД или пусто');
H('get_progress', 'date_to', 'конец диапазона ГГГГ-ММ-ДД или пусто');
H('Progress Chart', 'metric', 'weight | waist | body_fat | hip | volume | 1rm:<упражнение> | cardio | pace');
H('correct_log', 'action', 'list_* | update_* | delete_* по журналу food/workout/measurement, delete_workout_session');
H('log_measurement', 'items', 'JSON-массив [{metric,value,unit,measured_on}] если показателей несколько, иначе пусто');
H('set_reminder', 'when_date', 'ГГГГ-ММ-ДД из справки');
H('add_exclusion', 'source_ref', 'id травмы из save_health, если ограничение из неё');
H('save_profile', 'updates', 'JSON только с реально узнанными полями');

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// ---- проверка ----
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const tools = w.nodes.filter((n) => n.type && (n.type.includes('toolWorkflow') || n.name === 'Web Search'));
const after = tools.reduce((a, n) => a + String(n.parameters.description || '').length + JSON.stringify((n.parameters.workflowInputs || {}).value || {}).length, 0);
tools.forEach((n) => {
  const v = (n.parameters.workflowInputs || {}).value || {};
  Object.entries(v).forEach(([k, s]) => {
    const str = String(s);
    if ((str.match(/\{\{/g) || []).length !== (str.match(/\}\}/g) || []).length) fail(n.name + '.' + k + ': непарные {{ }}');
  });
  if (!String(n.parameters.description || '').trim()) fail(n.name + ': пустое описание');
});
if (String(node('log_food').parameters.description).includes('пока справочника нет')) fail('устаревшая инструкция в log_food осталась');
if (String(node('Progress Chart').parameters.description).includes('по видам спорта')) fail('устаревшая инструкция в Progress Chart осталась');
if (String(node('get_progress').parameters.description).includes('СЕЙЧАС У КЛИЕНТА')) fail('ссылка на несуществующую строку осталась');
console.log('OK ->', OUT, '| схемы инструментов:', before, '->', after, 'знаков, сжатие', Math.round(100 - 100 * after / before) + '%');
