const test = require('node:test');
const assert = require('node:assert');
const { validateProgramDays } = require('../program_days.js');

const ok3 = [
  { day: 1, name: 'Грудь и трицепс', weekday: 'Пн', exercises: ['жим лёжа', 'разводка'] },
  { day: 2, name: 'Спина и бицепс', exercises: ['тяга верхнего блока'] },
  { day: 3, name: 'Ноги', exercises: ['румынская тяга', 'ягодичный мост'] },
];

test('правильная программа принимается и нормализуется', () => {
  const r = validateProgramDays(JSON.stringify(ok3));
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.days.length, 3);
  assert.strictEqual(r.days[0].weekday, 'Пн');
  assert.strictEqual(r.days[1].weekday, undefined, 'необязательный день недели не выдумывается');
});

test('дни принимаются и массивом, и строкой с JSON', () => {
  assert.strictEqual(validateProgramDays(ok3).ok, true);
  assert.strictEqual(validateProgramDays(JSON.stringify(ok3)).ok, true);
});

test('дни сортируются по номеру', () => {
  const r = validateProgramDays([ok3[2], ok3[0], ok3[1]]);
  assert.deepStrictEqual(r.days.map((d) => d.day), [1, 2, 3]);
});

test('дыра в нумерации — главная защита от путаницы дней', () => {
  const r = validateProgramDays([ok3[0], { day: 3, name: 'Ноги', exercises: ['присед'] }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /подряд с 1 — пропущен день 2/);
});

test('день без упражнений не проходит', () => {
  const r = validateProgramDays([{ day: 1, name: 'Ноги', exercises: [] }]);
  assert.match(r.message, /пустой список упражнений/);
});

test('день без названия не проходит', () => {
  const r = validateProgramDays([{ day: 1, name: '   ', exercises: ['присед'] }]);
  assert.match(r.message, /нет названия/);
});

test('повтор дня ловится', () => {
  const r = validateProgramDays([ok3[0], { day: 1, name: 'Снова первый', exercises: ['жим'] }]);
  assert.match(r.message, /указан дважды/);
});

test('номер дня вне диапазона ловится', () => {
  for (const d of [0, -1, 15, 1.5, 'два']) {
    const r = validateProgramDays([{ day: d, name: 'Х', exercises: ['жим'] }]);
    assert.strictEqual(r.ok, false, String(d));
  }
});

test('пустые и битые входы не роняют проверку', () => {
  for (const v of ['', '[]', 'не json', null, undefined, 42, {}, [[]], [null]]) {
    const r = validateProgramDays(v);
    assert.strictEqual(r.ok, false, JSON.stringify(v));
    assert.ok(r.message.length > 0);
  }
});

test('пустые строки среди упражнений отбрасываются, но день остаётся валидным', () => {
  const r = validateProgramDays([{ day: 1, name: 'Ноги', exercises: ['присед', '', '  ', 'тяга'] }]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.days[0].exercises, ['присед', 'тяга']);
});

test('сообщение модели объясняет, что передать заново', () => {
  const r = validateProgramDays('[]');
  assert.match(r.message, /ВСЕ дни программы целиком/);
  assert.ok(!/\.\./.test(r.message), 'в сообщении не должно быть двойных точек');
});

// ── Вечер 11.09.2026: кардио отдельно от силовых дней ──
const { validateCardio, validateProgramSet } = require('../program_days.js');

test('кардио внутри силового дня отклоняется с объяснением', () => {
  const r = validateProgramDays([{ day: 1, name: 'Ноги', exercises: ['присед', 'эллипс'] }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /это кардио/);
  assert.match(r.message, /передай его отдельно в cardio/);
});

test('упражнение может быть со схемой подходов', () => {
  const r = validateProgramDays([{ day: 1, name: 'Ноги',
    exercises: [{ name: 'румынская тяга', target: '4 × 8–12' }, 'ягодичный мост'] }]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.days[0].exercises[0], { name: 'румынская тяга', target: '4 × 8–12' });
  assert.strictEqual(r.days[0].exercises[1], 'ягодичный мост', 'без схемы остаётся строкой');
});

test('кардио не передано — прежнее сохраняется, а не стирается', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = validateProgramSet([{ day: 1, name: 'Ноги', exercises: ['присед'] }], v);
    assert.strictEqual(r.ok, true, String(v));
    assert.strictEqual(r.cardio, null);
    assert.strictEqual(r.keepPreviousCardio, true);
  }
});

test('пустой массив кардио — осознанное «убрать», это не то же самое', () => {
  const r = validateProgramSet([{ day: 1, name: 'Ноги', exercises: ['присед'] }], '[]');
  assert.deepStrictEqual(r.cardio, []);
  assert.strictEqual(r.keepPreviousCardio, false);
});

test('кардио нормализуется, длительность проверяется', () => {
  const r = validateCardio([{ name: 'эллипс', duration_min: '40.4', when: 'после силовой' },
                            'ходьба']);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.cardio[0], { name: 'эллипс', duration_min: 40, when: 'после силовой' });
  assert.deepStrictEqual(r.cardio[1], { name: 'ходьба' });
  assert.strictEqual(validateCardio([{ name: 'бег', duration_min: 0 }]).ok, false);
  assert.strictEqual(validateCardio([{ name: 'бег', duration_min: 900 }]).ok, false);
  assert.strictEqual(validateCardio([{ name: '  ' }]).ok, false);
});

test('слишком длинный список кардио отклоняется', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ name: 'вид ' + i }));
  assert.match(validateCardio(many).message, /не больше 10/);
});
