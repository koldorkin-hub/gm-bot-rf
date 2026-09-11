/**
 * Чем напоминание закрывается само — и почему лекарства не закрываются никогда.
 *
 * В боевом боте (11.09.2026) у напоминания появилось поле done_when: тикер перед отправкой
 * смотрит, не сделано ли дело уже, и тогда не пишет клиенту. Для взвешивания это удобно.
 * Для лекарств — опасно, поэтому правило владельца: **напоминания о лекарствах, уколах,
 * препаратах и добавках не пропускаются НИКОГДА**. Лучше лишнее напоминание, чем пропуск.
 *
 * Здесь это держит КОД, а не промпт: модель может забыть правило (у открытой модели
 * следование длинному промпту 86–88 % против ~95 % у Claude), а код не забывает.
 * Ровно так же устроено в боевом ReminderTool01 — модели в этом месте не доверяем.
 *
 * Ставится первым узлом подчинённого workflow напоминаний, до записи в базу.
 */
const { looksLikeMedication } = require('./meds.js');

// Белый список. Всё, чего здесь нет, превращается в none: неизвестное условие
// закрытия хуже отсутствующего — оно молча проглотит напоминание.
//
// ⚠ Отличие РФ-версии от боевого: measurement:body_fat_pct ИСКЛЮЧЁН.
// Процент жира — сведения о состоянии здоровья, и в РФ-версии он уходит в контур sens
// (backstops/metric_contour.js), а тикер смотрит открытую measurement. То есть условие
// всё равно никогда бы не сработало. Учить тикер ходить в контур здоровья ради этого
// не стоит: выгода — не прислать лишнее напоминание про замер жира (его делают
// раз в недели), а цена — ещё одно место, которое читает спецкатегорию и которое придётся
// проверять при переходе на этап 2 (КОНТУР-ЗДОРОВЬЯ.md). Направление ошибки безопасное:
// напоминание просто придёт.
const ALLOWED = [
  'none',
  'measurement:weight', 'measurement:waist', 'measurement:hip',
  'food:breakfast', 'food:lunch', 'food:dinner', 'food:snack',
  'workout:strength', 'workout:cardio',
];

// Значения, которые в боевом допустимы, а в РФ-версии осознанно сводятся к none.
// Отдельно от «мусора»: это не ошибка модели, поэтому и причина другая.
const DOWNGRADED = {
  'measurement:body_fat_pct':
    'процент жира в РФ-версии хранится в контуре здоровья, тикер туда не ходит — напоминание придёт',
};

/**
 * @param {string} value — что передала модель
 * @param {string} text  — текст самого напоминания
 * @returns {{value: string, forced: boolean, reason: string}} value всегда из белого списка
 */
function normalizeDoneWhen(value, text) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();

  if (looksLikeMedication(text)) {
    return { value: 'none', forced: raw !== '' && raw !== 'none',
      reason: 'напоминание о препарате — такие не закрываются автоматически никогда' };
  }
  if (!raw) return { value: 'none', forced: false, reason: 'условие не задано' };
  if (DOWNGRADED[raw]) return { value: 'none', forced: true, reason: DOWNGRADED[raw] };
  if (!ALLOWED.includes(raw)) {
    return { value: 'none', forced: true,
      reason: `значение «${raw}» не из белого списка — напоминание придёт в любом случае` };
  }
  return { value: raw, forced: false, reason: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeDoneWhen, ALLOWED, DOWNGRADED };
}
