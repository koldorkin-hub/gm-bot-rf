/**
 * SupportBot01: команда /diag для владельца.
 *
 * Владелец пишет саппорт-боту «/diag» (или «что с ботом», «проверь систему») ->
 * мгновенное «проверяю» -> прогон SelfDiag01 -> человеческий отчёт.
 * Всё остальное (обращения клиентов) идёт прежним путём без изменений.
 *
 * Признак владельца и признак диагностики считает Normalize (детерминированно,
 * не регуляркой в IF-узле) — так проще читать и тестировать.
 *
 * Правки делаются по объекту, а не строковой заменой: String.replace в трансформах
 * уже портил прод спецпаттернами $' (грабля деплоя, п.9).
 *
 * Прогон:  node schema/transform-support-diag.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-support-diag.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// --- 1. Load Support: добавить owner_chat_id ---
const load = byName('Load Support') || fail('нет узла Load Support');
load.parameters.query =
  "SELECT bot_token, webhook_secret, owner_chat_id FROM support_bot WHERE bot_username='GymAK_Support_Bot' LIMIT 1;";

// --- 2. Normalize: признаки владельца и диагностического запроса ---
const norm = byName('Normalize') || fail('нет узла Normalize');
norm.parameters.jsCode = [
  "const u = ($('Webhook').first().json.body) || {};",
  'const m = u.message || u.edited_message || {};',
  "const sup = $('Load Support').first().json || {};",
  "const text = String(m.text || '').trim();",
  'const fromId = (m.from && m.from.id) || null;',
  'const ownerId = Number(sup.owner_chat_id || 0);',
  'const isOwner = !!fromId && !!ownerId && Number(fromId) === ownerId;',
  '// Диагностику пускаем ТОЛЬКО владельцу — клиенту внутренности системы не показываем.',
  'const isDiag = isOwner && /^\\/diag\\b|^\\/статус\\b|что с ботом|проверь систему|проверь бота|' +
    'диагностик|все ли работает|всё ли работает|система в порядке|как система/i.test(text);',
  'return [{ json: {',
  '  chat_id: (m.chat && m.chat.id) || null,',
  '  from_id: fromId,',
  "  username: (m.from && m.from.username) || '',",
  "  first_name: (m.from && m.from.first_name) || '',",
  '  text,',
  '  bot_token: sup.bot_token,',
  '  is_owner: isOwner,',
  '  is_diag: isDiag',
  '} }];',
].join('\n');

// --- 3. Новые узлы ветки диагностики ---
const sendMessage = (id, name, pos, textExpr) => ({
  parameters: {
    method: 'POST',
    url: "=https://api.telegram.org/bot{{ $('Normalize').first().json.bot_token }}/sendMessage",
    sendBody: true,
    bodyParameters: {
      parameters: [
        { name: 'chat_id', value: "={{ $('Normalize').first().json.chat_id }}" },
        { name: 'text', value: textExpr },
      ],
    },
    options: { timeout: 20000 },
  },
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.4,
  position: pos,
  onError: 'continueRegularOutput',
});

const NEW = [
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{
          id: 'dg1',
          leftValue: '={{ $json.is_diag }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
      },
      options: {},
    },
    id: 'sup-diag-0000-0000-000000000001',
    name: 'Диаг: запрос?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-160, 0],
  },
  // Пробы идут последовательно и занимают до полуминуты — без подтверждения
  // это выглядит как «бот не ответил».
  sendMessage('sup-diag-0000-0000-000000000002', 'Диаг: принял', [40, -220],
    '🩺 Проверяю систему, это займёт до полуминуты…'),
  {
    parameters: {
      workflowId: { __rl: true, value: 'SelfDiag000001', mode: 'list', cachedResultName: 'Диагностика — проверка системы' },
      workflowInputs: { mappingMode: 'defineBelow', value: { source: 'support' } },
      options: {},
    },
    id: 'sup-diag-0000-0000-000000000003',
    name: 'Диаг: вызов',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: [240, -220],
  },
  sendMessage('sup-diag-0000-0000-000000000004', 'Диаг: ответ', [440, -220],
    "={{ $('Диаг: вызов').first().json.text }}"),
];

NEW.forEach((n) => {
  if (byName(n.name)) fail('узел уже существует: ' + n.name);
  wf.nodes.push(n);
});

// --- 4. Перепроводка: Normalize -> Диаг: запрос? -> [да] диагностика / [нет] прежний поток ---
const start = byName('/start?') || fail('нет узла /start?');
wf.connections['Normalize'] = { main: [[{ node: 'Диаг: запрос?', type: 'main', index: 0 }]] };
wf.connections['Диаг: запрос?'] = {
  main: [
    [{ node: 'Диаг: принял', type: 'main', index: 0 }],
    [{ node: start.name, type: 'main', index: 0 }],
  ],
};
wf.connections['Диаг: принял'] = { main: [[{ node: 'Диаг: вызов', type: 'main', index: 0 }]] };
wf.connections['Диаг: вызов'] = { main: [[{ node: 'Диаг: ответ', type: 'main', index: 0 }]] };

// --- 5. Запас по времени: пробы последовательные, 120 с могло не хватить ---
wf.settings = wf.settings || {};
wf.settings.executionTimeout = 240;

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// Проверяем фактом, а не кодом возврата.
const check = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(check) ? check[0] : check;
const names = w.nodes.map((n) => n.name);
const need = ['Диаг: запрос?', 'Диаг: принял', 'Диаг: вызов', 'Диаг: ответ'];
const missing = need.filter((n) => !names.includes(n));
if (missing.length) fail('не вставились узлы: ' + missing.join(', '));
if (!/owner_chat_id/.test(w.nodes.find((n) => n.name === 'Load Support').parameters.query)) fail('owner_chat_id не попал в запрос');
if (!/is_diag/.test(w.nodes.find((n) => n.name === 'Normalize').parameters.jsCode)) fail('is_diag не попал в Normalize');
new Function(w.nodes.find((n) => n.name === 'Normalize').parameters.jsCode);
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| таймаут', w.settings.executionTimeout);
