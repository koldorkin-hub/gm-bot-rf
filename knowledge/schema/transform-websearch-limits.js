/**
 * WebSearchTool001: лимиты против петли веб-поиска.
 *
 * Повод (03.09.2026): владелец задал вопрос по фарме, где агенту разрешено искать.
 * Описание инструмента прямо велит идти в поиск за «дозировками и протоколами»,
 * агент пошёл — и стал звать поиск снова и снова. Исполнение висело больше 10 минут
 * и умерло бы по таймауту молча: отменённое по таймауту исполнение НЕ запускает
 * ветку отказа, поэтому не было ни ответа клиенту, ни тревоги владельцу.
 *
 * Что меняется (числа согласованы с владельцем):
 *  1. Попыток HTTP: 3 -> 2. Повтор трёхминутного зависшего запроса только утраивал боль.
 *  2. Таймаут вызова: 180 -> 120 секунд. Глубину поиска (max_uses) НЕ трогаем — от неё
 *     зависит качество ответа.
 *  3. Свой лимит времени подворкфлоу: 6 минут. Две попытки по 120 с = 4 минуты чистого
 *     HTTP, остальное — запас на разбор ответа и запись источников.
 *  4. Бюджет: не более 3 вызовов поиска на ОДНО сообщение клиента. Дальше инструмент сам
 *     говорит агенту «поиск исчерпан, отвечай по собранному». Промпту тут доверять нельзя.
 *     Режим /research из-под бюджета выведен: у него свой цикл и свои лимиты.
 *
 * Прогон:  node schema/transform-websearch-limits.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-websearch-limits.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const TRIG = 'When Executed by Another Workflow';
const LIMIT = 3;

// --- 1. вход msg_key: ключ сообщения, в пределах которого считаем бюджет ---
const trig = byName(TRIG) || fail('нет триггера');
const vals = trig.parameters.workflowInputs.values;
if (!vals.some((v) => v.name === 'msg_key')) vals.push({ name: 'msg_key', type: 'string' });

// --- 2. попытки и таймаут ---
const search = byName('Claude Search') || fail('нет узла Claude Search');
search.maxTries = 2;
search.parameters.options = search.parameters.options || {};
search.parameters.options.timeout = 120000;

// --- 3. собственный лимит времени подворкфлоу ---
wf.settings = wf.settings || {};
wf.settings.executionTimeout = 360;

// --- 4. бюджет вызовов ---
if (!byName('Поиск: бюджет')) {
  wf.nodes.push({
    parameters: {
      operation: 'executeQuery',
      query: [
        'INSERT INTO websearch_budget (bot_id, session_id, msg_key, n, at)',
        'VALUES ($1, $2, $3, 1, now())',
        'ON CONFLICT (bot_id, session_id, msg_key)',
        '  DO UPDATE SET n = websearch_budget.n + 1, at = now()',
        'RETURNING n;',
      ].join('\n'),
      options: {
        queryReplacement:
          "={{ [ String($json.bot_id || ''), String($json.session_id || ''), String($json.msg_key || 'none') ] }}",
      },
    },
    id: 'ws-lim-0000-4000-8000-000000000001',
    name: 'Поиск: бюджет',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.6,
    position: [-380, 0],
    credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
  });

  wf.nodes.push({
    parameters: {
      jsCode: [
        "const inp = $('" + TRIG + "').first().json || {};",
        'const b = $input.first().json || {};',
        '// Режим /research не ограничиваем: у него собственный цикл и собственные лимиты.',
        "const isResearch = String(inp.kind || '') === 'research';",
        "const noKey = !inp.msg_key || String(inp.msg_key).trim() === '';",
        'const n = Number(b.n);',
        '// Если счётчик не прочитался (база молчит) — пропускаем, а не блокируем.',
        'const over = isFinite(n) && n > ' + LIMIT + ';',
        'return [{ json: { allowed: (isResearch || noKey || !over), n: isFinite(n) ? n : 0 } }];',
      ].join('\n'),
    },
    id: 'ws-lim-0000-4000-8000-000000000002',
    name: 'Поиск: можно?',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-200, 0],
  });

  wf.nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{
          id: 'wsl1',
          leftValue: '={{ $json.allowed }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
      },
      options: {},
    },
    id: 'ws-lim-0000-4000-8000-000000000003',
    name: 'Поиск: в пределах?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-20, 0],
  });

  wf.nodes.push({
    parameters: {
      assignments: {
        assignments: [
          {
            id: 'x1', name: 'text', type: 'string',
            value: 'Лимит веб-поиска на это сообщение исчерпан (' + LIMIT + ' запроса). ' +
              'Больше не ищи — сформулируй ответ по тому, что уже нашёл и что знаешь сам, ' +
              'и честно предупреди клиента, что часть данных проверить не удалось.',
          },
          { id: 'x2', name: 'sources', type: 'array', value: '={{ [] }}' },
        ],
      },
      includeOtherFields: false,
      options: {},
    },
    id: 'ws-lim-0000-4000-8000-000000000004',
    name: 'Поиск: лимит исчерпан',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [160, 160],
  });
}

// --- 5. «Собрать запрос» теперь читает вход у триггера, а не у предыдущего узла ---
const build = byName('Собрать запрос') || fail('нет узла Собрать запрос');
if (build.parameters.jsCode.indexOf('$input.first().json') !== -1) {
  build.parameters.jsCode = build.parameters.jsCode.replace(
    'const input = $input.first().json || {};',
    () => "// Перед нами теперь стоят узлы бюджета — вход берём напрямую у триггера.\nconst input = $('" + TRIG + "').first().json || {};"
  );
}

// --- 6. разводка ---
wf.connections[TRIG] = { main: [[{ node: 'Поиск: бюджет', type: 'main', index: 0 }]] };
wf.connections['Поиск: бюджет'] = { main: [[{ node: 'Поиск: можно?', type: 'main', index: 0 }]] };
wf.connections['Поиск: можно?'] = { main: [[{ node: 'Поиск: в пределах?', type: 'main', index: 0 }]] };
wf.connections['Поиск: в пределах?'] = {
  main: [
    [{ node: 'Собрать запрос', type: 'main', index: 0 }],
    [{ node: 'Поиск: лимит исчерпан', type: 'main', index: 0 }],
  ],
};

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка фактом ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const s = w.nodes.find((n) => n.name === 'Claude Search');
if (s.maxTries !== 2) fail('попытки не выставлены');
if (s.parameters.options.timeout !== 120000) fail('таймаут не выставлен');
if (w.settings.executionTimeout !== 360) fail('лимит времени подворкфлоу не выставлен');
if (!w.nodes.find((n) => n.name === 'Поиск: бюджет')) fail('бюджет не вставлен');
w.nodes.filter((n) => n.type === 'n8n-nodes-base.code').forEach((n) => new Function(n.parameters.jsCode));
if (w.nodes.find((n) => n.name === 'Собрать запрос').parameters.jsCode.indexOf(TRIG) === -1) fail('сборка запроса не переведена на триггер');
if (!w.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger').parameters.workflowInputs.values.some((v) => v.name === 'msg_key')) fail('вход msg_key не добавлен');
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| попыток', s.maxTries, '| таймаут', s.parameters.options.timeout / 1000, 'с | лимит подворкфлоу', w.settings.executionTimeout, 'с | бюджет', LIMIT);
