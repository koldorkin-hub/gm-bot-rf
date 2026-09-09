const test = require('node:test');
const assert = require('node:assert');
const { classifyMetric, splitByContour, OPEN, KNOWN_SENSITIVE } = require('../metric_contour.js');

test('вес и обхваты — открытый контур', () => {
  for (const m of ['weight', 'waist', 'hip', 'steps', 'sleep_hours', 'water_ml']) {
    const v = classifyMetric(m);
    assert.strictEqual(v.contour, 'open', m);
    assert.strictEqual(v.sensitive, false, m);
  }
});

test('показатели анализов и давление — контур здоровья', () => {
  for (const m of ['systolic', 'glucose', 'ferritin', 'tsh', 'mood', 'body_fat_pct']) {
    const v = classifyMetric(m);
    assert.strictEqual(v.contour, 'sens', m);
    assert.strictEqual(v.sensitive, true, m);
  }
});

test('незнакомый показатель по умолчанию считается чувствительным', () => {
  const v = classifyMetric('сахар_натощак');
  assert.strictEqual(v.contour, 'sens');
  assert.match(v.reason, /нет в белом списке/);
});

test('регистр, пробелы и дефисы не обманывают классификатор', () => {
  assert.strictEqual(classifyMetric('  Weight ').contour, 'open');
  assert.strictEqual(classifyMetric('RESTING-HR').contour, 'sens');
  assert.strictEqual(classifyMetric('sleep hours').contour, 'open');
});

test('пустое имя не проваливается в открытый контур', () => {
  for (const m of ['', null, undefined, '   ']) {
    assert.strictEqual(classifyMetric(m).contour, 'sens', String(m));
  }
});

test('белый и чёрный списки не пересекаются', () => {
  const both = Object.keys(OPEN).filter((k) => k in KNOWN_SENSITIVE);
  assert.deepStrictEqual(both, [], 'показатель не может быть одновременно в обоих контурах');
});

test('пачка показателей разводится по контурам', () => {
  const { open, sens } = splitByContour([
    { metric: 'weight', value: 72 },
    { metric: 'waist', value: 80.5 },
    { metric: 'resting_hr', value: 61 },
    { metric: 'глюкоза', value: 6.8 },
  ]);
  assert.strictEqual(open.length, 2);
  assert.strictEqual(sens.length, 2);
  assert.strictEqual(sens.every((i) => i.sensitive === true), true);
  assert.strictEqual(open.every((i) => i.sensitive === false), true);
});

test('пустая пачка не роняет разбор', () => {
  assert.deepStrictEqual(splitByContour(null), { open: [], sens: [] });
  assert.deepStrictEqual(splitByContour([]), { open: [], sens: [] });
});

test('белый список в коде и в базе — один и тот же', () => {
  // Список живёт в двух местах: триггер базы отказывает в записи, код разводит по контурам.
  // Разойдутся — и запись либо упадёт на боевом, либо приземлится не в тот контур.
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'schema', '04-sensitive-contour.sql'), 'utf8');
  const block = sql.split('INSERT INTO public.metric_whitelist')[1].split('ON CONFLICT')[0];
  const inSql = [...block.matchAll(/\('([a-z_]+)','/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(inSql, Object.keys(OPEN).sort());
});

test('имя показателя нормализуется одинаково при разборе пачки', () => {
  const { open } = splitByContour([{ metric: ' Weight ', value: 72 }]);
  assert.strictEqual(open[0].metric, 'weight');
});
