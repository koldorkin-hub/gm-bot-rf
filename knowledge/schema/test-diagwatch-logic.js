/**
 * Проверка решающего узла сторожа без n8n: гоняем реальный код узла
 * «Сторож: решение» из собранного DiagWatch01.json на всех переходах состояния.
 *
 * Прогон:  node schema/test-diagwatch-logic.js <путь к DiagWatch01.json>
 */
const fs = require('fs');

const file = process.argv[2] || './DiagWatch01.json';
const wf = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
const code = wf.nodes.find((n) => n.name === 'Сторож: решение').parameters.jsCode;
const fn = new Function('$', '$input', code);

const run = (prev, cur, diagText, checks) => {
  const $ = (name) => {
    if (name === 'Сторож: диагностика') {
      return { first: () => ({ json: { status: cur, text: diagText, checks: checks || [] } }) };
    }
    throw new Error('неожиданный узел ' + name);
  };
  const $input = { first: () => ({ json: { prev, cur } }) };
  return fn($, $input)[0].json;
};

// Всплеск клиентских сбоёв: инфраструктура зелёная, но у людей не работает.
const ERR = [{ key: 'errors', title: 'Сбои у клиентов', status: 'warn', detail: '4 за час' }];

const cases = [
  { prev: 'none', cur: 'ok', send: false, kind: 'none', why: 'первый запуск, всё хорошо — молчим' },
  { prev: 'ok', cur: 'ok', send: false, kind: 'none', why: 'всё по-прежнему хорошо — молчим' },
  { prev: 'ok', cur: 'warn', send: false, kind: 'none', why: 'предупреждение не будит' },
  { prev: 'warn', cur: 'warn', send: false, kind: 'none', why: 'предупреждение держится — молчим' },
  { prev: 'ok', cur: 'red', send: true, kind: 'red', why: 'сломалось — тревога' },
  { prev: 'red', cur: 'red', send: true, kind: 'red', why: 'всё ещё сломано — тревога (гасит анти-спам)' },
  { prev: 'red', cur: 'ok', send: true, kind: 'recovered', why: 'починилось — сообщаем' },
  { prev: 'red', cur: 'warn', send: true, kind: 'recovered', why: 'из красного вышли — сообщаем' },
  { prev: 'ok', cur: 'warn', send: true, kind: 'errors', checks: ERR, why: 'сбои у клиентов при зелёной инфраструктуре — будим' },
  { prev: 'warn', cur: 'warn', send: true, kind: 'errors', checks: ERR, why: 'сбои держатся — будим (гасит анти-спам 3 ч)' },
  { prev: 'ok', cur: 'red', send: true, kind: 'red', checks: ERR, why: 'красное важнее всплеска ошибок' },
  { prev: 'red', cur: 'ok', send: true, kind: 'recovered', checks: ERR, why: 'восстановление важнее всплеска ошибок' },
];

let bad = 0;
for (const c of cases) {
  const r = run(c.prev, c.cur, 'детали', c.checks);
  const ok = r.send === c.send && r.kind === c.kind;
  if (!ok) bad++;
  console.log((ok ? 'OK  ' : 'ПЛОХО ') + c.prev + ' -> ' + c.cur +
    ' | send=' + r.send + ' kind=' + r.kind + ' | ' + c.why);
}

// Экранирование: узел Telegram шлёт HTML, на сырых < & > он роняет сообщение целиком.
const esc = run('ok', 'red', 'ошибка <b> & "кавычки" > конец');
const escOk = esc.text.includes('&lt;b&gt;') && esc.text.includes('&amp;') && !/<b>/.test(esc.text);
console.log((escOk ? 'OK  ' : 'ПЛОХО ') + 'экранирование HTML в тексте тревоги');
if (!escOk) bad++;

console.log(bad === 0 ? '\nВСЕ СЦЕНАРИИ ПРОШЛИ' : '\nПРОВАЛОВ: ' + bad);
process.exit(bad === 0 ? 0 : 1);
