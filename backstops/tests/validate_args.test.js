const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { validateArgs } = require('../validate_args.js');

const TOOLS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'eval', 'tools.json'), 'utf8'));
const schemaOf = (name) => TOOLS.find((t) => t.name === name).input_schema;

test('правильный вызов проходит', () => {
  const r = validateArgs(schemaOf('log_food'), {
    description: 'гречка 150 г', kcal: 165, meal_type: 'lunch', eaten_on: '2026-09-10',
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
});

test('нет обязательного параметра', () => {
  const r = validateArgs(schemaOf('log_food'), { kcal: 165 });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /обязательный параметр «description»/);
});

test('число пришло строкой — самая частая беда открытых моделей', () => {
  const r = validateArgs(schemaOf('log_food'), { description: 'каша', kcal: '165' });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /должно быть числом/);
});

test('дата словом вместо ГГГГ-ММ-ДД', () => {
  const r = validateArgs(schemaOf('set_reminder'), { action: 'create', text: 'вода', when_date: 'завтра' });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /не в требуемом формате/);
});

test('значение вне перечисления', () => {
  const r = validateArgs(schemaOf('set_reminder'), { action: 'создать' });
  assert.match(r.errors[0], /допустимые значения — create, list, cancel/);
});

test('вложенный список проверяется поэлементно', () => {
  const r = validateArgs(schemaOf('log_workout'), {
    entries: [{ activity: 'жим лёжа', kind: 'strength', sets: [{ reps: 8, weight_kg: '45' }] }],
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /entries\[0\]\.sets\[0\]\.weight_kg/);
});

test('лишние параметры видны', () => {
  const r = validateArgs(schemaOf('resolve_injury'), { injury_id: 'inj-41', force: true });
  assert.match(r.errors[0], /лишние параметры — force/);
});

test('превышен предел элементов', () => {
  const items = Array.from({ length: 51 }, () => ({ metric: 'weight', value: 70 }));
  const r = validateArgs(schemaOf('log_measurement'), { items });
  assert.match(r.errors[0], /максимум 50/);
});

test('сообщение модели одно и заканчивается указанием исправить', () => {
  const r = validateArgs(schemaOf('log_food'), { kcal: 'много' });
  assert.match(r.message, /^Вызов не выполнен: /);
  assert.match(r.message, /вызови инструмент заново\.$/);
});

test('все 20 схем инструментов принимают пустой объект без падения валидатора', () => {
  for (const tool of TOOLS) {
    const r = validateArgs(tool.input_schema, {});
    assert.strictEqual(typeof r.ok, 'boolean', tool.name);
    // Обязательные параметры должны отражаться в ошибках, а не молча проходить.
    const required = tool.input_schema.required || [];
    assert.strictEqual(r.errors.length >= required.length, true, tool.name);
  }
});
