/**
 * Проверка состава программы тренировок перед записью новой версии.
 *
 * Повод (11.09.2026): бот путал дни — называл «День 4», а выдавал упражнения понедельника.
 * Причина была в данных: состав тренировок жил в трёх полях профиля и противоречил сам себе.
 * Теперь источник один — таблица training_program, и менять её можно только целиком:
 * set передаёт ВСЕ дни, а не один изменённый.
 *
 * Здесь проверяется то же, что в боевом ProgramTool01: дни идут подряд с 1, без дыр
 * и дублей, у каждого есть название и непустой список упражнений. Ошибка возвращается
 * модели текстом — она чинит вызов сама, а кривая программа в базу не попадает.
 */

const MAX_DAY = 14;

/**
 * @param {string|Array} days — то, что передала модель (строка с JSON или массив)
 * @returns {{ok: boolean, days: Array, errors: string[], message: string}}
 */
function validateProgramDays(days) {
  const errors = [];
  let list = days;

  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      return fail(['days — не JSON. Нужен JSON-массив ВСЕХ дней программы.']);
    }
  }
  if (!Array.isArray(list) || !list.length) {
    return fail(['days — нужен непустой JSON-массив ВСЕХ дней программы, не только изменённого']);
  }

  const seen = new Set();
  const clean = [];
  list.forEach((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) {
      errors.push(`элемент ${i + 1}: не объект дня`);
      return;
    }
    const day = Number(x.day);
    if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) {
      errors.push(`элемент ${i + 1}: day — целое число от 1 до ${MAX_DAY}`);
      return;
    }
    if (seen.has(day)) {
      errors.push(`день ${day} указан дважды`);
      return;
    }
    seen.add(day);

    const name = String((x.name == null ? '' : x.name)).trim();
    if (!name) {
      errors.push(`день ${day}: нет названия (name)`);
      return;
    }
    const ex = Array.isArray(x.exercises)
      ? x.exercises.map((e) => String(e == null ? '' : e).trim()).filter(Boolean)
      : [];
    if (!ex.length) {
      errors.push(`день ${day}: пустой список упражнений (exercises)`);
      return;
    }
    const out = { day, name, exercises: ex };
    const wd = String((x.weekday == null ? '' : x.weekday)).trim();
    if (wd) out.weekday = wd;
    clean.push(out);
  });

  clean.sort((a, b) => a.day - b.day);
  clean.forEach((x, i) => {
    if (x.day !== i + 1) errors.push(`дни должны идти подряд с 1 — пропущен день ${i + 1}`);
  });

  if (errors.length) return fail(errors);
  return { ok: true, days: clean, errors: [], message: '' };
}

function fail(errors) {
  return {
    ok: false,
    days: [],
    errors,
    message: 'Программа не записана: ' + errors.join('; ').replace(/\.$/, '')
      + '. Передай ВСЕ дни программы целиком и вызови инструмент заново.',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateProgramDays, MAX_DAY };
}
