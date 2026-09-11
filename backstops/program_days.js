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
 *
 * Вечер 11.09.2026, вторая жалоба владельца («эллипс в силовой тренировке»): кардио живёт
 * ОТДЕЛЬНЫМ списком, а не внутри дней, и кардио в силовом дне отклоняется кодом.
 * Не передали cardio вовсе — прежнее кардио сохраняется: пересохраняя программу из-за одного
 * упражнения, модель не должна случайно стереть кардио клиента.
 */
const { isCardioName } = require('./cardio.js');

const MAX_DAY = 14;
const MAX_CARDIO = 10;

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
    // Упражнение — либо название строкой, либо {name, target: "4 × 8–12"}.
    const ex = (Array.isArray(x.exercises) ? x.exercises : []).map((e) => {
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        const n = String(e.name == null ? '' : e.name).trim();
        const t = String(e.target == null ? '' : e.target).trim();
        return n ? (t ? { name: n, target: t } : n) : null;
      }
      const v = String(e == null ? '' : e).trim();
      return v || null;
    }).filter(Boolean);
    if (!ex.length) {
      errors.push(`день ${day}: пустой список упражнений (exercises)`);
      return;
    }
    // Главный источник путаницы: кардио внутри силового дня. Не пускаем вовсе.
    const cardioIn = ex.map((e) => (typeof e === 'string' ? e : e.name)).filter(isCardioName);
    if (cardioIn.length) {
      errors.push(`день ${day}: «${cardioIn.join('», «')}» — это кардио. `
        + 'В силовые дни кардио не ставь: передай его отдельно в cardio '
        + '(name, duration_min, when), а в days оставь только силовые упражнения');
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

/**
 * Проверка списка кардио.
 * @returns {{ok, cardio: Array|null, errors, message}} cardio === null значит «оставить прежнее»:
 *   это НЕ пустой список. Пустой массив — осознанное «убрать кардио».
 */
function validateCardio(cardio) {
  if (cardio === undefined || cardio === null || String(cardio).trim() === '') {
    return { ok: true, cardio: null, errors: [], message: '' };
  }
  let list = cardio;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      return fail(['cardio — не JSON. Нужен массив [{name, duration_min, when}]; пустой [] — убрать кардио']);
    }
  }
  if (!Array.isArray(list)) {
    return fail(['cardio — JSON-массив [{name, duration_min, when}]; пустой [] — убрать кардио']);
  }
  if (list.length > MAX_CARDIO) return fail([`cardio — не больше ${MAX_CARDIO} видов`]);

  const errors = [];
  const out = [];
  list.forEach((x, i) => {
    const o = (x && typeof x === 'object' && !Array.isArray(x)) ? x : { name: x };
    const name = String(o.name == null ? '' : o.name).trim();
    if (!name) {
      errors.push(`cardio, элемент ${i + 1}: нет названия (name)`);
      return;
    }
    const item = { name };
    const raw = o.duration_min;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const m = Number(raw);
      if (!isFinite(m) || m < 1 || m > 600) {
        errors.push(`cardio «${name}»: duration_min — число минут от 1 до 600`);
        return;
      }
      item.duration_min = Math.round(m);
    }
    const when = String(o.when == null ? '' : o.when).trim();
    if (when) item.when = when.slice(0, 160);
    out.push(item);
  });

  if (errors.length) return fail(errors);
  return { ok: true, cardio: out, errors: [], message: '' };
}

/** Полная проверка вызова set: дни и кардио вместе. */
function validateProgramSet(days, cardio) {
  const d = validateProgramDays(days);
  if (!d.ok) return { ok: false, days: [], cardio: null, errors: d.errors, message: d.message };
  const c = validateCardio(cardio);
  if (!c.ok) return { ok: false, days: [], cardio: null, errors: c.errors, message: c.message };
  return { ok: true, days: d.days, cardio: c.cardio, errors: [], message: '',
    keepPreviousCardio: c.cardio === null };
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
  module.exports = { validateProgramDays, validateCardio, validateProgramSet, MAX_DAY, MAX_CARDIO };
}
