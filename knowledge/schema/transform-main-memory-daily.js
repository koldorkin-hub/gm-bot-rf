#!/usr/bin/env node
/*
 * Main workflow: память по дням + день программы.
 * 1. get_progress (toolWorkflow): новое описание (дневник по дням) + входы date/date_from/date_to ($fromAI).
 * 2. Build Profile Context: строка «ПРОГРАММА: день N, неделя M» — детерминированный счёт от
 *    client_profile.plan_started_on в часовом поясе клиента.
 * 3. systemMessage: правила — вопрос про конкретный день → вычислить дату → передать date;
 *    отвечать по дням; день/неделя программы только из строки ПРОГРАММА; смена недели → предложить
 *    обновить plan_week; нет строки ПРОГРАММА → предложить зафиксировать plan_started_on.
 * 4. save_profile: описание дополнено ключом plan_started_on.
 * Идемпотентно (маркер: date_from в описании get_progress). Запуск: node transform-main-memory-daily.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

const gp = byName['get_progress']; if (!gp) throw new Error('нет узла get_progress');
if ((gp.parameters.description || '').includes('date_from')) { console.log('уже применено — пропуск'); process.exit(0); }

// 1. get_progress: описание + входы
gp.parameters.description = 'Читает данные клиента ИЗ БАЗЫ — дневник по дням. domain=food — еда ПО ДНЯМ (дата, день недели, список блюд с ккал, итоги дня и периода); domain=workout — тренировки ПО ДНЯМ (дата, упражнения с подходами и весами, объём сессии); domain=measurement — динамика метрики (нужен metric: weight/waist/... — last/min/max/среднее/ряд по датам); domain=records — личные рекорды (лучшие расчётные 1ПМ). Выбор периода: date=ГГГГ-ММ-ДД — ОДИН конкретный день («вчера», «11 августа», «прошлый четверг» — сначала вычисли дату из «СЕЙЧАС У КЛИЕНТА»); date_from+date_to — диапазон; без дат — period_days (по умолчанию 30) назад от сегодня. Вызывай ВСЕГДА, когда клиент спрашивает «что я ел/делал/что записано» про любой день или период, про прогресс, динамику, объёмы — не вспоминай из переписки.';

const val = gp.parameters.workflowInputs.value;
val.date = "={{ $fromAI('date', 'конкретный день ГГГГ-ММ-ДД (вычисли из СЕЙЧАС У КЛИЕНТА для «вчера/прошлый четверг»); пусто если нужен период', 'string') }}";
val.date_from = "={{ $fromAI('date_from', 'начало диапазона ГГГГ-ММ-ДД (вместе с date_to); пусто если не нужен', 'string') }}";
val.date_to = "={{ $fromAI('date_to', 'конец диапазона ГГГГ-ММ-ДД; пусто если не нужен', 'string') }}";
const schema = gp.parameters.workflowInputs.schema;
for (const nm of ['date', 'date_from', 'date_to']) {
  if (!schema.some(s => s.id === nm)) schema.push({ id: nm, displayName: nm, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' });
}

// 2. Build Profile Context: строка ПРОГРАММА
const bpc = byName['Build Profile Context']; if (!bpc) throw new Error('нет Build Profile Context');
const bpcAnchor = "не от серверного.');";
if (!bpc.parameters.jsCode.includes(bpcAnchor)) throw new Error('якорь BPC не найден');
if (!bpc.parameters.jsCode.includes('plan_started_on')) {
  bpc.parameters.jsCode = bpc.parameters.jsCode.replace(bpcAnchor, bpcAnchor +
    "\nif (has(prof.plan_started_on)) { try { const _td = new Date().toLocaleString('sv-SE', { timeZone: _tz }).slice(0,10); const _ps = String(prof.plan_started_on).slice(0,10); const _dn = Math.floor((Date.parse(_td + 'T00:00:00Z') - Date.parse(_ps + 'T00:00:00Z')) / 86400000) + 1; if (isFinite(_dn) && _dn >= 1) { const _wk = Math.floor((_dn - 1) / 7) + 1; lines.splice(1, 0, 'ПРОГРАММА: сегодня ДЕНЬ ' + _dn + ', НЕДЕЛЯ ' + _wk + ' активной программы (старт ' + _ps + '). Это единственный источник номера дня/недели программы — не пересчитывай его сам и не выводи из текста плана.'); } } catch (e) {} }");
}

// 3. systemMessage
const agent = wf.nodes.find(n => (n.type || '').toLowerCase().includes('agent'));
if (!agent) throw new Error('нет AI Agent');
let sm = agent.parameters.options.systemMessage;
const smAnchor = 'поэтому иди в базу.';
if (!sm.includes(smAnchor)) throw new Error('якорь systemMessage «иди в базу» не найден');
if (!sm.includes('ДНЕВНИК ПО ДНЯМ')) {
  sm = sm.replace(smAnchor, smAnchor +
    '\n— get_progress отдаёт ДНЕВНИК ПО ДНЯМ (дата + день недели + список еды/упражнений + итоги) и принимает date=ГГГГ-ММ-ДД (конкретный день) или date_from/date_to (диапазон). Вопрос про конкретный день («что я ел вчера», «что было 11 августа», «тренировка в прошлый четверг») — вычисли дату по строке «СЕЙЧАС У КЛИЕНТА» (вчера = минус один день; прошлый четверг = последний четверг ДО сегодня) и передай date. Отвечай ПО ДНЯМ, с датами и днями недели — НЕ сливай разные дни в одну кучу. Если за запрошенный день записей нет — честно скажи, что этот день не логировался (это не значит, что память пуста).' +
    '\n— ДЕНЬ И НЕДЕЛЯ ПРОГРАММЫ: номер дня/недели бери ТОЛЬКО из строки «ПРОГРАММА» в блоке профиля (посчитана кодом от даты старта) — не вычисляй и не выдумывай его сам. Если строки «ПРОГРАММА» нет, а активная программа с клиентом согласована — предложи зафиксировать дату старта (save_profile, ключ plan_started_on). Если по строке «ПРОГРАММА» началась НОВАЯ неделя, а ПЛАН НА НЕДЕЛЮ всё ещё описывает прошлую — предложи клиенту обновить план недели (save_profile, ключ plan_week).');
}
const plansAnchor = 'Веди клиента по этим планам изо дня в день, помни их между сессиями.';
if (sm.includes(plansAnchor) && !sm.includes('plan_started_on (ГГГГ-ММ-ДД)')) {
  sm = sm.replace(plansAnchor, plansAnchor + ' Дата старта программы — отдельный ключ plan_started_on (ГГГГ-ММ-ДД): сохраняй её при старте новой программы (и обновляй при перезапуске программы заново) — от неё бот считает «день N, неделя M».');
}
agent.parameters.options.systemMessage = sm;

// 4. save_profile: описание
const sp = byName['save_profile'];
if (sp && !(sp.parameters.description || '').includes('plan_started_on')) {
  sp.parameters.description += ' ДОП. КЛЮЧ plan_started_on(YYYY-MM-DD) — дата старта АКТИВНОЙ программы: сохраняй, когда программа стартует или клиент называет день начала; от неё бот считает «день N / неделя M» программы. При перезапуске программы заново — обнови на новую дату.';
}

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — get_progress date-входы+описание, ПРОГРАММА в Build Profile Context, systemMessage, save_profile');
