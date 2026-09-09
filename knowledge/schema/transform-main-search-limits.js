/**
 * Главный workflow: ключ сообщения для бюджета поиска + индикатор «печатает».
 *
 * 1. Инструменту web_search передаём msg_key — идентификатор сообщения клиента.
 *    Без него бюджет «не более 3 поисков на сообщение» считать не по чему.
 * 2. Индикатор набора включаем ОТДЕЛЬНОЙ ВЕТВЬЮ от Build Profile Context.
 *    Это принципиально: узел HTTP заменяет item, и если поставить его в основную
 *    цепочку перед агентом, у агента пропадёт message.text — ровно так 01.08 лёг голос.
 *    Параллельная ветвь исполняется независимо и данных основного пути не касается.
 *
 * Прогон:  node schema/transform-main-search-limits.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-search-limits.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

// --- 1. msg_key в инструмент поиска ---
const tool = byName('Web Search') || fail('нет узла Web Search');
const wi = tool.parameters.workflowInputs || fail('у инструмента нет workflowInputs');
wi.value = wi.value || {};
wi.value.msg_key = "={{ String($('Normalize').first().json.message.message_id || '') }}";
wi.schema = wi.schema || [];
if (!wi.schema.some((s) => s.id === 'msg_key')) {
  wi.schema.push({
    id: 'msg_key', displayName: 'msg_key', required: false,
    defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string',
  });
}

// --- 2. индикатор «печатает» отдельной ветвью ---
if (!byName('Печатает')) {
  wf.nodes.push({
    parameters: {
      method: 'POST',
      url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendChatAction",
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" },
          { name: 'action', value: 'typing' },
        ],
      },
      options: { timeout: 10000 },
    },
    id: 'm-typing-0000-4000-8000-000000000001',
    name: 'Печатает',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position: [200, 620],
    onError: 'continueRegularOutput',
  });
}

const bpc = byName('Build Profile Context') || fail('нет Build Profile Context');
const c = wf.connections[bpc.name] || fail('у Build Profile Context нет связей');
const branch = c.main[0] || [];
if (!branch.some((x) => x.node === 'Печатает')) {
  branch.push({ node: 'Печатает', type: 'main', index: 0 });
}
c.main[0] = branch;

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const t = w.nodes.find((n) => n.name === 'Web Search');
if (!t.parameters.workflowInputs.value.msg_key) fail('msg_key не передаётся');
if (!w.nodes.find((n) => n.name === 'Печатает')) fail('индикатор не добавлен');
const outs = w.connections['Build Profile Context'].main[0].map((x) => x.node);
if (!outs.includes('Печатает')) fail('индикатор не подключён');
if (outs.length < 2) fail('основная ветвь потеряна — она должна остаться рядом с индикатором');
console.log('OK ->', OUT, '| из Build Profile Context ->', outs.join(' + '));
