/**
 * Прогон настоящего кода узла «Диаг: свод» из собранного SelfDiag01.json
 * на подставных ответах проб. Показывает, что именно придёт в Telegram,
 * и проверяет, что вердикт считается верно.
 *
 * Прогон:  node schema/test-selfdiag-render.js <путь к SelfDiag01.json>
 */
const fs = require('fs');

const file = process.argv[2] || './SelfDiag01.json';
const wf = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
const code = wf.nodes.find((n) => n.name === 'Диаг: свод').parameters.jsCode;
const fn = new Function('$', '$input', code);

const DB_OK = {
  now_utc: '2026-08-16 11:45:00', silence_min: 34, msgs_24h: 61,
  err_1h: 0, err_24h: 0, err_top: null, err_last: null,
  research_orphans: 0, batch_orphans: 0, active_access: 24, feedback_new: 1,
};
const BOTS = [
  { label: 'users', bot_username: 'USER_GYMBOT' },
  { label: 'gymak', bot_username: 'GymAK_AI_Bot' },
  { label: 'trusted', bot_username: 'TRD_Gymbot' },
  { label: 'support', bot_username: 'GymAK_Support_Bot' },
];
const hookOk = { statusCode: 200, body: { ok: true, result: { pending_update_count: 0 } } };

const render = (title, over) => {
  const nodes = Object.assign({
    'Диаг: база': DB_OK,
    'Диаг: anthropic': { statusCode: 200, body: {} },
    'Диаг: сайт': { statusCode: 200, body: 'ok' },
    'Диаг: groq': { statusCode: 200, body: {} },
    'Диаг: gotenberg': { statusCode: 200, body: {} },
  }, over.nodes || {});
  const hooks = over.hooks || BOTS.map(() => hookOk);

  const $ = (name) => {
    if (name === 'Диаг: боты') return { all: () => BOTS.map((b) => ({ json: b })) };
    return { first: () => ({ json: nodes[name] || {} }) };
  };
  const $input = { all: () => hooks.map((h) => ({ json: h })) };

  const out = fn($, $input)[0].json;
  console.log('\n================ ' + title + ' ================');
  console.log('вердикт: ' + out.status);
  console.log('----------------------------------------------');
  console.log(out.text);
  return out;
};

let bad = 0;
const expect = (got, want, what) => {
  if (got !== want) { bad++; console.log('!! ПЛОХО: ' + what + ' — ожидалось ' + want + ', получено ' + got); }
};

const a = render('ВСЁ ЗДОРОВО', {});
expect(a.status, 'ok', 'вердикт на здоровой системе');

// Ровно вчерашний инцидент: баланс Anthropic на нуле.
const b = render('КОНЧИЛИСЬ КРЕДИТЫ ANTHROPIC (инцидент 15.08)', {
  nodes: {
    'Диаг: anthropic': {
      statusCode: 400,
      body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
    },
    'Диаг: база': Object.assign({}, DB_OK, { err_1h: 14, err_24h: 41, err_top: 'ИИ Тренер - Telegram Bot x41', err_last: 'Bad request - please check your parameters' }),
  },
});
expect(b.status, 'red', 'вердикт при нулевом балансе');
if (!/КОНЧИЛИСЬ КРЕДИТЫ/.test(b.text)) { bad++; console.log('!! ПЛОХО: не распознан текст про баланс'); }

// Telegram не может достучаться до вебхука — сообщения клиентов копятся.
const nowSec = Math.floor(Date.now() / 1000);
const c = render('ВЕБХУК БОТА С ОШИБКОЙ', {
  hooks: [
    { statusCode: 200, body: { ok: true, result: { pending_update_count: 37, last_error_message: 'Wrong response from the webhook: 502 Bad Gateway', last_error_date: nowSec - 120 } } },
    hookOk, hookOk, hookOk,
  ],
});
expect(c.status, 'red', 'вердикт при битом вебхуке');

// Та же ошибка, но месячной давности: Telegram держит её долго после починки.
const d = render('СТАРАЯ ошибка вебхука (не должна будить)', {
  hooks: [
    { statusCode: 200, body: { ok: true, result: { pending_update_count: 0, last_error_message: 'Wrong response from the webhook: 502 Bad Gateway', last_error_date: nowSec - 86400 } } },
    hookOk, hookOk, hookOk,
  ],
});
expect(d.status, 'ok', 'старая ошибка вебхука не считается сбоем');

// Gotenberg лежит — PDF и графики не соберутся, но бот жив: это предупреждение, не тревога.
const e = render('GOTENBERG НЕ ОТВЕЧАЕТ (предупреждение)', {
  nodes: { 'Диаг: gotenberg': { error: { message: 'connect ECONNREFUSED' } } },
});
expect(e.status, 'warn', 'падение gotenberg — это warn, а не red');

// База недоступна — самое тяжёлое.
const f = render('POSTGRES НЕ ОТВЕЧАЕТ', {
  nodes: { 'Диаг: база': { error: { message: 'connection refused' } } },
});
expect(f.status, 'red', 'вердикт при недоступной базе');
if (!/Счётчики недоступны/.test(f.text)) { bad++; console.log('!! ПЛОХО: при мёртвой базе печатаются нули вместо честного «нет данных»'); }
if (/активных доступов: 0/.test(f.text)) { bad++; console.log('!! ПЛОХО: нули счётчиков выдаются за факт'); }

// Сбои у клиентов при полностью зелёной инфраструктуре — случай 18.08.2026.
const g = render('СБОИ У КЛИЕНТОВ, ИНФРАСТРУКТУРА ЗЕЛЁНАЯ', {
  nodes: { 'Диаг: база': Object.assign({}, DB_OK, { err_1h: 4, err_24h: 4, err_top: 'ИИ Тренер - Telegram Bot x4', err_last: 'Агент упёрся в потолок шагов' }) },
});
expect(g.status, 'warn', 'всплеск клиентских сбоёв даёт warn');
if (!/Сбои у клиентов/.test(g.text)) { bad++; console.log('!! ПЛОХО: всплеск сбоёв не попал в отчёт'); }
// Два сбоя за час — это ещё не повод будить.
const h = render('ДВА СБОЯ ЗА ЧАС (будить не надо)', {
  nodes: { 'Диаг: база': Object.assign({}, DB_OK, { err_1h: 2, err_24h: 2 }) },
});
expect(h.status, 'ok', 'два сбоя за час порога не достигают');

console.log('\n' + (bad === 0 ? 'ВСЕ ПРОВЕРКИ ВЕРДИКТА ПРОШЛИ' : 'ПРОВАЛОВ: ' + bad));
process.exit(bad === 0 ? 0 : 1);
