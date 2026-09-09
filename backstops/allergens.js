/**
 * Слой 2 защиты по аллергенам: детерминированный матчинг на уровне КАТЕГОРИЙ.
 *
 * Почему одной подстроки мало (knowledge/memory/allergen-defense.md):
 *  1. составные продукты прячут аллерген: марципан → миндаль, сурими → рыба, песто → кедровые орехи;
 *  2. клиент записан общим словом «орехи», а в блюде «миндаль» — подстрока не совпадёт;
 *  3. вопрос «можно ли мне X» приходит вне рецептов, значит проверка нужна всегда.
 *
 * Поэтому и аллерген клиента, и ингредиент сводятся к КАТЕГОРИИ (group_key), и сравниваются
 * категории. Справочники заведомо неполны — незнакомое закрывает консервативный дефолт:
 * не уверен на 100 %, что аллергена нет, — не говори «да».
 *
 * Данные приходят из Postgres (schema/allergen-layer2.sql): allergen_group и food_allergen.
 * Здесь только логика — та же, что в узле подчинённого workflow CheckAllergTool01.
 */

function normalize(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е').trim();
}

/** Категории, к которым сводится одно слово (аллерген клиента или ингредиент). */
function toGroups(term, groups, foods) {
  const t = normalize(term);
  const found = new Set();
  if (!t) return found;

  for (const g of groups) {
    if (normalize(g.group_key) === t) found.add(g.group_key);
    for (const syn of g.synonyms || []) {
      const s = normalize(syn);
      // Совпадение по слову, а не по случайной подстроке: «сырники» не должны ловиться
      // на «сыр», но «сливочное масло» обязано поймать «сливочный».
      if (s && (t === s || new RegExp(`(^|[^а-яa-z])${escapeRe(s)}([^а-яa-z]|$)`).test(t))) {
        found.add(g.group_key);
      }
    }
  }
  for (const f of foods) {
    const term = normalize(f.food_term);
    if (term && (t === term || new RegExp(`(^|[^а-яa-z])${escapeRe(term)}([^а-яa-z]|$)`).test(t))) {
      found.add(f.group_key);
    }
  }
  return found;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {Array<{substance: string, severity: 'allergy'|'intolerance'}>} clientAllergens
 * @param {string[]} ingredients — состав, РАЗЛОЖЕННЫЙ моделью на компоненты
 * @param {Array<{group_key: string, title_ru: string, synonyms: string[]}>} groups
 * @param {Array<{food_term: string, group_key: string}>} foods
 * @returns {{verdict: 'block'|'warn'|'clear', blocked: object[], warnings: object[], response: string}}
 */
function checkAllergens(clientAllergens, ingredients, groups, foods) {
  const byGroup = new Map();           // категория -> самая строгая степень у клиента
  for (const a of clientAllergens || []) {
    const severity = a.severity === 'allergy' ? 'allergy' : 'intolerance';
    for (const g of toGroups(a.substance, groups, foods)) {
      if (byGroup.get(g) !== 'allergy') byGroup.set(g, severity);
    }
  }

  const blocked = [];
  const warnings = [];
  for (const ing of ingredients || []) {
    for (const g of toGroups(ing, groups, foods)) {
      if (!byGroup.has(g)) continue;
      const title = (groups.find((x) => x.group_key === g) || {}).title_ru || g;
      const hit = { ingredient: ing, group: g, title };
      if (byGroup.get(g) === 'allergy') blocked.push(hit);
      else warnings.push(hit);
    }
  }

  const say = (list) => list.map((h) => `${h.ingredient} → ${h.title}`).join('; ');
  if (blocked.length) {
    return { verdict: 'block', blocked, warnings,
      response: `БЛОКИРОВКА: ${say(blocked)} (аллергия). Не предлагать, заменить.`
        + (warnings.length ? ` Дополнительно предупреждение: ${say(warnings)}.` : '') };
  }
  if (warnings.length) {
    return { verdict: 'warn', blocked, warnings,
      response: `ПРЕДУПРЕЖДЕНИЕ: ${say(warnings)} (непереносимость). Предупредить явно.` };
  }
  return { verdict: 'clear', blocked, warnings,
    response: 'ЧИСТО: запрещённого и предупреждений нет. Справочник неполон — при сомнении в составе не утверждай «можно».' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { checkAllergens, toGroups, normalize };
}
