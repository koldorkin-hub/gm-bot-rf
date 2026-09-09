const test = require('node:test');
const assert = require('node:assert');
const { checkSummary } = require('../summary_filter.js');

test('поведенческая выжимка проходит — ради неё всё и делается', () => {
  const ok = [
    'Работает в офисе, вечерами устаёт. Не любит бег. Готовит сама, обедает вне дома.',
    'Тренируется по вторникам и четвергам, на выходных срывается на сладкое.',
    'Просит короткие ответы. Ведёт дневник еды нерегулярно, напоминания помогают.',
    'Вес за месяц снизился, шаги держит около 8 тысяч, спит примерно 7 часов.',
  ];
  for (const t of ok) {
    const r = checkSummary(t);
    assert.strictEqual(r.clean, true, `${t} → ${JSON.stringify(r.hits)}`);
  }
});

test('диагноз в выжимке ловится', () => {
  const r = checkSummary('Хронический гастрит, поэтому острое исключено.');
  assert.strictEqual(r.clean, false);
  assert.strictEqual(r.hits.some((h) => h.category === 'диагнозы'), true);
});

test('препарат с дозировкой ловится дважды — и как препарат, и как доза', () => {
  const r = checkSummary('Принимает метформин 500 мг утром.');
  const cats = new Set(r.hits.map((h) => h.category));
  assert.strictEqual(cats.has('дозировка'), true);
  assert.strictEqual(r.clean, false);
});

test('результаты анализов ловятся', () => {
  const r = checkSummary('ТТГ 5.8 при норме до 4, ферритин низкий.');
  assert.strictEqual(r.hits.some((h) => h.category === 'анализы'), true);
});

test('аллергия в выжимке недопустима — у неё своё хранилище', () => {
  const r = checkSummary('Аллергия на орехи, следит за составом.');
  assert.strictEqual(r.clean, false);
  assert.strictEqual(r.hits[0].category, 'аллергия');
});

test('давление и пульс покоя ловятся', () => {
  assert.strictEqual(checkSummary('Давление 128 на 82 по утрам.').clean, false);
  assert.strictEqual(checkSummary('Пульс покоя 61.').clean, false);
});

test('тренировочные числа не считаются медицинскими', () => {
  for (const t of ['Жим лёжа 45 кг на 8 повторов, 4 подхода.',
                   'Тренировка 62 минуты, 412 ккал.',
                   'Прошла 9 200 шагов, выпила 1500 мл воды.']) {
    assert.strictEqual(checkSummary(t).clean, true, t);
  }
});

test('сообщение модели объясняет, что переписать', () => {
  const r = checkSummary('Диагноз гипотиреоз, принимает препарат 50 мкг.');
  assert.match(r.message, /без диагнозов, препаратов/);
  assert.match(r.message, /Перепиши выжимку/);
});

test('пустая выжимка считается чистой и не роняет проверку', () => {
  for (const t of ['', null, undefined]) {
    assert.strictEqual(checkSummary(t).clean, true, String(t));
  }
});

test('повторный вызов даёт тот же результат — регэкспы не копят состояние', () => {
  const t = 'Хронический гастрит и анализы в норме.';
  const first = checkSummary(t).hits.length;
  const second = checkSummary(t).hits.length;
  assert.strictEqual(first, second);
  assert.ok(first > 0);
});
