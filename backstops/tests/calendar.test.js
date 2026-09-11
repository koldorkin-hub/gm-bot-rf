const test = require('node:test');
const assert = require('node:assert');
const { buildCalendar, clientNow, shift, daysBetween } = require('../calendar.js');

test('пояс клиента, а не сервера: 22:10 UTC — это уже завтра в Москве', () => {
  const { date, time } = clientNow('2026-09-09T22:10:00Z', 'Europe/Moscow');
  assert.strictEqual(date, '2026-09-10');
  assert.strictEqual(time, '01:10');
});

test('Екатеринбург впереди Москвы на два часа', () => {
  assert.strictEqual(clientNow('2026-09-09T22:10:00Z', 'Asia/Yekaterinburg').date, '2026-09-10');
  assert.strictEqual(clientNow('2026-09-09T22:10:00Z', 'Asia/Yekaterinburg').time, '03:10');
});

test('календарь и день недели считаются из одной даты', () => {
  const c = buildCalendar('2026-09-10T05:15:00Z', { timezone: 'Europe/Moscow' });
  assert.strictEqual(c.today, '2026-09-10');
  assert.strictEqual(c.weekday, 'четверг');
  assert.strictEqual(c.weekdayNo, 4);
  assert.match(c.block, /СЕЙЧАС У КЛИЕНТА: четверг, 10\.09\.2026, 08:15/);
  assert.match(c.block, /\[Чт 10\.09\]/);
  assert.match(c.block, /ВЧЕРА: Ср 09\.09\.2026 \| ЗАВТРА: Пт 11\.09\.2026/);
});

test('штамп короткий — он оседает в истории навсегда', () => {
  const c = buildCalendar('2026-09-10T05:15:00Z', { timezone: 'Europe/Moscow' });
  assert.strictEqual(c.stamp, '[СЕГОДНЯ Чт 10.09.2026 08:15, вчера Ср 09.09, завтра Пт 11.09]');
  assert.ok(c.stamp.length < 70, `штамп разросся до ${c.stamp.length} знаков`);
});

test('день и неделя программы', () => {
  const c = buildCalendar('2026-09-10T05:15:00Z',
    { timezone: 'Europe/Moscow', plan_started_on: '2026-08-10' });
  assert.strictEqual(c.programDay, 32);
  assert.strictEqual(c.programWeek, 5);
  assert.match(c.block, /ПРОГРАММА: сегодня ДЕНЬ 32, НЕДЕЛЯ 5/);
});

test('старт программы в будущем в календарь не попадает', () => {
  const c = buildCalendar('2026-09-10T05:15:00Z',
    { timezone: 'Europe/Moscow', plan_started_on: '2026-10-01' });
  assert.strictEqual(c.programDay, null);
  assert.strictEqual(c.block.includes('ПРОГРАММА'), false);
});

test('первый день программы — именно первый, а не нулевой', () => {
  const c = buildCalendar('2026-08-10T09:00:00Z',
    { timezone: 'Europe/Moscow', plan_started_on: '2026-08-10' });
  assert.strictEqual(c.programDay, 1);
  assert.strictEqual(c.programWeek, 1);
});

test('переход через месяц и год', () => {
  assert.strictEqual(shift('2026-08-31', 1), '2026-09-01');
  assert.strictEqual(shift('2027-01-01', -1), '2026-12-31');
  assert.strictEqual(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('неделя всегда начинается с понедельника', () => {
  const c = buildCalendar('2026-09-13T09:00:00Z', { timezone: 'Europe/Moscow' }); // воскресенье
  assert.strictEqual(c.weekdayNo, 7);
  assert.match(c.block, /НЕДЕЛЯ: Пн 07\.09/);
  assert.match(c.block, /\[Вс 13\.09\]/);
});

test('пояс без профиля — Москва по умолчанию', () => {
  assert.match(buildCalendar('2026-09-10T05:15:00Z', {}).block, /Europe\/Moscow/);
});

test('битый момент времени валит явно, а не тихо', () => {
  assert.throws(() => clientNow('не дата', 'Europe/Moscow'), /не разобрать момент/);
});

test('дата версии программы не влияет на счёт недель плана', () => {
  // plan_started_on — старт плана, training_program.started_on — дата версии программы.
  // Завели новую версию программы сегодня — неделя плана обязана остаться прежней.
  const profile = { timezone: 'Europe/Moscow', plan_started_on: '2026-08-10',
    training_program: { version: 2, started_on: '2026-09-10' } };
  const c = buildCalendar('2026-09-10T05:15:00Z', profile);
  assert.strictEqual(c.programDay, 32, 'счёт идёт от plan_started_on, а не от версии программы');
  assert.strictEqual(c.programWeek, 5);
});
