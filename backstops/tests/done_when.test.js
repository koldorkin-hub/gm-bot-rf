const test = require('node:test');
const assert = require('node:assert');
const { normalizeDoneWhen, ALLOWED } = require('../done_when.js');
const { looksLikeMedication } = require('../meds.js');

// ── Правило владельца: напоминания о лекарствах не пропускаются НИКОГДА ──
test('укол не закрывается автоматически, что бы ни передала модель', () => {
  for (const t of ['поставить укол сустанона', 'инъекция ХГЧ', 'выпить таблетки',
                   'принять препарат', 'анастрозол 1 таб', 'сустанон 250 мг',
                   'витамин D', 'омега-3 добавка', 'капсулы магния', 'тирзепатид 5 мг']) {
    const r = normalizeDoneWhen('measurement:weight', t);
    assert.strictEqual(r.value, 'none', t);
    assert.strictEqual(r.forced, true, t);
    assert.match(r.reason, /препарат/);
  }
});

test('лекарство ловится в любом регистре и внутри длинной фразы', () => {
  assert.strictEqual(normalizeDoneWhen('food:breakfast', 'УКОЛ по графику утром').value, 'none');
  assert.strictEqual(normalizeDoneWhen('workout:cardio',
    'не забыть про инъекцию перед тренировкой').value, 'none');
});

test('доза с единицей измерения — тоже лекарство', () => {
  assert.strictEqual(looksLikeMedication('принять 500 мг'), true);
  assert.strictEqual(looksLikeMedication('2 мл раствора'), true);
  assert.strictEqual(looksLikeMedication('10 ме'), true);
});

// ── Обычные дела закрываться должны, иначе смысл поля теряется ──
test('взвешивание, еда и тренировка закрываются как задумано', () => {
  const cases = [['measurement:weight', 'взвеситься утром'],
                 ['measurement:waist', 'замерить талию'],
                 ['food:breakfast', 'позавтракать'],
                 ['workout:strength', 'силовая тренировка'],
                 ['workout:cardio', 'кардио 30 минут']];
  for (const [v, t] of cases) {
    const r = normalizeDoneWhen(v, t);
    assert.strictEqual(r.value, v, t);
    assert.strictEqual(r.forced, false, t);
  }
});

test('значение вне белого списка превращается в none, а не проглатывает напоминание', () => {
  for (const v of ['measurement:sugar', 'food:brunch', 'workout:yoga', 'да', 'true', 'weight']) {
    const r = normalizeDoneWhen(v, 'какое-то дело');
    assert.strictEqual(r.value, 'none', v);
    assert.strictEqual(r.forced, true, v);
  }
});

test('пустое значение — none без пометки «исправлено»', () => {
  for (const v of ['', null, undefined, '   ']) {
    const r = normalizeDoneWhen(v, 'позвонить маме');
    assert.strictEqual(r.value, 'none');
    assert.strictEqual(r.forced, false);
  }
});

test('регистр и пробелы в значении не мешают', () => {
  assert.strictEqual(normalizeDoneWhen('  MEASUREMENT:WEIGHT ', 'взвеситься').value, 'measurement:weight');
});

test('результат всегда из белого списка — что бы ни пришло на вход', () => {
  const junk = [['../../etc/passwd', 'дело'], ['measurement:weight; DROP TABLE', 'дело'],
                [{}, 'дело'], [42, 'дело'], [['measurement:weight'], 'дело']];
  for (const [v, t] of junk) {
    assert.ok(ALLOWED.includes(normalizeDoneWhen(v, t).value), String(v));
  }
});

test('вода и шаги лекарством не считаются — иначе пропадёт польза поля', () => {
  assert.strictEqual(looksLikeMedication('выпить стакан воды'), false);
  assert.strictEqual(looksLikeMedication('пройти 10000 шагов'), false);
  assert.strictEqual(normalizeDoneWhen('measurement:weight', 'взвеситься').forced, false);
});

test('процент жира в РФ-версии не закрывается: он живёт в контуре здоровья', () => {
  const r = normalizeDoneWhen('measurement:body_fat_pct', 'замерить процент жира');
  assert.strictEqual(r.value, 'none');
  assert.strictEqual(r.forced, true);
  assert.match(r.reason, /контуре здоровья/);
});
