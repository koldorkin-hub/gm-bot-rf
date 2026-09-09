/**
 * Главный workflow — пакет правок по сбою 18.08.2026 (Max iterations reached).
 *
 * 1. Потолок шагов агента 10 (дефолт) -> 25. Это предохранитель от зацикливания,
 *    а не «мощность»: каждый шаг — отдельный вызов модели со всем контекстом
 *    (~$0.02 и 3-5 секунд). 50 шагов = доллар и четыре минуты молчания, поэтому 25.
 * 2. Исчерпание шагов отделено от настоящего отказа ядра: клиенту — честный текст
 *    про объёмный разбор, владельцу — тревога с правильной причиной.
 *    Раньше человек, приславший свои анализы, получал «сервис временно недоступен».
 * 3. log_measurement научен принимать список показателей (вход items).
 * 4. systemMessage: показатели из документа записывать ОДНИМ пакетным вызовом.
 *
 * Прогон:  node schema/transform-main-agent-steps.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-agent-steps.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// --- 1. Потолок шагов ---
const agent = byName('AI Agent') || fail('нет узла AI Agent');
agent.parameters.options.maxIterations = 25;

// --- 2. Ветка отказа: отличить исчерпание шагов от недоступности ядра ---
if (!byName('Отказ: разбор')) {
  wf.nodes.push({
    parameters: {
      jsCode: [
        'const j = $input.first().json || {};',
        "const raw = String((j.error && j.error.message) || j.error || '');",
        '// Потолок шагов — это НЕ авария сервиса, и говорить о нём надо иначе.',
        'const steps = /max iterations/i.test(raw);',
        'const client = steps',
        "  ? 'Разбор оказался слишком объёмным, я не уложился в отведённые шаги. Пришли, пожалуйста, ещё раз — а если это большой документ, то частями, например по разделам анализов. Так я точно всё разберу.'",
        "  : 'Не смог собрать ответ — сервис временно недоступен. Отвечать наугад по теме здоровья не буду. Напиши ещё раз через пару минут.';",
        '// Двоеточие с пробелом в тексте тревоги обрезает сообщение владельцу — убираем заранее.',
        "const safe = raw.replace(/:\\s/g, ' - ').slice(0, 150);",
        "return [{ json: { kind: steps ? 'steps' : 'core', client_text: client, raw: safe } }];",
      ].join('\n'),
    },
    id: 'm-fail-0000-4000-8000-000000000001',
    name: 'Отказ: разбор',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [960, 320],
    onError: 'continueRegularOutput',
  });
}

const apology = byName('Извинение: ядро не ответило') || fail('нет узла извинения');
apology.parameters.bodyParameters.parameters.find((p) => p.name === 'text').value = '={{ $json.client_text }}';

const alarm = byName('Тревога: ядро не ответило') || fail('нет узла тревоги');
alarm.parameters.jsCode = [
  '// Без «: » в тексте — n8n обрезает тревогу владельцу по последнему двоеточию.',
  "const d = $('Отказ: разбор').first().json || {};",
  "if (d.kind === 'steps') {",
  "  throw new Error('Агент упёрся в потолок шагов, разбор не уложился. Клиент предупреждён и приглашён прислать частями. Деталь — ' + (d.raw || ''));",
  '}',
  "throw new Error('AI Agent не смог сформировать ответ. Вероятная причина — недоступна модель или память. Клиент предупреждён.');",
].join('\n');

wf.connections['AI Agent'].main[1] = [{ node: 'Отказ: разбор', type: 'main', index: 0 }];
wf.connections['Отказ: разбор'] = { main: [[{ node: 'Извинение: ядро не ответило', type: 'main', index: 0 }]] };

// --- 3. log_measurement: пакетный вход ---
const tool = byName('log_measurement') || fail('нет узла log_measurement');
tool.parameters.description =
  'Сохраняет измерения клиента в трекинг (дата→метрика→число). Вызывай, когда клиент сообщил измеримый факт: ' +
  'вес, обхваты, % жира, давление, пульс покоя, часы сна, воду, настроение, показатели анализов или любую метрику. ' +
  'ЕСЛИ ПОКАЗАТЕЛЕЙ НЕСКОЛЬКО (панель анализов, серия замеров) — передай их СПИСКОМ в items за ОДИН вызов, ' +
  'а не по одному: items — JSON-массив вида [{"metric":"...","value":1,"unit":"...","measured_on":"YYYY-MM-DD"}], до 50 штук. ' +
  'Для одного показателя используй metric/value/unit/measured_on. ' +
  'metric — короткий ключ (weight, waist, body_fat_pct, systolic, resting_hr, ferritin, tsh или произвольный). ' +
  'value — число. unit — единица (kg, cm, %, mmHg, bpm, h, ml). measured_on — дата YYYY-MM-DD, пусто = сегодня. ' +
  'Вес автоматически обновляет снимок в профиле.';
tool.parameters.workflowInputs.value.items =
  "={{ $fromAI('items', 'JSON-массив показателей [{metric,value,unit,measured_on}] — заполняй, когда показателей несколько; иначе оставь пустым', 'string') }}";
if (!tool.parameters.workflowInputs.schema.some((s) => s.id === 'items')) {
  tool.parameters.workflowInputs.schema.push({
    id: 'items', displayName: 'items', required: false, defaultMatch: false,
    display: true, canBeUsedToMatch: true, type: 'string',
  });
}

// --- 4. systemMessage: правило пакетной записи ---
const MARK = '=== ЗАПИСЬ ПОКАЗАТЕЛЕЙ ПАЧКОЙ ===';
const sm = agent.parameters.options.systemMessage;
if (sm.indexOf(MARK) === -1) {
  const block = [
    '',
    '',
    MARK,
    'Когда показателей несколько (панель анализов, серия замеров, выписка) — записывай их ОДНИМ вызовом log_measurement',
    'через параметр items: JSON-массив объектов {metric, value, unit, measured_on}. По вызову на каждый показатель делать',
    'НЕЛЬЗЯ: число шагов у тебя ограничено, на длинной панели ты до конца не дойдёшь и клиент останется без ответа —',
    'именно так уже терялся разбор биохимии.',
    'Из лабораторной панели записывай ЗНАЧИМОЕ: отклонения от нормы и то, что влияет на тренировки, питание, восстановление.',
    'Переписывать все строки бланка подряд не нужно.',
    'После записи кратко перечисли клиенту, что сохранил, и прокомментируй по-тренерски, в рамках своих границ.',
  ].join('\n');
  // Замена только функцией: спецпаттерны $' в строке замены молча портят текст (грабля п.9).
  agent.parameters.options.systemMessage = sm + block;
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка фактом ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const a = w.nodes.find((n) => n.name === 'AI Agent');
if (a.parameters.options.maxIterations !== 25) fail('потолок шагов не выставлен');
if (!w.nodes.find((n) => n.name === 'Отказ: разбор')) fail('узел разбора отказа не вставлен');
new Function(w.nodes.find((n) => n.name === 'Отказ: разбор').parameters.jsCode);
new Function(w.nodes.find((n) => n.name === 'Тревога: ядро не ответило').parameters.jsCode);
if (w.connections['AI Agent'].main[1][0].node !== 'Отказ: разбор') fail('ветка ошибки не перепроведена');
const t = w.nodes.find((n) => n.name === 'log_measurement');
if (!t.parameters.workflowInputs.value.items) fail('вход items у инструмента не добавлен');
if (!t.parameters.workflowInputs.schema.some((s) => s.id === 'items')) fail('схема инструмента без items');
if (a.parameters.options.systemMessage.indexOf(MARK) === -1) fail('блок в промпт не попал');
const ap = w.nodes.find((n) => n.name === 'Извинение: ядро не ответило');
if (ap.parameters.bodyParameters.parameters.find((p) => p.name === 'text').value !== '={{ $json.client_text }}') fail('текст извинения не переключён');
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| шагов', a.parameters.options.maxIterations,
  '| промпт', a.parameters.options.systemMessage.length, 'симв');
