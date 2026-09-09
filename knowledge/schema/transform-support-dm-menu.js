/**
 * SupportBot01: команды владельца + кнопочное меню.
 *
 * Повод: 18.08.2026 понадобилось написать одной клиентке — и выяснилось, что способа
 * НЕТ вообще. Есть /broadcast на всех и приём обращений, а «ответить конкретному
 * человеку» не было. Пришлось слать вручную через API. На тысяче клиентов так нельзя.
 *
 * Команды (только владельцу, только в саппорт-боте — личный консультант не трогаем):
 *   /diag     — диагностика системы (уже была)
 *   /dm       — написать клиенту: id + текст -> превью -> подтверждение -> отправка
 *   /feedback — последние обращения по требованию (а не только суточный дайджест в 09:00)
 *   /help     — что умеет этот бот
 *
 * КЛЮЧЕВОЕ: отправленное клиенту пишется в n8n_chat_histories его сессии.
 * Иначе бот-консультант не знает, что он это писал, и на ответ «да, присылаю»
 * реагирует непонимающе. Поймано вручную в тот же день.
 *
 * Прогон:  node schema/transform-support-dm-menu.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-support-dm-menu.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

// Отправка владельцу в саппорт-бот (токен саппорт-бота уже загружен в Normalize).
const toOwner = (id, name, pos, textExpr) => ({
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
  id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: pos,
  onError: 'continueRegularOutput',
});

const rule = (key) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
    conditions: [{
      id: 'dmr-' + key,
      leftValue: '={{ $json.route }}',
      rightValue: key,
      operator: { type: 'string', operation: 'equals' },
    }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: key,
});

const ROUTES = ['diag', 'dm_ask', 'dm_draft', 'dm_bad', 'dm_send', 'dm_cancel', 'feedback', 'help', 'client'];

// ---------------------------------------------------------------- маршрутизатор
const CODE_ROUTE = [
  "const n = $('Normalize').first().json || {};",
  'const st = $input.first().json || {};',
  "const stage = String(st.stage || 'idle');",
  "const raw = String(n.text || '').trim();",
  'const low = raw.toLowerCase();',
  '',
  '// ВАЖНО: поля Normalize прокидываем дальше целиком. Ниже по потоку',
  "// ('/start?', 'Есть текст?', классификатор) читают $json.text — если вернуть",
  '// только маршрут, клиентские обращения уходят в «напишите текстом».',
  '// Ровно на этом проект уже спотыкался с голосовой веткой.',
  "if (!n.is_owner) return [{ json: Object.assign({}, n, { route: 'client' }) }];",
  '',
  '// id получателя и текст: либо в самой команде, либо следующим сообщением.',
  'const parseTarget = (s) => {',
  '  const m = String(s || {}).match(/^\\s*(\\d{5,15})\\s+([\\s\\S]+)$/);',
  '  return m ? { user_id: Number(m[1]), body: m[2].trim() } : null;',
  '};',
  '',
  "let route = 'client', target = null;",
  "if (/^\\/diag\\b|^\\/статус\\b|что с ботом|проверь систему|проверь бота|диагностик|все ли работает|всё ли работает/i.test(raw)) {",
  "  route = 'diag';",
  "} else if (/^\\/dm_send\\b/i.test(low)) {",
  "  route = 'dm_send';",
  "} else if (/^\\/dm_cancel\\b/i.test(low)) {",
  "  route = 'dm_cancel';",
  "} else if (/^\\/feedback\\b/i.test(low)) {",
  "  route = 'feedback';",
  "} else if (/^\\/help\\b|^\\/start\\b/i.test(low)) {",
  "  route = 'help';",
  "} else if (/^\\/dm\\b/i.test(low)) {",
  "  const rest = raw.replace(/^\\/dm\\b/i, '').trim();",
  '  target = parseTarget(rest);',
  "  route = rest ? (target ? 'dm_draft' : 'dm_bad') : 'dm_ask';",
  "} else if (stage === 'awaiting') {",
  '  target = parseTarget(raw);',
  "  route = target ? 'dm_draft' : 'dm_bad';",
  '} else {',
  '  // Владелец просто что-то написал — пусть это будет обычным обращением, как раньше.',
  "  route = 'client';",
  '}',
  '',
  'return [{ json: Object.assign({}, n, {',
  '  route,',
  '  target_user_id: target ? target.user_id : null,',
  '  body: target ? target.body : null,',
  '  stage,',
  '}) }];',
].join('\n');

const CODE_DRAFT = [
  "const r = $('Влад: маршрут').first().json || {};",
  'const found = $input.first().json || {};',
  'const ok = !!(found && found.bot_token);',
  'return [{ json: {',
  '  found: ok,',
  '  target_user_id: r.target_user_id,',
  "  target_bot_id: ok ? found.bot_id : null,",
  "  bot_username: ok ? found.bot_username : null,",
  '  body: r.body,',
  "  preview: ok",
  "    ? ('Отправить это клиенту ' + r.target_user_id + ' в @' + found.bot_username + '?\\n\\n— — —\\n' + r.body + '\\n— — —\\n\\n/dm_send — отправить\\n/dm_cancel — отменить')",
  "    : ('Клиент ' + r.target_user_id + ' не найден среди активных. Проверь id — его видно в /feedback и в отчётах.'),",
  '} }];',
].join('\n');

const CODE_FEEDBACK = [
  'const rows = $input.all().map((i) => i.json).filter((r) => r && r.id);',
  "if (!rows.length) return [{ json: { text: 'Обращений пока нет.' } }];",
  "const icon = { complaint: '🔴', tech: '⚙️', suggestion: '💡', other: '💬' };",
  "const lines = ['Последние обращения:', ''];",
  'rows.forEach((r) => {',
  "  const when = new Date(r.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });",
  "  const who = (r.username ? '@' + r.username + ' ' : '') + '(' + r.from_id + ')';",
  "  lines.push((icon[r.category] || '💬') + ' ' + when + ' ' + who);",
  "  lines.push(String(r.text || '').slice(0, 300));",
  "  lines.push('');",
  '});',
  "lines.push('Ответить: /dm ' + rows[0].from_id + ' текст');",
  "return [{ json: { text: lines.join('\\n') } }];",
].join('\n');

const HELP = [
  'Это служебный бот ИИ-Тренера.',
  '',
  '/diag — проверить систему целиком',
  '/dm — написать клиенту (id и текст одним сообщением)',
  '/feedback — последние обращения от клиентов',
  '/help — эта подсказка',
  '',
  'Клиенты пишут сюда жалобы и пожелания, сводка приходит в 09:00.',
].join('\n');

// ---------------------------------------------------------------- новые узлы
const NEW = [
  {
    parameters: {
      operation: 'executeQuery',
      query: "SELECT stage, target_user_id, target_bot_id FROM dm_state WHERE k = 'main';",
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000001', name: 'Влад: состояние',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-160, 0],
    credentials: PG, alwaysOutputData: true, onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: CODE_ROUTE },
    id: 'sup-dm-0000-0000-000000000002', name: 'Влад: маршрут',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [40, 0],
  },
  {
    parameters: { rules: { values: ROUTES.map(rule) }, looseTypeValidation: true, options: {} },
    id: 'sup-dm-0000-0000-000000000003', name: 'Влад: развилка',
    type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: [240, 0],
  },
  // --- /dm без аргументов ---
  {
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE dm_state SET stage='awaiting', target_user_id=NULL, target_bot_id=NULL, body=NULL, updated_at=now() WHERE k='main';",
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000004', name: 'DM: ждём',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [460, -140], credentials: PG,
  },
  toOwner('sup-dm-0000-0000-000000000005', 'DM: спросить формат', [660, -140],
    'Кому пишем? Пришли одним сообщением: сначала id клиента, потом текст.\n\nНапример:\n8432469418 Привет! Напоминаю про замеры на этой неделе.\n\nid клиента видно в /feedback и в отчётах. Отменить — /dm_cancel'),
  // --- разбор цели ---
  {
    parameters: {
      operation: 'executeQuery',
      query: [
        'SELECT c.bot_id, c.bot_token, c.bot_username',
        '  FROM user_access ua',
        '  JOIN clients c ON c.bot_id = ua.bot_id',
        ' WHERE ua.user_id = $1',
        '   AND (ua.access_until IS NULL OR ua.access_until >= current_date)',
        ' ORDER BY ua.updated_at DESC',
        ' LIMIT 1;',
      ].join('\n'),
      options: { queryReplacement: '={{ [ $json.target_user_id ] }}' },
    },
    id: 'sup-dm-0000-0000-000000000006', name: 'DM: найти клиента',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [460, 0],
    credentials: PG, alwaysOutputData: true, onError: 'continueRegularOutput',
  },
  {
    parameters: { jsCode: CODE_DRAFT },
    id: 'sup-dm-0000-0000-000000000007', name: 'DM: черновик',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'dmf1', leftValue: '={{ $json.found }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      },
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000008', name: 'DM: найден?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [860, 0],
  },
  {
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE dm_state SET stage='confirm', target_user_id=$1, target_bot_id=$2, body=$3, updated_at=now() WHERE k='main';",
      options: { queryReplacement: '={{ [ $json.target_user_id, $json.target_bot_id, $json.body ] }}' },
    },
    id: 'sup-dm-0000-0000-000000000009', name: 'DM: сохранить черновик',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1060, -60], credentials: PG,
  },
  toOwner('sup-dm-0000-0000-000000000010', 'DM: превью', [1260, -60],
    "={{ $('DM: черновик').first().json.preview }}"),
  toOwner('sup-dm-0000-0000-000000000011', 'DM: не найден', [1060, 100],
    "={{ $('DM: черновик').first().json.preview }}"),
  toOwner('sup-dm-0000-0000-000000000012', 'DM: формат', [460, 140],
    'Не понял формат. Нужно: id клиента, пробел, текст.\n\nНапример:\n8432469418 Привет! Напоминаю про замеры.\n\nОтменить — /dm_cancel'),
  // --- отправка ---
  {
    parameters: {
      operation: 'executeQuery',
      query: [
        'SELECT d.target_user_id, d.target_bot_id, d.body, c.bot_token, c.bot_username',
        '  FROM dm_state d JOIN clients c ON c.bot_id = d.target_bot_id',
        " WHERE d.k = 'main' AND d.stage = 'confirm';",
      ].join('\n'),
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000013', name: 'DM: взять черновик',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [460, 300],
    credentials: PG, alwaysOutputData: true,
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'dmh1', leftValue: '={{ $json.body }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
      },
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000014', name: 'DM: есть черновик?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [660, 300],
  },
  {
    // Шлём через токен ЕГО бота, а не саппорт-бота: клиент должен получить
    // сообщение в том чате, где он и общается с тренером.
    parameters: {
      method: 'POST',
      url: "=https://api.telegram.org/bot{{ $('DM: взять черновик').first().json.bot_token }}/sendMessage",
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: 'chat_id', value: "={{ $('DM: взять черновик').first().json.target_user_id }}" },
          { name: 'text', value: "={{ $('DM: взять черновик').first().json.body }}" },
        ],
      },
      options: { timeout: 20000 },
    },
    id: 'sup-dm-0000-0000-000000000015', name: 'DM: отправить клиенту',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [860, 300],
    onError: 'continueErrorOutput',
  },
  {
    // Без этой записи бот-консультант не знает, что он писал клиенту,
    // и на ответ «да, присылаю» отреагирует непонимающе.
    parameters: {
      operation: 'executeQuery',
      query: "INSERT INTO n8n_chat_histories (session_id, message) VALUES ($1, jsonb_build_object('type','ai','content',$2));",
      options: {
        queryReplacement:
          "={{ [ $('DM: взять черновик').first().json.target_bot_id + ':' + $('DM: взять черновик').first().json.target_user_id, $('DM: взять черновик').first().json.body ] }}",
      },
    },
    id: 'sup-dm-0000-0000-000000000016', name: 'DM: в историю',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1060, 260], credentials: PG,
    onError: 'continueRegularOutput',
  },
  {
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE dm_state SET stage='idle', target_user_id=NULL, target_bot_id=NULL, body=NULL, updated_at=now() WHERE k='main';",
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000017', name: 'DM: очистить',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1260, 260], credentials: PG,
  },
  toOwner('sup-dm-0000-0000-000000000018', 'DM: отчёт', [1460, 260],
    "={{ 'Отправлено клиенту ' + $('DM: взять черновик').first().json.target_user_id + ' в @' + $('DM: взять черновик').first().json.bot_username + '. Сообщение записано в его диалог — бот знает, что он это сказал.' }}"),
  toOwner('sup-dm-0000-0000-000000000019', 'DM: сбой отправки', [1060, 420],
    "={{ 'НЕ отправилось клиенту ' + $('DM: взять черновик').first().json.target_user_id + '. Черновик сохранён, можно повторить через /dm_send. Частая причина — клиент заблокировал бота.' }}"),
  toOwner('sup-dm-0000-0000-000000000020', 'DM: нечего слать', [860, 420],
    'Черновика нет. Сначала /dm, потом id и текст.'),
  // --- отмена ---
  {
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE dm_state SET stage='idle', target_user_id=NULL, target_bot_id=NULL, body=NULL, updated_at=now() WHERE k='main';",
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000021', name: 'DM: отмена',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [460, 460], credentials: PG,
  },
  toOwner('sup-dm-0000-0000-000000000022', 'DM: отменено', [660, 460], 'Отменил, ничего не отправлено.'),
  // --- обращения ---
  {
    parameters: {
      operation: 'executeQuery',
      query: [
        "SELECT id, created_at, category, coalesce(username,'') AS username, from_id, left(text, 300) AS text",
        '  FROM feedback ORDER BY id DESC LIMIT 10;',
      ].join('\n'),
      options: {},
    },
    id: 'sup-dm-0000-0000-000000000023', name: 'Обращения: выборка',
    type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [460, 600],
    credentials: PG, alwaysOutputData: true,
  },
  {
    parameters: { jsCode: CODE_FEEDBACK },
    id: 'sup-dm-0000-0000-000000000024', name: 'Обращения: текст',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 600],
  },
  toOwner('sup-dm-0000-0000-000000000025', 'Обращения: ответ', [860, 600], '={{ $json.text }}'),
  toOwner('sup-dm-0000-0000-000000000026', 'Помощь: ответ', [460, 740], HELP),
];

NEW.forEach((n) => { if (byName(n.name)) fail('узел уже есть: ' + n.name); wf.nodes.push(n); });

// ---------------------------------------------------------------- разводка
const startNode = byName('/start?') || fail('нет узла /start?');
const old = byName('Диаг: запрос?');
if (old) {
  wf.nodes = wf.nodes.filter((n) => n.name !== 'Диаг: запрос?');
  delete wf.connections['Диаг: запрос?'];
}

wf.connections['Normalize'] = { main: [[{ node: 'Влад: состояние', type: 'main', index: 0 }]] };
wf.connections['Влад: состояние'] = { main: [[{ node: 'Влад: маршрут', type: 'main', index: 0 }]] };
wf.connections['Влад: маршрут'] = { main: [[{ node: 'Влад: развилка', type: 'main', index: 0 }]] };

const to = (name) => [{ node: name, type: 'main', index: 0 }];
wf.connections['Влад: развилка'] = {
  main: [
    to('Диаг: принял'),          // diag
    to('DM: ждём'),              // dm_ask
    to('DM: найти клиента'),     // dm_draft
    to('DM: формат'),            // dm_bad
    to('DM: взять черновик'),    // dm_send
    to('DM: отмена'),            // dm_cancel
    to('Обращения: выборка'),    // feedback
    to('Помощь: ответ'),         // help
    to(startNode.name),          // client
  ],
};
wf.connections['DM: ждём'] = { main: [to('DM: спросить формат')] };
wf.connections['DM: найти клиента'] = { main: [to('DM: черновик')] };
wf.connections['DM: черновик'] = { main: [to('DM: найден?')] };
wf.connections['DM: найден?'] = { main: [to('DM: сохранить черновик'), to('DM: не найден')] };
wf.connections['DM: сохранить черновик'] = { main: [to('DM: превью')] };
wf.connections['DM: взять черновик'] = { main: [to('DM: есть черновик?')] };
wf.connections['DM: есть черновик?'] = { main: [to('DM: отправить клиенту'), to('DM: нечего слать')] };
wf.connections['DM: отправить клиенту'] = { main: [to('DM: в историю'), to('DM: сбой отправки')] };
wf.connections['DM: в историю'] = { main: [to('DM: очистить')] };
wf.connections['DM: очистить'] = { main: [to('DM: отчёт')] };
wf.connections['DM: отмена'] = { main: [to('DM: отменено')] };
wf.connections['Обращения: выборка'] = { main: [to('Обращения: текст')] };
wf.connections['Обращения: текст'] = { main: [to('Обращения: ответ')] };

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// ---------------------------------------------------------------- проверка фактом
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const names = w.nodes.map((n) => n.name);
NEW.forEach((n) => { if (!names.includes(n.name)) fail('не вставился ' + n.name); });
if (names.includes('Диаг: запрос?')) fail('старый узел не удалён');
w.nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => {
  try { new Function(n.parameters.jsCode); } catch (e) { fail('код не компилируется в ' + n.name + ' — ' + e.message); }
});
const sw = w.nodes.find((n) => n.name === 'Влад: развилка');
if (sw.parameters.rules.values.length !== ROUTES.length) fail('в развилке не все маршруты');
if (w.connections['Влад: развилка'].main.length !== ROUTES.length) fail('у развилки не все выходы разведены');
const orphan = Object.keys(w.connections).filter((k) => !names.includes(k));
if (orphan.length) fail('связи ведут из несуществующих узлов: ' + orphan.join(', '));
const targets = [];
Object.values(w.connections).forEach((c) => (c.main || []).forEach((b) => (b || []).forEach((x) => targets.push(x.node))));
const missing = targets.filter((t) => !names.includes(t));
if (missing.length) fail('связи ведут в несуществующие узлы: ' + missing.join(', '));
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| маршрутов', ROUTES.length);
