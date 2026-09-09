// Трансформ основного workflow под подэтап 3b-2 (get_progress: домены workout/food).
// Поверх текущего main. Идемпотентно.
// Запуск: node transform-main-substep3b2.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const byName = {}; nodes.forEach(n => byName[n.name] = n);

// --- get_progress: добавить вход domain ---
const gp = byName['get_progress'];
if (gp && !gp.parameters.workflowInputs.value.domain) {
  const v = gp.parameters.workflowInputs.value;
  // пересобираем порядок: bot_id, user_id, domain, metric, period_days
  const nv = {
    bot_id: v.bot_id,
    user_id: v.user_id,
    domain: "={{ $fromAI('domain', 'measurement | workout | food', 'string') }}",
    metric: v.metric,
    period_days: v.period_days
  };
  gp.parameters.workflowInputs.value = nv;
  gp.parameters.workflowInputs.schema = [
    { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
    { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
    { id: 'domain', displayName: 'domain', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
    { id: 'metric', displayName: 'metric', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
    { id: 'period_days', displayName: 'period_days', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' }
  ];
  gp.parameters.description = 'Читает данные клиента ИЗ БАЗЫ за период. domain=measurement — динамика метрики (нужен metric: weight/waist/... — last/min/max/среднее/ряд); domain=workout — объём тренировок (число сессий, силовой объём Σповт×вес, кардио-дистанция); domain=food — калории и БЖУ за период (сумма и среднее в день). period_days — дней (по умолчанию 30). Вызывай ВСЕГДА, когда клиент спрашивает про прогресс, динамику, объём тренировок, сколько калорий/тренировок за период — не вспоминай из переписки.';
}

// --- systemMessage: обновить правило чтения прогресса ---
let sm = byName['AI Agent'].parameters.options.systemMessage;
const oldLine = "Когда клиент спрашивает про свой прогресс, динамику, историю или «сколько/какой был» за период — НЕ вспоминай из переписки, вызови get_progress (metric + период в днях) и отвечай строго по цифрам из базы. Если база вернула «нет записей» — так и скажи, не придумывай.";
const newLine = "Когда клиент спрашивает про свой прогресс, динамику, историю, объём тренировок или сколько калорий/тренировок за период — НЕ вспоминай из переписки, вызови get_progress и отвечай строго по цифрам из базы. domain=measurement (нужен metric — вес, талия и т.п.), domain=workout (сессии, силовой объём, кардио-дистанция), domain=food (калории и БЖУ). Если база вернула «нет записей» — так и скажи, не придумывай.";
if (sm.includes(oldLine)) {
  sm = sm.replace(oldLine, newLine);
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: get_progress.domain=' + !!byName['get_progress'].parameters.workflowInputs.value.domain + ', sm.updated=' + byName['AI Agent'].parameters.options.systemMessage.includes('domain=workout'));
