/**
 * Календарь клиента — то, что в боевом боте делает узел Build Profile Context.
 *
 * Принцип (knowledge/memory/date-handling.md): агент НИЧЕГО не вычисляет про даты.
 * Всё считает код, из ОДНОЙ календарной даты в поясе клиента — раньше дата и день недели
 * брались из разных вызовов и расходились на границе суток.
 *
 * Две метки, разные места:
 *   — полный календарь идёт в системный промпт (собирается заново на каждый вызов);
 *   — короткий штамп идёт в начало сообщения агенту, потому что ВСЁ, что подано агенту
 *     в text, оседает в истории навсегда: длинная справка засоряет окно сорока сообщений.
 *
 * Смежная мина: подчинённые инструменты брали «сегодня» из серверного UTC, и запись после
 * полуночи по Москве уезжала на вчера. Поэтому clientToday() отдаётся инструментам явно.
 * В n8n: Code-узел, require запрещён — файл самодостаточен, Intl есть в Node 20+.
 */

const DAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Дата и время в поясе клиента: 'YYYY-MM-DD' и 'HH:MM'. */
function clientNow(nowUtc, timezone) {
  const d = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  if (Number.isNaN(d.getTime())) throw new Error('clientNow: не разобрать момент времени');
  // 'sv-SE' даёт ISO-подобный формат — тот же приём, что в боевом узле.
  const s = d.toLocaleString('sv-SE', { timeZone: timezone || 'Europe/Moscow' });
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

function shift(dateISO, days) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function weekdayIndex(dateISO) {          // 0 = понедельник
  const [y, m, d] = dateISO.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function ddmm(dateISO) {
  const [, m, d] = dateISO.split('-');
  return `${d}.${m}`;
}

function ddmmyyyy(dateISO) {
  const [y, m, d] = dateISO.split('-');
  return `${d}.${m}.${y}`;
}

function daysBetween(fromISO, toISO) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(toISO) - p(fromISO)) / 86400000);
}

/**
 * @param {string|Date} nowUtc — момент «сейчас» (обычно new Date())
 * @param {object} profile — { timezone, plan_started_on }
 * @returns {{today, yesterday, tomorrow, time, weekday, weekdayNo, block, stamp, programDay, programWeek}}
 */
function buildCalendar(nowUtc, profile) {
  const tz = (profile && profile.timezone) || 'Europe/Moscow';
  const { date: today, time } = clientNow(nowUtc, tz);
  const wd = weekdayIndex(today);
  const yesterday = shift(today, -1);
  const tomorrow = shift(today, 1);
  const monday = shift(today, -wd);

  const grid = Array.from({ length: 7 }, (_, i) => {
    const day = shift(monday, i);
    const label = `${SHORT[i]} ${ddmm(day)}`;
    return day === today ? `[${label}]` : label;
  }).join(' ');

  const lines = [
    `СЕЙЧАС У КЛИЕНТА: ${DAYS[wd]}, ${ddmmyyyy(today)}, ${time} (${tz})`,
    `НЕДЕЛЯ: ${grid}  (в скобках — сегодня)`,
    `ВЧЕРА: ${SHORT[weekdayIndex(yesterday)]} ${ddmmyyyy(yesterday)} | ЗАВТРА: ${SHORT[weekdayIndex(tomorrow)]} ${ddmmyyyy(tomorrow)}`,
    `ДЕНЬ НЕДЕЛИ: ${wd + 1} (Пн=1)`,
  ];

  let programDay = null;
  let programWeek = null;
  const start = profile && profile.plan_started_on;
  if (start) {
    const n = daysBetween(start, today);
    if (n >= 0) {
      programDay = n + 1;
      programWeek = Math.floor(n / 7) + 1;
      lines.push(`ПРОГРАММА: сегодня ДЕНЬ ${programDay}, НЕДЕЛЯ ${programWeek} (старт ${start})`);
    }
  }

  const stamp = `[СЕГОДНЯ ${SHORT[wd]} ${ddmmyyyy(today)} ${time}, `
    + `вчера ${SHORT[weekdayIndex(yesterday)]} ${ddmm(yesterday)}, `
    + `завтра ${SHORT[weekdayIndex(tomorrow)]} ${ddmm(tomorrow)}]`;

  return { today, yesterday, tomorrow, time, weekday: DAYS[wd], weekdayNo: wd + 1,
    block: lines.join('\n'), stamp, programDay, programWeek };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCalendar, clientNow, shift, weekdayIndex, daysBetween };
}
