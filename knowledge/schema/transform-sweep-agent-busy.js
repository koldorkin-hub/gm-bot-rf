/**
 * PhotoBatchSweep1: сторож зависших ответов агента.
 *
 * Повод (03.09.2026): исполнение с веб-поиском висело больше 10 минут и умерло бы
 * по таймауту молча — отменённое по таймауту исполнение не запускает ветку отказа,
 * поэтому клиент не получает ничего, а владелец не получает тревоги.
 *
 * Порог 18 минут: худший честный случай при новых лимитах поиска — около 12 минут
 * (3 вызова × 2 попытки × 120 с плюс работа агента). Режем с запасом, чтобы не
 * оборвать правильно идущий долгий ответ.
 *
 * Тревогу владельцу шлём НЕ новым каналом, а записью в ops_error: её уже читает
 * /diag и сторож всплеска ошибок (3+ за час будят владельца сами).
 *
 * Ветвь добавляется ПАРАЛЛЕЛЬНО существующим — так устроен этот свип, и так
 * ветви не мешают друг другу.
 *
 * Прогон:  node schema/transform-sweep-agent-busy.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-sweep-agent-busy.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

if (byName('Агент: сироты')) fail('уже вставлено');

const SQL = [
  'WITH stale AS (',
  '  DELETE FROM agent_busy',
  "   WHERE started_at < now() - interval '18 minutes'",
  '   RETURNING bot_id, user_id, chat_id, started_at',
  '),',
  'logged AS (',
  '  INSERT INTO ops_error (workflow_name, node_name, message)',
  "  SELECT 'ИИ Тренер - Telegram Bot', 'Агент: сироты',",
  "         'Ответ не уложился в 18 минут, клиенту отправлено извинение. bot=' || bot_id || ' user=' || user_id",
  '    FROM stale',
  ')',
  'SELECT s.bot_id, s.user_id, COALESCE(s.chat_id, s.user_id) AS chat_id, c.bot_token',
  '  FROM stale s JOIN clients c ON c.bot_id = s.bot_id;',
].join('\n');

wf.nodes.push({
  parameters: { operation: 'executeQuery', query: SQL, options: {} },
  id: 'sw-busy-0000-4000-8000-000000000001',
  name: 'Агент: сироты',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [-200, 340],
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
});

wf.nodes.push({
  parameters: {
    method: 'POST',
    url: '=https://api.telegram.org/bot{{ $json.bot_token }}/sendMessage',
    sendBody: true,
    bodyParameters: {
      parameters: [
        { name: 'chat_id', value: '={{ $json.chat_id }}' },
        {
          name: 'text',
          value: 'Прости, я слишком долго возился с этим вопросом и не уложился 😕 ' +
            'Попробуй спросить ещё раз — лучше покороче или по частям, так я отвечу быстрее.',
        },
      ],
    },
    options: { timeout: 20000 },
  },
  id: 'sw-busy-0000-4000-8000-000000000002',
  name: 'Агент: не уложился',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.4,
  position: [20, 340],
  onError: 'continueRegularOutput',
});

const trig = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger') || fail('нет расписания');
const c = wf.connections[trig.name] || fail('у расписания нет связей');
const branch = c.main[0] || [];
const had = branch.length;
if (!branch.some((x) => x.node === 'Агент: сироты')) branch.push({ node: 'Агент: сироты', type: 'main', index: 0 });
c.main[0] = branch;
wf.connections['Агент: сироты'] = { main: [[{ node: 'Агент: не уложился', type: 'main', index: 0 }]] };

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const outs = w.connections[trig.name].main[0].map((x) => x.node);
if (outs.length !== had + 1) fail('прежние ветви свипа потеряны: ' + outs.join(', '));
if (!outs.includes('Агент: сироты')) fail('ветвь не подключена');
['Агент: сироты', 'Агент: не уложился'].forEach((n) => { if (!w.nodes.find((x) => x.name === n)) fail('нет узла ' + n); });
console.log('OK ->', OUT, '| ветви свипа:', outs.join(' + '));
