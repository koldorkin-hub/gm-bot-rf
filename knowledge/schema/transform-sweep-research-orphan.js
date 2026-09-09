// Свип-сторож зависших разборов: если процесс main убит (рестарт/краш) и running осиротел,
// клиент молча заперт, потом протухает — но НЕ УЗНАЁТ, что бот снова готов.
// Добавляем в PhotoBatchSweep ветку: найти running старше 25 мин (таймаут цикла 25 мин → точно мёртв),
// атомарно удалить (DELETE ... RETURNING — уведомим каждого ровно раз) и написать клиенту, что бот готов.
// Запуск в контейнере: node transform-sweep-research-orphan.js <pbs_in> <main_template> <out>
const fs = require('fs');
const [,, inp, tmplPath, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const tdoc = JSON.parse(fs.readFileSync(tmplPath, 'utf8'));
const tw = Array.isArray(tdoc) ? tdoc[0] : tdoc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Research: сироты']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

// 1) PG: атомарно снять осиротевший running + вернуть кого будить (с токеном)
byName['Research: сироты'] = {
  parameters: { operation: 'executeQuery',
    query:
      "WITH dead AS (\n" +
      "  DELETE FROM research_state\n" +
      "  WHERE stage='running' AND started_at < now() - interval '25 minutes'\n" +
      "  RETURNING bot_id, user_id, chat_id, topic\n" +
      ")\n" +
      "SELECT d.chat_id, d.topic, c.bot_token\n" +
      "FROM dead d JOIN clients c ON c.bot_id = d.bot_id\n" +
      "WHERE d.chat_id IS NOT NULL;",
    options: {} },
  id: 'ea000000-0000-4000-8000-000000000001', name: 'Research: сироты',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-40, 220], credentials: PG
};

// 2) httpRequest: написать клиенту, что бот снова готов (клон рабочего sendMessage из main)
const send = JSON.parse(JSON.stringify(tw.nodes.find(n => n.name === 'Голос не распознан')));
send.id = 'ea000000-0000-4000-8000-000000000002';
send.name = 'Research: буди клиента';
send.position = [180, 220];
send.parameters.url = '=https://api.telegram.org/bot{{ $json.bot_token }}/sendMessage';
const bp = send.parameters.bodyParameters.parameters;
bp.find(p => p.name === 'chat_id').value = '={{ $json.chat_id }}';
bp.find(p => p.name === 'text').value =
  '=🟢 Я снова в строю. Прошлый разбор по теме «{{ $json.topic }}» прервался из-за технической заминки на моей стороне — попытка не засчитана. Пришли запрос ещё раз (/research), всё готово.';
send.onError = 'continueRegularOutput';
byName['Research: буди клиента'] = send;

wf.nodes.push(byName['Research: сироты'], byName['Research: буди клиента']);

// перевязка: расписание веером → существующая ветка + новая
const trig = wf.nodes.find(n => /scheduleTrigger/i.test(n.type)).name; // 'Каждые 30с'
const cur = (conns[trig] && conns[trig].main && conns[trig].main[0]) ? conns[trig].main[0] : [];
conns[trig] = { main: [ cur.concat([{ node: 'Research: сироты', type: 'main', index: 0 }]) ] };
conns['Research: сироты'] = { main: [[{ node: 'Research: буди клиента', type: 'main', index: 0 }]] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK orphan-sweep: ' + trig + ' → [' + conns[trig].main[0].map(x => x.node).join(', ') + ']');
