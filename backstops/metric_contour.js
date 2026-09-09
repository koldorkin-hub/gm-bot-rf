/**
 * Куда приземляется показатель: открытый контур или контур здоровья.
 *
 * Проблема (marketing/ДАННЫЕ-О-ЗДОРОВЬЕ.md, мера 6): таблица measurement принимает ЛЮБОЕ
 * значение metric, а флаг sensitive по умолчанию false. Значит первая же запись «сахар 6,8»
 * приземляется как обычные данные — и спецкатегория оказывается в открытом контуре.
 *
 * Решение: белый список открытых метрик. Всё, чего в нём нет, идёт в контур здоровья
 * с sensitive=true. Определяет это КОД, а не модель: правило в промпте модель может забыть,
 * код — не может.
 *
 * Дефолт консервативный: незнакомая метрика считается чувствительной. Ошибка в эту сторону
 * стоит лишнего шифрования, ошибка в другую — состава по ч.16 ст.13.11 КоАП (10–15 млн ₽).
 */

// Открытый контур: антропометрия и бытовые привычки. Сами по себе не спецкатегория.
const OPEN = {
  weight: 'вес',
  waist: 'талия',
  hip: 'бёдра',
  chest: 'грудь',
  thigh: 'бедро',
  arm: 'рука',
  calf: 'голень',
  neck: 'шея',
  shoulders: 'плечи',
  water_ml: 'вода',
  sleep_hours: 'сон',
  steps: 'шаги',
};

// Контур здоровья: названо явно, чтобы не полагаться на «нет в белом списке».
// Список неполный по своей природе — он для внятного объяснения, а не для решения.
const KNOWN_SENSITIVE = {
  systolic: 'артериальное давление',
  diastolic: 'артериальное давление',
  resting_hr: 'пульс покоя',
  hrv: 'вариабельность пульса',
  body_fat_pct: 'процент жира',
  mood: 'психическое состояние',
  glucose: 'глюкоза',
  hba1c: 'гликированный гемоглобин',
  ldl: 'холестерин',
  hdl: 'холестерин',
  triglycerides: 'триглицериды',
  ferritin: 'ферритин',
  hemoglobin: 'гемоглобин',
  tsh: 'ТТГ',
  t4: 'Т4',
  testosterone: 'тестостерон',
  cortisol: 'кортизол',
  vitamin_d: 'витамин D',
  creatinine: 'креатинин',
  alt: 'АЛТ',
  ast: 'АСТ',
  crp: 'C-реактивный белок',
  spo2: 'сатурация',
  temperature: 'температура тела',
  pain_level: 'уровень боли',
};

function normalizeMetric(metric) {
  return String(metric == null ? '' : metric).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * @returns {{key: string, contour: 'open'|'sens', sensitive: boolean, title: string, reason: string}}
 */
function classifyMetric(metric) {
  const key = normalizeMetric(metric);
  if (!key) {
    return { key, contour: 'sens', sensitive: true, title: '',
      reason: 'пустое имя показателя — по умолчанию контур здоровья' };
  }
  if (Object.prototype.hasOwnProperty.call(OPEN, key)) {
    return { key, contour: 'open', sensitive: false, title: OPEN[key],
      reason: 'показатель в белом списке открытого контура' };
  }
  if (Object.prototype.hasOwnProperty.call(KNOWN_SENSITIVE, key)) {
    return { key, contour: 'sens', sensitive: true, title: KNOWN_SENSITIVE[key],
      reason: 'показатель состояния здоровья' };
  }
  return { key, contour: 'sens', sensitive: true, title: key,
    reason: 'показателя нет в белом списке — по умолчанию контур здоровья' };
}

/**
 * Разбор пачки показателей из одного вызова log_measurement.
 * Возвращает два списка: что писать в открытый контур, что — в контур здоровья.
 */
function splitByContour(items) {
  const open = [];
  const sens = [];
  for (const item of items || []) {
    const verdict = classifyMetric(item && item.metric);
    (verdict.contour === 'open' ? open : sens).push({ ...item, metric: verdict.key,
      sensitive: verdict.sensitive, contour: verdict.contour });
  }
  return { open, sens };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyMetric, splitByContour, normalizeMetric, OPEN, KNOWN_SENSITIVE };
}
