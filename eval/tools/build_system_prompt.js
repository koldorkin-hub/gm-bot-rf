/**
 * Сборка системного промпта для стенда из скриптов-трансформов действующего бота.
 *
 * Зачем так. Экспорта главного workflow («ИИ Тренер - Telegram Bot») в репозитории нет,
 * а системник живёт внутри него — в узле AI Agent. Но каждый блок системника когда-то
 * ставился скриптом из knowledge/schema/, и текст блока лежит в скрипте дословно.
 * Значит промпт восстанавливается из скриптов, а не переписывается по памяти.
 *
 * Что здесь НЕ восстановимо и оговорено в prompt/ИСТОЧНИКИ.md:
 *   — точный порядок блоков в боевом узле (здесь взят порядок РФ-версии: глобальные
 *     блоки → персона → профиль, ради единого кэша префикса);
 *   — блоки, которые правились позже трансформами, не попавшими в перенос.
 * Когда владелец выгрузит боевой workflow — этот скрипт заменяется одной строкой
 * извлечения systemMessage, а стенд не меняется вовсе.
 *
 * Прогон: node eval/tools/build_system_prompt.js
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = path.join(__dirname, '..', '..', 'knowledge', 'schema');
const OUT = path.join(__dirname, '..', 'prompt', 'system_message.txt');
const read = (f) => fs.readFileSync(path.join(SCHEMA, f), 'utf8');
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// ---- 1. Сжатые блоки из transform-main-prompt-slim.js (последняя правка системника) ----
const slim = read('transform-main-prompt-slim.js');
const blocks = new Map();
const reSlim = /replace\('(===[^']+)',\s*`([\s\S]*?)`\s*\);/g;
for (let m; (m = reSlim.exec(slim)); ) blocks.set(m[1].trim(), m[2].trim());
if (blocks.size < 15) fail('из prompt-slim извлечено всего блоков: ' + blocks.size);

// ---- 2. Блоки из остальных трансформов ----
const litTemplate = (src, name) => {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\n?`([\\s\\S]*?)`\\s*;'));
  return m ? m[1].trim() : null;
};
const litString = (src, name) => {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;'));
  return m ? JSON.parse(m[1]).trim() : null;
};
const litArrayJoin = (src, name) => {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join'));
  if (!m) return null;
  // Массив строковых литералов — разворачиваем без исполнения чужого кода.
  return new Function('return [' + m[1] + ']')().join('\n').trim();
};

const farma = read('transform-main-farma-border.js');
const conf = litTemplate(farma, 'conf') || fail('нет блока КОНФИДЕНЦИАЛЬНОСТЬ');
// ГРАНИЦА берётся из более поздней правки (02.08.2026, анализы принимаются), не из farma-border.
const border = litArrayJoin(read('transform-main-border-analyses.js'), 'border') || fail('нет блока ГРАНИЦА');
const jail = litTemplate(read('transform-main-antijailbreak.js'), 'block') || fail('нет блока УСТОЙЧИВОСТЬ');
const gram = litString(read('transform-main-language-note.js'), 'block') || fail('нет блока ГРАМОТНОСТЬ');
const btn = litTemplate(read('transform-main-buttons.js'), 'BLOCK') || fail('нет блока КНОПКИ');

const get = (head) => blocks.get(head) || fail('в prompt-slim нет блока ' + head);

// ---- 3. n8n-выражения: исполняем те же тернары, что исполняет n8n ----
// В блоках остаются выражения вида {{ ... bot_type === 'owner' ? 'A' : 'B' }}.
// Гадать по ним нельзя — вычисляем ровно тем же выражением, подставив bot_type,
// а обращения к персоне и профилю превращаем в маркеры стенда.
const resolve = (text, bot_type) => text.replace(/\{\{([\s\S]*?)\}\}/g, (all, expr) => {
  if (/^(BORDER|PERSONA|PROFILE)$/.test(expr.trim())) return all;
  const json = new Proxy({ bot_type }, {
    get: (t, k) => (k === 'bot_type' ? bot_type
      : k === 'system_prompt' ? '{{PERSONA}}'
      : k === 'profile_block' ? '{{PROFILE}}'
      : ''),
  });
  const $ = () => ({ first: () => ({ json }) });
  try { return String(new Function('$', 'return (' + expr + ')')($) ?? ''); }
  catch (e) { fail('не вычислилось n8n-выражение: ' + expr.slice(0, 80) + ' — ' + e.message); }
});

// ---- 4. Порядок блоков РФ-версии: сначала неизменное (кэш), в конце персона и профиль ----
const parts = [
  get('=== КРАСНЫЕ ФЛАГИ'),
  get('=== ОЦЕНКА ТЕЛА ПО ФОТО'),
  jail,
  conf,
  '{{BORDER}}',                    // только для bot_type=client
  gram,
  get('=== РАЗБОРЫ И ИССЛЕДОВАНИЯ'),
  get('=== ТВОИ ВОЗМОЖНОСТИ'),
  get('=== ФОРМАТ ОТВЕТОВ'),
  btn,
  get('=== ПАМЯТЬ И ВЕДЕНИЕ КЛИЕНТА'),
  get('=== ТРЕКИНГ ДАННЫХ'),
  get('=== ОТЧЁТ О ПРОГРЕССЕ'),
  get('=== БЕЗОПАСНОСТЬ РЕКОМЕНДАЦИЙ'),
  get('=== РАСЧЁТЫ'),
  get('=== РЕЦЕПТЫ'),
  get('=== АЛЛЕРГЕНЫ'),
  get('=== ДАТА И ДЕНЬ НЕДЕЛИ'),
  get('=== РАСХОД КАЛОРИЙ И ДЕФИЦИТ'),
  get('=== НАПОМИНАНИЯ'),
  get('=== ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ'),
  '=== ПЕРСОНА ===\n{{PERSONA}}',
  '{{PROFILE}}',
];
const raw = parts.join('\n\n') + '\n';

// ---- 5. По файлу на каждый тип бота; ГРАНИЦА — только клиентским ----
const MUST = [
  '103', '112', 'РПП', 'суицид', 'телефоны доверия НЕ называй',
  'check_recipe_allergens ОБЯЗАТЕЛЬНО', 'марципан→миндаль',
  'НЕ вычисляй день недели', 'ПОТРАЧЕНО СЕГОДНЯ НА АКТИВНОСТИ',
  'ТОЛЬКО инструментом calculate', '[[кнопки:', 'разметка не работает',
  'set_reminder', 'lookup_food', 'log_food', 'log_workout', 'save_health',
  '=== КОНФИДЕНЦИАЛЬНОСТЬ', '=== ГРАМОТНОСТЬ', '=== УСТОЙЧИВОСТЬ ПРАВИЛ',
  '{{PERSONA}}', '{{PROFILE}}',
];
['анаболические стероиды', 'АНАЛИЗЫ, ВЫПИСКИ', 'Дозу не оцениваешь'].forEach((k) => {
  if (border.indexOf(k) === -1) fail('в блоке ГРАНИЦА нет правила: ' + k);
});

for (const bt of ['client', 'owner', 'trusted']) {
  const withBorder = raw.replace('{{BORDER}}', bt === 'client' ? border : '');
  const text = resolve(withBorder, bt).replace(/\n{3,}/g, '\n\n');
  const file = path.join(__dirname, '..', 'prompt', 'system_message.' + bt + '.txt');
  fs.writeFileSync(file, text, 'utf8');

  const missing = MUST.filter((k) => text.indexOf(k) === -1);
  if (missing.length) fail(bt + ': в промпте нет ключевых правил: ' + missing.join(' | '));
  const stray = (text.match(/\{\{(?!PERSONA|PROFILE)/g) || []).length;
  if (stray) fail(bt + ': остались невычисленные n8n-выражения: ' + stray + ' шт');
  const hasBorder = text.indexOf('ВНЕ КОМПЕТЕНЦИИ') !== -1;
  if ((bt === 'client') !== hasBorder) fail(bt + ': граница компетенции стоит не там, где должна');
  const ownerTail = text.indexOf('он сам ставит себе цели') !== -1;
  if ((bt === 'owner') !== ownerTail) fail(bt + ': хвост владельца в блоке фото стоит не там, где должен');
  console.log('OK -> prompt/system_message.' + bt + '.txt | блоков:',
    (text.match(/^=== /gm) || []).length, '| знаков:', text.length,
    '| ~токенов:', Math.round(text.length / 2.7));
}
