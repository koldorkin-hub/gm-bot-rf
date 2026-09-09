// Тесты идут на НАСТОЯЩИХ справочниках боевого бота: сиды разбираются прямо из
// knowledge/schema/allergen-layer2.sql. Если справочник поменяется — тест это увидит.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { checkAllergens } = require('../allergens.js');

const SQL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'knowledge', 'schema', 'allergen-layer2.sql'), 'utf8');

function parseGroups(sql) {
  const block = sql.split('INSERT INTO allergen_group')[1].split('ON CONFLICT')[0];
  const rows = [...block.matchAll(/\('([^']+)','([^']*)',\s*ARRAY\[([^\]]*)\]\)/g)];
  return rows.map(([, group_key, title_ru, arr]) => ({
    group_key, title_ru,
    synonyms: [...arr.matchAll(/'([^']*)'/g)].map((m) => m[1]),
  }));
}

function parseFoods(sql) {
  const block = sql.split('INSERT INTO food_allergen')[1].split('ON CONFLICT')[0];
  return [...block.matchAll(/\('([^']+)','([^']+)',\s*(?:'[^']*'|NULL)\)/g)]
    .map(([, food_term, group_key]) => ({ food_term, group_key }));
}

const GROUPS = parseGroups(SQL);
const FOODS = parseFoods(SQL);
const nuts = [{ substance: 'орехи', severity: 'allergy' }];
const lactose = [{ substance: 'лактоза', severity: 'intolerance' }];
const both = [...nuts, ...lactose];

test('справочники разобраны из боевого SQL', () => {
  assert.strictEqual(GROUPS.length, 11);
  assert.ok(FOODS.length > 60, `продуктов в карте: ${FOODS.length}`);
});

test('марципан блокируется по орехам, хотя слова «орех» в нём нет', () => {
  const r = checkAllergens(nuts, ['миндаль', 'сахар', 'яичный белок'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'block');
  assert.match(r.response, /миндаль → орехи/);
});

test('составное блюдо ловится целиком, даже если модель не разложила состав', () => {
  const r = checkAllergens(nuts, ['марципан'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'block');
});

test('песто ловится и по орехам, и по молоку', () => {
  const r = checkAllergens(both, ['песто'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'block');
  assert.strictEqual(r.warnings.length >= 1, true);
});

test('нутелла — фундук через карту составных', () => {
  assert.strictEqual(checkAllergens(nuts, ['нутелла'], GROUPS, FOODS).verdict, 'block');
});

test('непереносимость даёт предупреждение, а не блокировку', () => {
  const r = checkAllergens(lactose, ['сыр моцарелла'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'warn');
  assert.match(r.response, /ПРЕДУПРЕЖДЕНИЕ/);
});

test('чистый продукт не переблокирован', () => {
  const r = checkAllergens(both, ['куриная грудка', 'рис', 'огурец'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'clear');
});

test('аллергия на орехи не блокирует лактозные продукты и наоборот', () => {
  assert.strictEqual(checkAllergens(nuts, ['творог'], GROUPS, FOODS).verdict, 'clear');
  assert.strictEqual(checkAllergens(lactose, ['миндаль'], GROUPS, FOODS).verdict, 'clear');
});

test('аллерген клиента, названный частным словом, сводится к категории', () => {
  const r = checkAllergens([{ substance: 'фундук', severity: 'allergy' }], ['миндаль'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'block', 'фундук и миндаль — одна категория орехов');
});

test('подстрока внутри другого слова не срабатывает', () => {
  // «сырок» и «сырники» — молочные, а вот «сырое яйцо» не должно ловиться на «сыр».
  const r = checkAllergens(lactose, ['сырое мясо'], GROUPS, FOODS);
  assert.strictEqual(r.verdict, 'clear');
});

test('регистр и буква ё не мешают', () => {
  assert.strictEqual(checkAllergens(nuts, ['МиНдАлЬ'], GROUPS, FOODS).verdict, 'block');
  assert.strictEqual(
    checkAllergens([{ substance: 'сёмга', severity: 'allergy' }], ['семга'], GROUPS, FOODS).verdict,
    'block');
});

test('пустые входы не роняют проверку', () => {
  assert.strictEqual(checkAllergens([], ['марципан'], GROUPS, FOODS).verdict, 'clear');
  assert.strictEqual(checkAllergens(nuts, [], GROUPS, FOODS).verdict, 'clear');
  assert.strictEqual(checkAllergens(null, null, GROUPS, FOODS).verdict, 'clear');
});

test('ответ инструмента всегда напоминает про неполноту справочника', () => {
  assert.match(checkAllergens(nuts, ['кабачок'], GROUPS, FOODS).response, /Справочник неполон/);
});
