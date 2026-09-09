/**
 * WebSearchTool001: предупредить клиента, что бот ушёл искать.
 *
 * Повод: даже с лимитами ответ с веб-поиском занимает от полуминуты до нескольких минут,
 * а индикатор «печатает» в Telegram живёт ~5 секунд. Клиент видит тишину и решает,
 * что бот умер — ровно с этого начался разбор 03.09.
 *
 * Шлём один раз на сообщение — при ПЕРВОМ вызове поиска (n=1). Второй и третий заход
 * в рамках того же сообщения молчат, чтобы не превращать это в спам.
 * Режим /research не трогаем: у него своё «ушёл искать».
 *
 * Вставка безопасна: «Собрать запрос» после предыдущей правки читает вход у триггера,
 * а не у соседнего узла, поэтому HTTP-узел в цепочке ничего не ломает.
 *
 * Прогон:  node schema/transform-websearch-ack.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-websearch-ack.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const TRIG = 'When Executed by Another Workflow';

if (byName('Поиск: предупредить')) fail('уже вставлено');

// Первый ли это поиск в рамках сообщения
wf.nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
      combinator: 'and',
      conditions: [{
        id: 'wsa1',
        leftValue: '={{ $json.n }}',
        rightValue: 1,
        operator: { type: 'number', operation: 'equals' },
      }],
    },
    options: {},
  },
  id: 'ws-ack-0000-4000-8000-000000000001',
  name: 'Поиск: первый?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [160, -140],
});

// session_id имеет вид "bot:user"; в личных чатах chat_id совпадает с user_id.
wf.nodes.push({
  parameters: {
    operation: 'executeQuery',
    query: 'SELECT bot_token FROM clients WHERE bot_id = $1;',
    options: {
      queryReplacement: "={{ [ String($('" + TRIG + "').first().json.bot_id || '') ] }}",
    },
  },
  id: 'ws-ack-0000-4000-8000-000000000002',
  name: 'Поиск: токен',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [340, -220],
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
});

wf.nodes.push({
  parameters: {
    method: 'POST',
    url: '=https://api.telegram.org/bot{{ $json.bot_token }}/sendMessage',
    sendBody: true,
    bodyParameters: {
      parameters: [
        {
          name: 'chat_id',
          value: "={{ String($('" + TRIG + "').first().json.session_id || '').split(':')[1] }}",
        },
        { name: 'text', value: '🔎 Смотрю актуальные данные в интернете — это займёт до пары минут.' },
      ],
    },
    options: { timeout: 15000 },
  },
  id: 'ws-ack-0000-4000-8000-000000000003',
  name: 'Поиск: предупредить',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.4,
  position: [520, -220],
  onError: 'continueRegularOutput',
});

// Разводка: разрешённая ветвь -> проверка первого вызова -> [да] предупреждение -> сборка
const gate = wf.connections['Поиск: в пределах?'] || fail('нет узла-гейта бюджета');
gate.main[0] = [{ node: 'Поиск: первый?', type: 'main', index: 0 }];
wf.connections['Поиск: первый?'] = {
  main: [
    [{ node: 'Поиск: токен', type: 'main', index: 0 }],
    [{ node: 'Собрать запрос', type: 'main', index: 0 }],
  ],
};
wf.connections['Поиск: токен'] = { main: [[{ node: 'Поиск: предупредить', type: 'main', index: 0 }]] };
wf.connections['Поиск: предупредить'] = { main: [[{ node: 'Собрать запрос', type: 'main', index: 0 }]] };

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
['Поиск: первый?', 'Поиск: токен', 'Поиск: предупредить'].forEach((n) => {
  if (!w.nodes.find((x) => x.name === n)) fail('не вставлен ' + n);
});
const build = w.nodes.find((n) => n.name === 'Собрать запрос');
if (build.parameters.jsCode.indexOf(TRIG) === -1) fail('сборка запроса читает не триггер — вставка HTTP её сломает');
const names = w.nodes.map((n) => n.name);
const targets = [];
Object.values(w.connections).forEach((c) => (c.main || []).forEach((b) => (b || []).forEach((x) => targets.push(x.node))));
const missing = targets.filter((t) => !names.includes(t));
if (missing.length) fail('связи в никуда: ' + missing.join(', '));
console.log('OK ->', OUT, '| узлов', w.nodes.length);
