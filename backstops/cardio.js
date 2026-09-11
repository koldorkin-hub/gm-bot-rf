/**
 * Что считать кардио. ОДНА функция на два места: разбор журнала тренировок и проверка программы.
 *
 * Повод (владелец, вечер 11.09.2026): «Эллипс и велотренажёр — это кардио, отдельно от силовой.
 * Зачем он их смешал с тренировкой?» Разбор показал две беды сразу:
 *  — журнал: кардио дописывалось внутрь силовой сессии, и программа, собранная из такого
 *    журнала, унаследовала мусор;
 *  — программа: модель ставила эллипс в силовой день.
 *
 * Поэтому решает КОД, а не модель: она регулярно присылает эллипс с kind='strength'.
 * Список держим здесь один — разойдись он между журналом и программой, и кардио снова
 * окажется где попало.
 *
 * Тонкость, стоившая отдельного разбора: силовое упражнение с подходами остаётся силовым,
 * даже если называется «Велосипед» — это упражнение на пресс, а не велотренажёр.
 */

// Названия, где кардио узнаётся по части слова.
const CARDIO_ANY = /(эллипс|велотренаж|беговая дорожк|беговой дорожк|гребн[а-яё]* тренаж|степпер|кардио)/i;
// Названия, которые считаются кардио только целиком: «бег» — да, «бег на месте в планке» — нет.
const CARDIO_FULL = /^(ходьба|быстрая ходьба|интенсивная ходьба|скандинавская ходьба|шаги|бег|гребля|плавание|сайкл|велосипед на улице)$/i;

/** Убирает уточнение в скобках: «Ходьба (беговая дорожка)» → «Ходьба». */
function bareName(value) {
  return String(value == null ? '' : value).trim().replace(/\s*\([^)]*\)\s*$/, '');
}

/** Кардио ли это по НАЗВАНИЮ. Используется проверкой программы. */
function isCardioName(value) {
  const nm = bareName(value);
  return CARDIO_ANY.test(nm) || CARDIO_FULL.test(nm);
}

/**
 * Кардио ли эта запись журнала. Используется разбором log_workout.
 * Порядок проверок повторяет боевой: подходы важнее названия.
 */
function isCardioEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const hasSets = Array.isArray(entry.sets) && entry.sets.length > 0;
  if (entry.kind === 'strength' && hasSets) return false;   // «Велосипед 3×20» — пресс
  if (entry.kind === 'cardio') return true;
  if (Number(entry.steps) > 0) return true;
  return !hasSets && isCardioName(entry.activity || entry.activity_name);
}

/**
 * Делит записи одной тренировки на силовую часть и кардио.
 * Кардио уезжает в отдельную сессию дня — иначе оно попадёт в силовой объём и в программу.
 */
function splitWorkout(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const cardio = [];
  const main = [];
  for (const e of list) {
    if (isCardioEntry(e)) cardio.push({ ...e, kind: 'cardio' });
    else main.push(e);
  }
  return { main, cardio };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isCardioName, isCardioEntry, splitWorkout, bareName, CARDIO_ANY, CARDIO_FULL };
}
