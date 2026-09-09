// Фикс A: пустой /research → НЕ запускать разбор (не списывать лимит, не идти в цикл), а спросить тему.
// Перед «Research: списать лимит» ставим гейт «Research: тема?».
// Идемпотентно (признак 'Research: тема?'). Запуск: node transform-main-research-topic.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Research: тема?']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }

// IF: есть ли непустая тема после /research
byName['Research: тема?'] = {
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: 'rt-c', leftValue: "={{ ($('Normalize').first().json.message.text || '').replace(/^\\/research/i,'').trim().length > 0 }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
  id: 'cd000000-0000-4000-8000-000000000001', name: 'Research: тема?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [-260, 900]
};
// Просьба указать тему (клон sendMessage)
const ask = JSON.parse(JSON.stringify(byName['Голос не распознан']));
ask.id = 'cd000000-0000-4000-8000-000000000002'; ask.name = 'Research: спроси тему'; ask.position = [-40, 1020];
ask.parameters.bodyParameters.parameters.find(p => p.name === 'text').value =
  '🔍 Что разобрать? Напиши тему сразу после команды — и лучше с целью, для чего тебе это. Например:\n• /research креатин для набора массы\n• /research магний и сон\n• /research добавки для энергии\nТак я подберу именно то, что нужно тебе.';
byName['Research: спроси тему'] = ask;
wf.nodes.push(byName['Research: тема?'], ask);

// перевязка: Switch[research] (main[0]) был → Research: списать лимит; теперь → Research: тема?
conns['Switch'].main[0] = [{ node: 'Research: тема?', type: 'main', index: 0 }];
conns['Research: тема?'] = { main: [ [{ node: 'Research: списать лимит', type: 'main', index: 0 }], [{ node: 'Research: спроси тему', type: 'main', index: 0 }] ] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research-topic: Switch[research]→' + conns['Switch'].main[0][0].node);
