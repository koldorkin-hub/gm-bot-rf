/**
 * Главный workflow: инструмент отчёта за период + новый блок /progress.
 *
 * Было: отдельного отчёта не существовало, команда уходила агенту, и он сам решал,
 * что показать. Отсюда разнобой между /progress и просьбой в чате, и жим ногами
 * как мерило прогресса у клиента с эндопротезом.
 *
 * Стало: считает код (PeriodReport01), агент пишет текст по жёсткой структуре.
 * Состав согласован с владельцем: без баланса и без динамики по упражнениям.
 *
 * Прогон:  node schema/transform-main-periodreport.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-periodreport.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// --- инструмент, по образцу существующих ---
const model = byName('get_progress') || fail('нет узла get_progress — не с чего копировать форму');
if (!byName('get_period_report')) {
  wf.nodes.push({
    parameters: {
      name: 'get_period_report',
      description:
        'Готовый СВОД ЗА ПЕРИОД для отчёта о прогрессе: тренировки, питание, расход калорий, вес, шаги, ' +
        'замеры тела и личные рекорды — всё уже посчитано системой из базы. ' +
        'Вызывай ВСЕГДА на команду /progress и на любую просьбу рассказать о прогрессе, итогах недели или месяца. ' +
        'period_days — длина периода в днях (30 по умолчанию, 7 для недели). ' +
        'Числа из ответа бери как есть и НЕ пересчитывай.',
      source: 'database',
      workflowId: { __rl: true, mode: 'list', value: 'PeriodReport01', cachedResultName: 'Инструмент — Отчёт за период' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          bot_id: "={{ $('Load Config').first().json.bot_id }}",
          user_id: "={{ $('Normalize').first().json.message.from.id }}",
          period_days: "={{ $fromAI('period_days', 'длина периода в днях: 30 месяц, 7 неделя', 'number') }}",
        },
        matchingColumns: [],
        schema: [
          { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
          { id: 'period_days', displayName: 'period_days', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        ],
      },
    },
    id: 'm-rep-0000-4000-8000-000000000001',
    name: 'get_period_report',
    type: model.type,
    typeVersion: model.typeVersion,
    position: [model.position[0], model.position[1] + 240],
  });
}
const link = wf.connections['get_progress'] || fail('нет связи get_progress — образец не найден');
wf.connections['get_period_report'] = JSON.parse(JSON.stringify(link));

// --- новый блок промпта вместо старого ---
const agent = byName('AI Agent') || fail('нет AI Agent');
let sm = agent.parameters.options.systemMessage;

const HEAD = '=== КОМАНДА /progress (сводка прогресса с графиками) ===';
const NEW_HEAD = '=== ОТЧЁТ О ПРОГРЕССЕ (/progress и любые просьбы про итоги) ===';
const NEW_BLOCK = [
  NEW_HEAD,
  'На команду /progress И на любую просьбу вроде «расскажи о моём прогрессе», «итоги месяца», «как я иду»',
  'СНАЧАЛА вызови get_period_report (period_days: 30 для месяца, 7 для недели). Он возвращает готовый свод',
  'из базы. Все числа бери оттуда как есть — не пересчитывай, не округляй по-своему, не добавляй своих оценок.',
  '',
  'Отчёт пиши ВСЕГДА по этой структуре, ничего не пропуская (если данных по разделу нет — так и скажи одной строкой):',
  '1. Период и общее впечатление одной фразой.',
  '2. ТРЕНИРОВКИ: сколько занятий, в скольких днях, сколько раз в неделю, по типам.',
  '3. ПИТАНИЕ: сколько дней записано, средние калории в день, средние БЖУ.',
  '4. РАСХОД: сколько сожжено на активностях всего и в среднем в активный день. Шаги — отдельной строкой.',
  '5. ВЕС: с чего начал, чем закончил, разница за период.',
  '6. ЗАМЕРЫ: только те, что клиент реально вёл, с изменением по каждому.',
  '7. РЕКОРДЫ за период, если были.',
  '8. ВЫВОД И НАПУТСТВИЕ: что получилось хорошо — назови конкретно; где просел — скажи прямо, но без нотаций;',
  '   и одна понятная задача на следующий период. Тон — тренер, который на стороне клиента.',
  '',
  'Жёсткие правила:',
  '— График прикладывай ОДИН: вес (get_progress_chart с metric=weight). Графики по упражнениям — только если',
  '  клиент прямо попросил график конкретного упражнения.',
  '— НЕ подавай как достижение прогресс в упражнениях, которые пересекаются с травмами и ограничениями клиента',
  '  из его профиля. У человека с протезом или больным суставом рост в таком движении — не повод для похвалы,',
  '  а повод проверить, не перегружает ли он проблемную зону. Сверяйся с блоком ограничений в профиле.',
  '— Если дневник питания заполнен меньше чем наполовину — честно предупреди, что средние приблизительны.',
  '— Не выдумывай метрик, которых нет в своде. Нет данных — скажи «за период не измерялось».',
].join('\n');

const i = sm.indexOf(HEAD);
if (i === -1) {
  if (sm.indexOf(NEW_HEAD) === -1) fail('не нашёл прежний блок /progress');
} else {
  // Заменяем от заголовка до следующего блока «=== ».
  const rest = sm.slice(i + HEAD.length);
  const j = rest.indexOf('\n=== ');
  const tail = j === -1 ? '' : rest.slice(j);
  sm = sm.slice(0, i) + NEW_BLOCK + tail;
  agent.parameters.options.systemMessage = sm;
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
if (!w.nodes.find((n) => n.name === 'get_period_report')) fail('инструмент не вставлен');
if (!w.connections['get_period_report']) fail('инструмент не подключён');
if (JSON.stringify(w.connections['get_period_report']).indexOf('AI Agent') === -1) fail('связь ведёт не к агенту');
const s = w.nodes.find((n) => n.name === 'AI Agent').parameters.options.systemMessage;
if (s.indexOf(NEW_HEAD) === -1) fail('новый блок не встал');
if (s.indexOf(HEAD) !== -1) fail('старый блок остался — будет два противоречивых указания');
const names = w.nodes.map((n) => n.name);
const targets = [];
Object.values(w.connections).forEach((c) => Object.values(c).forEach((arr) => (arr || []).forEach((b) => (b || []).forEach((x) => targets.push(x.node)))));
const missing = targets.filter((t) => !names.includes(t));
if (missing.length) fail('связи в никуда: ' + Array.from(new Set(missing)).join(', '));
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| промпт', s.length, 'символов');
