/**
 * Главный workflow: маршрутизация моделей — Haiku на рутину, Sonnet на всё остальное.
 *
 * По консоли Sonnet — 89% счёта. Значительная часть сообщений — «записал творог 200 г»,
 * «вес 84.5», «прошёл 8000 шагов»: для них нужен вызов инструмента, а не рассуждение.
 * Haiku 4.5 стоит примерно в 10 раз дешевле и с такими задачами справляется.
 *
 * Маршрут выбирает КОД (детерминированно, консервативно) в Build Profile Context:
 * «лёгким» считается только короткий текст без вопроса, без фото/документа/голоса,
 * без цитаты, с числом и словами про еду/вес/шаги/тренировку и без единого слова,
 * которое может относиться к здоровью или безопасности. Любое сомнение — Sonnet.
 * Правила безопасности при этом одинаковы: системник у обеих моделей один.
 *
 * Узел модели читает model.value — задаём выражением по маршруту. Учёт маршрута
 * пишется в usage_event (feature route_light|route_full), чтобы мерить долю.
 *
 * Прогон:  node schema/transform-main-model-routing.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-model-routing.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл: ' + from.slice(0, 60)); return s.replace(from, () => to); };

// --- 1. маршрут в Build Profile Context ---
const bpc = byName('Build Profile Context');
if (bpc.parameters.jsCode.indexOf('const route =') === -1) {
  const ROUTE = [
    '',
    '// --- Маршрут модели: лёгкая рутина -> Haiku, всё остальное -> Sonnet. Консервативно. ---',
    "const _rtTxt = String((msg && msg.text) || '').trim();",
    'const _rtLite =',
    '  !!_rtTxt && _rtTxt.length <= 220 &&',
    '  !(msg && (msg.photo || msg.document || msg.voice || msg.reply_to_message)) &&',
    "  !/^\\//.test(_rtTxt) && !/\\?/.test(_rtTxt) && /\\d/.test(_rtTxt) &&",
    "  // \\b в JS не знает кириллицы — границы слов задаём явно через соседние буквы.",
    '  /(съел|съела|(?<![а-яё])ела?(?![а-яё])|выпил|обед|завтрак|ужин|перекус|(?<![а-яё])вес(?![а-яё])|весу|взвес|шаг|(?<![а-яё])км(?![а-яё])|(?<![а-яё])мин(?![а-яё])|подход|повтор|(?<![а-яё])кг(?![а-яё])|грамм|(?<![а-яё])г(?![а-яё])|ккал|тренировк|пробеж|прош[её]л|прошла|запиш|записал)/i.test(_rtTxt) &&',
    '  !/(бол[ьи]|давлен|сердц|груд|голов|тошн|обморок|кров|таблет|препарат|укол|доз|гормон|стероид|курс|врач|диагноз|анализ|самочувств|плохо|умер|не хочу жить|суицид|порез|голод|рвот|аллерг|можно ли)/i.test(_rtTxt);',
    "const route = _rtLite ? 'light' : 'full';",
    '',
  ].join('\n');
  bpc.parameters.jsCode = swap(bpc.parameters.jsCode, "const lang = (prof.language && String(prof.language).trim())", ROUTE + "const lang = (prof.language && String(prof.language).trim())");
  bpc.parameters.jsCode = swap(bpc.parameters.jsCode, 'today_stamp: todayStamp } }];', 'today_stamp: todayStamp, route } }];');
}

// --- 2. модель по маршруту ---
const lm = wf.nodes.find((n) => n.type && n.type.includes('lmChatAnthropic')) || fail('нет узла модели Anthropic');
lm.parameters.model = {
  __rl: true,
  mode: 'id',
  value: "={{ $('Build Profile Context').first().json.route === 'light' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6' }}",
};

// --- 3. учёт маршрута после ответа ---
if (!byName('Агент: снял')) fail('нет узла Агент: снял — маршрут вешается за ним');
if (!wf.nodes.find((n) => n.name === 'Маршрут: учёт')) {
  wf.nodes.push({
    parameters: {
      operation: 'executeQuery',
      query: 'INSERT INTO usage_event (bot_id, user_id, feature) VALUES ($1, $2, $3);',
      options: {
        queryReplacement:
          "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id, 'route_' + ($('Build Profile Context').first().json.route || 'full') ] }}",
      },
    },
    id: 'm-route-0000-4000-8000-000000000001',
    name: 'Маршрут: учёт',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [1840, 0],
    credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
    onError: 'continueRegularOutput',
  });
  wf.connections['Агент: снял'] = { main: [[{ node: 'Маршрут: учёт', type: 'main', index: 0 }]] };
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// ---- проверка ----
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const c = w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode;
new Function(c);
if (!/route \} \}\];/.test(c)) fail('route не отдаётся наружу');
const m = w.nodes.find((n) => n.type && n.type.includes('lmChatAnthropic')).parameters.model;
if (m.mode !== 'id' || !String(m.value).includes('claude-haiku-4-5') || !String(m.value).includes('claude-sonnet-4-6')) fail('модель не переведена на выражение');
if (!w.nodes.find((n) => n.name === 'Маршрут: учёт')) fail('учёт маршрута не добавлен');

// прогон эвристики на примерах
const endMark = "const route = _rtLite ? 'light' : 'full';";
const seg = c.slice(c.indexOf('const _rtTxt'), c.indexOf(endMark) + endMark.length);
const run = (text, extra) => new Function('msg', seg + '\nreturn route;')(Object.assign({ text }, extra || {}));
const cases = [
  ['Творог 200 г и банан', 'light'], ['Вес 84.5', 'light'], ['Прошёл 8500 шагов', 'light'],
  ['Жим лёжа 60 кг 3 по 10', 'light'], ['Запиши обед: гречка 150 г, курица 200 г', 'light'],
  ['Сколько калорий в твороге?', 'full'], ['Составь мне программу на неделю', 'full'],
  ['После жима болит грудь', 'full'], ['Съел 200 г творога, но давление 150', 'full'],
  ['Можно ли мне арахис 30 г', 'full'], ['/progress', 'full'], ['Привет', 'full'],
  ['Творог 200 г', 'full', { photo: [{}] }], ['Вес 84.5', 'full', { reply_to_message: {} }],
  ['Вчера пробежал 5 км за 28 мин, пульс 150, что-то плохо было', 'full'],
];
let bad = 0;
cases.forEach(([t, want, extra]) => { const got = run(t, extra); if (got !== want) { bad++; console.log('  ПЛОХО маршрут: «' + t + '» -> ' + got + ' (ожидали ' + want + ')'); } });
if (bad) fail('эвристика маршрута ошибается в ' + bad + ' случаях');
console.log('OK ->', OUT, '| маршрут проверен на', cases.length, 'примерах');
