/**
 * Главный workflow: расход калорий на активностях видим агенту и учтён в дефиците.
 *
 * Повод (владелец, 20.08.2026): «кардио, шаги, плавание бот помнит, но в базе их нет,
 * и недельный дефицит считается только по еде — это неправильно».
 *
 * Что делаем:
 *  1. Выписка дня показывает не только съеденное, но и ПОТРАЧЕННОЕ на активности
 *     (минуты и ккал), причём цифры приходят из базы, а не из головы агента.
 *  2. Инструменту log_workout передаём дату клиента (его пояс) — чтобы тренировка
 *     после полуночи не уезжала на вчера.
 *  3. Описание инструмента: кардио, шаги и плавание записывать ОБЯЗАТЕЛЬНО,
 *     с длительностью и, если клиент назвал, средним пульсом.
 *  4. Блок правил: дефицит = съедено − поддержка − потрачено; калории расхода
 *     считает система, выдумывать свои числа нельзя.
 *  5. В календарь добавлен номер дня недели — у планов бывает своя нумерация дней,
 *     и агент путал «день 3 программы» с «третьим днём недели».
 *
 * Прогон:  node schema/transform-main-kcal.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-kcal.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
// Замена ТОЛЬКО функцией: $' и $& в строке замены — спецпаттерны JS (грабля п.9).
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл фрагмент: ' + from.slice(0, 60)); return s.replace(from, () => to); };

// --- 1. Load Profile: тянем калории и минуты активностей за сегодня ---
const lp = byName('Load Profile') || fail('нет узла Load Profile');
let q = String(lp.parameters.query);
q = swap(q, "json_build_object('ex', x.ex, 'n', x.n)", "json_build_object('ex', x.ex, 'n', x.n, 'kc', x.kc, 'ds', x.ds)");
q = swap(q, 'SELECT we.activity_name AS ex, count(*) AS n FROM workout_entry we',
  'SELECT we.activity_name AS ex, count(*) AS n, sum(we.kcal) AS kc, sum(we.duration_s) AS ds FROM workout_entry we');
lp.parameters.query = q;

// --- 2. BPC: выписка дня с расходом + дата наружу + номер дня недели ---
const bpc = byName('Build Profile Context') || fail('нет узла Build Profile Context');
let code = bpc.parameters.jsCode;

code = swap(code,
  "  if (todayWorkout.length) L.push('Тренировка: ' + todayWorkout.map(x => (x.ex || '?') + ' (' + (x.n || 0) + ' подх.)').join('; ') + '.');",
  [
    '  if (todayWorkout.length) {',
    '    // Расход берём из базы: его посчитал код при записи, агенту считать нечего.',
    '    let burned = 0;',
    '    const wl = todayWorkout.map(x => {',
    '      burned += Number(x.kc) || 0;',
    '      const mins = Math.round((Number(x.ds) || 0) / 60);',
    '      const parts = [];',
    '      if (Number(x.n) > 0 && !mins) parts.push(x.n + \' подх.\');',
    "      if (mins > 0) parts.push(mins + ' мин');",
    "      if (Number(x.kc) > 0) parts.push(Math.round(x.kc) + ' ккал');",
    "      return (x.ex || '?') + (parts.length ? ' (' + parts.join(', ') + ')' : '');",
    '    });',
    "    L.push('Активность: ' + wl.join('; ') + '.' + (burned > 0 ? ' ПОТРАЧЕНО СЕГОДНЯ НА АКТИВНОСТИ: ' + Math.round(burned) + ' ккал (посчитано системой по MET и пульсу — бери это число, своё не выдумывай).' : ''));",
    '  }',
  ].join('\n'));

code = swap(code,
  "_todayLines.push('ВЧЕРА: '",
  "_todayLines.push('ДЕНЬ НЕДЕЛИ ПО СЧЁТУ: ' + (_dow === 0 ? 7 : _dow) + '-й (понедельник = 1). Если в тексте плана своя нумерация дней — сопоставляй её С ЭТИМ номером, а не с номером дня программы.');\n_todayLines.push('ВЧЕРА: '");

code = swap(code,
  'return [{ json: { message: msg, profile_block: block, today_block: todayBlock } }];',
  'return [{ json: { message: msg, profile_block: block, today_block: todayBlock, today_date: _today } }];');

bpc.parameters.jsCode = code;

// --- 3. log_workout: дата клиента + описание ---
const tool = byName('log_workout') || fail('нет узла log_workout');
tool.parameters.workflowInputs.value.client_today = "={{ $('Build Profile Context').first().json.today_date }}";
if (!tool.parameters.workflowInputs.schema.some((s) => s.id === 'client_today')) {
  tool.parameters.workflowInputs.schema.push({
    id: 'client_today', displayName: 'client_today', required: false,
    defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string',
  });
}
tool.parameters.description =
  'Записывает ПРОВЕДЁННУЮ клиентом активность в журнал. Вызывай, когда клиент рассказал, что сделал — ' +
  'и для зала, и для кардио, и для бытовой активности. entries — JSON-массив. ' +
  'Силовое: {activity:"название", kind:"strength", sets:[{reps,weight_kg,rpe}]} (по подходу). ' +
  'Кардио: {activity:"название", kind:"cardio", duration_s, distance_m, hr_avg} — длительность обязательна, ' +
  'hr_avg указывай, если клиент назвал средний пульс (тогда расход считается точнее). ' +
  'ШАГИ: {activity:"Шаги", kind:"cardio", steps:7500} — поле steps, длительность не нужна. ' +
  'ОБЯЗАТЕЛЬНО записывай кардио, плавание, ходьбу и шаги — без этого расход калорий не попадёт в дефицит. ' +
  'Расход в ккал система считает САМА по весу, возрасту, полу и пульсу — своих цифр в записи не передавай. ' +
  'performed_on — дата YYYY-MM-DD или пусто (сегодня по поясу клиента). ' +
  'duration_min — общая длительность занятия, по ней считается расход на силовую часть. session_type, note — по желанию.';

// --- 4. правила ---
const agent = byName('AI Agent') || fail('нет узла AI Agent');
const MARK = '=== РАСХОД КАЛОРИЙ И ДЕФИЦИТ ===';
const sm = agent.parameters.options.systemMessage;
if (sm.indexOf(MARK) === -1) {
  agent.parameters.options.systemMessage = sm + '\n\n' + [
    MARK,
    'Дефицит считается по трём слагаемым, а не по одной еде:',
    'съедено (журнал еды) − поддерживающая калорийность − ПОТРАЧЕНО НА АКТИВНОСТИ.',
    'Правила:',
    '— Любую активность записывай через log_workout: зал, кардио, эллипс, велотренажёр, плавание, ходьбу, шаги,',
    '  игры, лыжи. Если активности нет в журнале — её расход НЕ попадёт в дефицит, и все недельные итоги будут врать.',
    '— Для кардио передавай длительность; если клиент назвал средний пульс — обязательно передавай hr_avg,',
    '  по нему расход считается точнее (учитывается пол, возраст, вес). Не назвал — не выспрашивай настойчиво,',
    '  система посчитает по типу активности.',
    '— Шаги записывай полем steps (например 7500) — это тоже расход, и он значимый.',
    '— Расход в ккал считает СИСТЕМА и возвращает тебе готовое число. Своё не придумывай и не пересчитывай.',
    '  Если в выписке дня стоит «ПОТРАЧЕНО СЕГОДНЯ НА АКТИВНОСТИ» — бери оттуда.',
    '— Когда клиент спрашивает про дефицит за день или неделю — сначала get_progress, там есть и еда, и расход.',
    '  Отвечать по памяти или считать в уме запрещено.',
    '— Честность: расход по формулам приблизителен (±15-20%), так и говори, если клиент уточняет точность.',
  ].join('\n');
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const nc = w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode;
new Function(nc);
if (nc.indexOf('ПОТРАЧЕНО СЕГОДНЯ НА АКТИВНОСТИ') === -1) fail('расход не попал в выписку дня');
if (nc.indexOf('today_date') === -1) fail('дата клиента не отдаётся наружу');
if (nc.indexOf('ДЕНЬ НЕДЕЛИ ПО СЧЁТУ') === -1) fail('номер дня недели не добавлен');
if (String(w.nodes.find((n) => n.name === 'Load Profile').parameters.query).indexOf('sum(we.kcal)') === -1) fail('калории не тянутся из базы');
const t = w.nodes.find((n) => n.name === 'log_workout');
if (!t.parameters.workflowInputs.value.client_today) fail('дата не передаётся в инструмент');
if (t.parameters.description.indexOf('steps') === -1) fail('шаги не описаны агенту');
if (w.nodes.find((n) => n.name === 'AI Agent').parameters.options.systemMessage.indexOf(MARK) === -1) fail('правила не добавлены');
console.log('OK ->', OUT, '| BPC', nc.length, 'симв | промпт',
  w.nodes.find((n) => n.name === 'AI Agent').parameters.options.systemMessage.length, 'симв');
