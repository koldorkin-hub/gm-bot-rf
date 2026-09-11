const test = require('node:test');
const assert = require('node:assert');
const { isCardioName, isCardioEntry, splitWorkout } = require('../cardio.js');

test('тренажёры и виды кардио узнаются по названию', () => {
  for (const n of ['эллипс', 'Эллипс 40 минут', 'велотренажёр', 'беговая дорожка',
                   'гребной тренажёр', 'степпер', 'кардио', 'Ходьба', 'бег', 'плавание',
                   'скандинавская ходьба', 'шаги', 'сайкл']) {
    assert.strictEqual(isCardioName(n), true, n);
  }
});

test('силовые названия кардио не считаются', () => {
  for (const n of ['жим лёжа', 'румынская тяга', 'ягодичный мост', 'планка',
                   'бег на месте в планке', 'приседания', 'тяга верхнего блока']) {
    assert.strictEqual(isCardioName(n), false, n);
  }
});

test('уточнение в скобках не мешает', () => {
  assert.strictEqual(isCardioName('Ходьба (беговая дорожка)'), true);
  assert.strictEqual(isCardioName('Жим (в тренажёре)'), false);
});

test('«Велосипед» с подходами остаётся силовым — это упражнение на пресс', () => {
  assert.strictEqual(isCardioEntry({ activity: 'Велосипед', kind: 'strength',
    sets: [{ reps: 20 }, { reps: 20 }] }), false);
  // а он же без подходов и как кардио — кардио
  assert.strictEqual(isCardioEntry({ activity: 'велотренажёр', duration_s: 1800 }), true);
});

test('код важнее того, что прислала модель', () => {
  // модель регулярно присылает эллипс как силовое — без подходов это всё равно кардио
  assert.strictEqual(isCardioEntry({ activity: 'эллипс', kind: 'strength' }), true);
  assert.strictEqual(isCardioEntry({ activity: 'что угодно', kind: 'cardio' }), true);
  assert.strictEqual(isCardioEntry({ activity: 'Шаги', steps: 9200 }), true);
});

test('тренировка делится на силовую часть и кардио', () => {
  const { main, cardio } = splitWorkout([
    { activity: 'жим лёжа', kind: 'strength', sets: [{ reps: 8, weight_kg: 45 }] },
    { activity: 'тяга блока', kind: 'strength', sets: [{ reps: 10 }] },
    { activity: 'эллипс', kind: 'strength', duration_s: 3600 },
    { activity: 'Шаги', steps: 9200 },
  ]);
  assert.strictEqual(main.length, 2);
  assert.strictEqual(cardio.length, 2);
  assert.strictEqual(cardio.every((e) => e.kind === 'cardio'), true, 'вид проставляется кодом');
  assert.deepStrictEqual(main.map((e) => e.activity), ['жим лёжа', 'тяга блока']);
});

test('пустые и битые входы не роняют разбор', () => {
  assert.deepStrictEqual(splitWorkout(null), { main: [], cardio: [] });
  assert.strictEqual(isCardioEntry(null), false);
  assert.strictEqual(isCardioEntry('строка'), false);
  assert.strictEqual(isCardioName(null), false);
});
