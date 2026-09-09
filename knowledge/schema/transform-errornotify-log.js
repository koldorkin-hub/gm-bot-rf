/**
 * ErrorNotify00001: писать каждый сбой в таблицу ops_error.
 *
 * Зачем: исполнения n8n лежат в SQLite контейнера, из Postgres их не видно,
 * поэтому диагностика не могла ответить «что падало за сутки». Теперь история
 * сбоёв копится в базе, SelfDiag01 её читает, DiagWatch01 чистит старше 30 дней.
 *
 * Узел вешается ПАРАЛЛЕЛЬНО текстовой ветке, а не в цепочку: узел Postgres
 * заменяет item результатом запроса, и сборщик текста тревоги остался бы без данных
 * (грабля потока данных). Плюс onError=continue — падение записи в журнал
 * не должно съесть саму тревогу владельцу.
 *
 * Прогон:  node schema/transform-errornotify-log.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-errornotify-log.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const trigger = byName('Error Trigger') || fail('нет узла Error Trigger');
const textNode = byName('Собрать безопасный текст') || fail('нет узла сборки текста');
if (byName('Журнал сбоя')) fail('узел Журнал сбоя уже есть');

wf.nodes.push({
  parameters: {
    operation: 'executeQuery',
    query: 'INSERT INTO ops_error (workflow_name, node_name, message) VALUES ($1, $2, $3);',
    options: {
      queryReplacement:
        "={{ [ ($json.workflow && $json.workflow.name) || '?', " +
        "($json.execution && $json.execution.lastNodeExecuted) || '?', " +
        "String(($json.execution && $json.execution.error && $json.execution.error.message) || 'без описания').slice(0,500) ] }}",
    },
  },
  id: 'e1000000-0000-4000-8000-000000000004',
  name: 'Журнал сбоя',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [220, 200],
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
  onError: 'continueRegularOutput',
});

wf.connections[trigger.name] = {
  main: [[
    { node: textNode.name, type: 'main', index: 0 },
    { node: 'Журнал сбоя', type: 'main', index: 0 },
  ]],
};

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

const check = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(check) ? check[0] : check;
if (!w.nodes.find((n) => n.name === 'Журнал сбоя')) fail('узел не вставился');
const outs = w.connections['Error Trigger'].main[0].map((c) => c.node);
if (outs.length !== 2) fail('ветка тревоги не раздвоилась: ' + JSON.stringify(outs));
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| из Error Trigger:', outs.join(' + '));
