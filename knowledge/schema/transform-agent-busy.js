/**
 * Флаг «агент занят долгой операцией» — ставится ТОЛЬКО на веб-поиске.
 *
 * Решение владельца 03.09.2026: не вешать флаг на каждое сообщение, а только там,
 * где реально бывает долго. Иначе риск вечного «ещё думаю» при незакрытом флаге —
 * этим проектом уже дважды прилетало за подобное.
 *
 * Скрипт правит ДВА воркфлоу, режим выбирается первым аргументом:
 *   node transform-agent-busy.js tool <вход> <выход>   — WebSearchTool001: ставит флаг
 *   node transform-agent-busy.js main <вход> <выход>   — главный: гейт + снятие флага
 *
 * Логика:
 *  - ставим при ПЕРВОМ поиске в рамках сообщения (там же, где предупреждение клиенту);
 *  - снимаем после отправки ответа и на ветке отказа;
 *  - пока флаг свежий (< 15 минут), новые сообщения получают «ещё думаю», а не молчание;
 *  - протухшие снимает свип (отдельно), он же пишет клиенту, что не уложились.
 */
const fs = require('fs');

const [, , MODE, IN, OUT] = process.argv;
if (!MODE || !IN || !OUT) { console.error('usage: node transform-agent-busy.js <tool|main> <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const TRIG = 'When Executed by Another Workflow';

if (MODE === 'tool') {
  if (byName('Поиск: занял')) fail('уже вставлено');
  const ack = byName('Поиск: предупредить') || fail('нет узла предупреждения — сначала прогони transform-websearch-ack.js');

  // session_id имеет вид "bot:user"; в личных чатах chat_id совпадает с user_id.
  wf.nodes.push({
    parameters: {
      operation: 'executeQuery',
      query: [
        'INSERT INTO agent_busy (bot_id, user_id, chat_id, started_at)',
        'VALUES ($1, $2::bigint, $2::bigint, now())',
        'ON CONFLICT (bot_id, user_id) DO UPDATE SET started_at = now(), chat_id = EXCLUDED.chat_id;',
      ].join('\n'),
      options: {
        queryReplacement:
          "={{ [ String($('" + TRIG + "').first().json.bot_id || ''), " +
          "String($('" + TRIG + "').first().json.session_id || '').split(':')[1] || '0' ] }}",
      },
    },
    id: 'ws-busy-0000-4000-8000-000000000001',
    name: 'Поиск: занял',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [700, -220],
    credentials: PG,
    onError: 'continueRegularOutput',
  });

  wf.connections['Поиск: предупредить'] = { main: [[{ node: 'Поиск: занял', type: 'main', index: 0 }]] };
  wf.connections['Поиск: занял'] = { main: [[{ node: 'Собрать запрос', type: 'main', index: 0 }]] };
}

if (MODE === 'main') {
  if (byName('Агент: занят?')) fail('уже вставлено');

  const toOwnerChat = (id, name, pos, text) => ({
    parameters: {
      method: 'POST',
      url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage",
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" },
          { name: 'text', value: text },
        ],
      },
      options: { timeout: 20000 },
    },
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: pos,
    onError: 'continueRegularOutput',
  });

  const clear = (id, name, pos) => ({
    parameters: {
      operation: 'executeQuery',
      query: 'DELETE FROM agent_busy WHERE bot_id = $1 AND user_id = $2;',
      options: {
        queryReplacement:
          "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}",
      },
    },
    id, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos,
    credentials: PG, onError: 'continueRegularOutput',
  });

  // --- гейт: свежесть 15 минут, дальше флаг перестаёт блокировать сам собой ---
  wf.nodes.push({
    parameters: {
      operation: 'executeQuery',
      query: "SELECT EXISTS(SELECT 1 FROM agent_busy WHERE bot_id=$1 AND user_id=$2 AND started_at > now() - interval '15 minutes') AS busy;",
      options: {
        queryReplacement:
          "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}",
      },
    },
    id: 'm-busy-0000-4000-8000-000000000001',
    name: 'Агент: занят?',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [-1180, 520],
    credentials: PG,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  });

  wf.nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{
          id: 'mb1',
          leftValue: '={{ $json.busy }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
      },
      options: {},
    },
    id: 'm-busy-0000-4000-8000-000000000002',
    name: 'Агент: занят!',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-1000, 520],
  });

  wf.nodes.push(toOwnerChat('m-busy-0000-4000-8000-000000000003', 'Агент: подожди', [-820, 420],
    'Секунду, я ещё ищу данные по прошлому вопросу 🔎 Отвечу, как соберу — и сразу возьмусь за это.'));

  wf.nodes.push(clear('m-busy-0000-4000-8000-000000000004', 'Агент: снял', [1620, 0]));
  wf.nodes.push(clear('m-busy-0000-4000-8000-000000000005', 'Агент: снял (отказ)', [1400, 320]));

  // --- разводка гейта: втискиваем между Research: занят! [1] и Load Profile ---
  const rb = wf.connections['Research: занят!'] || fail('нет ветки Research: занят!');
  const passed = (rb.main[1] || []).map((x) => x.node);
  if (!passed.includes('Load Profile')) fail('ожидал Load Profile на выходе 1, там: ' + passed.join(','));
  rb.main[1] = [{ node: 'Агент: занят?', type: 'main', index: 0 }];
  wf.connections['Агент: занят?'] = { main: [[{ node: 'Агент: занят!', type: 'main', index: 0 }]] };
  wf.connections['Агент: занят!'] = {
    main: [
      [{ node: 'Агент: подожди', type: 'main', index: 0 }],
      [{ node: 'Load Profile', type: 'main', index: 0 }],
    ],
  };

  // --- снятие после отправки ответа ---
  const fin = wf.connections['Финал: снял'];
  if (fin && (fin.main[0] || []).length) fail('у Финал: снял появились связи — проверить вручную');
  wf.connections['Финал: снял'] = { main: [[{ node: 'Агент: снял', type: 'main', index: 0 }]] };

  // --- снятие на ветке отказа, ДО throw-узла тревоги ---
  const ap = wf.connections['Извинение: ядро не ответило'] || fail('нет ветки извинения');
  const after = (ap.main[0] || []).map((x) => x.node);
  if (!after.includes('Тревога: ядро не ответило')) fail('ожидал тревогу после извинения, там: ' + after.join(','));
  wf.connections['Извинение: ядро не ответило'] = { main: [[{ node: 'Агент: снял (отказ)', type: 'main', index: 0 }]] };
  wf.connections['Агент: снял (отказ)'] = { main: [[{ node: 'Тревога: ядро не ответило', type: 'main', index: 0 }]] };
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка целостности графа ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const names = w.nodes.map((n) => n.name);
const targets = [];
Object.entries(w.connections).forEach(([src, c]) => {
  if (!names.includes(src)) fail('связь из несуществующего узла: ' + src);
  (c.main || []).forEach((b) => (b || []).forEach((x) => targets.push(x.node)));
});
const missing = targets.filter((t) => !names.includes(t));
if (missing.length) fail('связи в никуда: ' + Array.from(new Set(missing)).join(', '));
if (MODE === 'main') {
  ['Агент: занят?', 'Агент: занят!', 'Агент: подожди', 'Агент: снял', 'Агент: снял (отказ)'].forEach((n) => {
    if (!names.includes(n)) fail('не вставлен ' + n);
  });
  if (w.connections['Агент: занят!'].main[1][0].node !== 'Load Profile') fail('основной путь не восстановлен');
}
if (MODE === 'tool' && !names.includes('Поиск: занял')) fail('флаг не ставится');
console.log('OK ->', OUT, '| режим', MODE, '| узлов', w.nodes.length);
