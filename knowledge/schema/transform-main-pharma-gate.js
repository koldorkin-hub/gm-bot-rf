// Часть 1, шаг 1.3 (main): обработка фарма-отказа research.
// После «Research: цикл»[0]: если refused_pharma → сообщение «к врачу» + возврат попытки; иначе → саммари.
// Узлы отправки/возврата КЛОНИРУЮ из существующих (Research: сбой / вернуть попытку) — механика идентична.
// Идемпотентно (признак 'Research: фарма-блок?'). Запуск: node transform-main-pharma-gate.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Research: фарма-блок?']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }

const clone = o => JSON.parse(JSON.stringify(o));
const cikl = byName['Research: цикл'].position || [0, 0];

// IF: фарма-блок?
wf.nodes.push({
  parameters: {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'fb-1', leftValue: '={{ $json.refused_pharma === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and' },
    options: {}
  },
  id: 'e5000000-0000-4000-8000-000000000001', name: 'Research: фарма-блок?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
  position: [cikl[0] + 200, cikl[1] - 160]
});

// «возврат фарма» — клон «Research: вернуть попытку» (идёт ПЕРВЫМ: возврат надёжнее доставки)
const refund = clone(byName['Research: вернуть попытку']);
refund.id = 'e5000000-0000-4000-8000-000000000003';
refund.name = 'Research: возврат фарма';
refund.position = [cikl[0] + 420, cikl[1] - 260];
refund.onError = 'continueRegularOutput'; // сбой возврата не должен глотать сообщение клиенту
wf.nodes.push(refund);

// «к врачу» — клон «Research: сбой», меняем текст/id/имя
const kvrachu = clone(byName['Research: сбой']);
kvrachu.id = 'e5000000-0000-4000-8000-000000000002';
kvrachu.name = 'Research: к врачу';
kvrachu.position = [cikl[0] + 640, cikl[1] - 260];
kvrachu.onError = 'continueRegularOutput'; // сбой доставки не роняет выполнение (возврат уже сделан)
const bp = kvrachu.parameters.bodyParameters.parameters;
const txt = bp.find(p => p.name === 'text');
if (!txt) throw new Error('в клоне сбоя нет параметра text');
txt.value = 'Доказательные разборы по рецептурным и гормональным препаратам, стероидам и дозировкам я не делаю — это вне компетенции фитнес-сервиса, такие вопросы решаются с врачом. Попытка не засчитана. Могу собрать разбор по другой теме: тренировки, техника, питание, восстановление, добавки общего плана.';
wf.nodes.push(kvrachu);

// Перевязка: цикл[0] → фарма-блок?; сохраняем цикл[1] (ошибка).
// Порядок на блоке: возврат попытки → сообщение клиенту (возврат раньше доставки).
const ciklMain = conns['Research: цикл'].main;
ciklMain[0] = [{ node: 'Research: фарма-блок?', type: 'main', index: 0 }];
conns['Research: фарма-блок?'] = { main: [ [{ node: 'Research: возврат фарма', type: 'main', index: 0 }], [{ node: 'Research: саммари', type: 'main', index: 0 }] ] };
conns['Research: возврат фарма'] = { main: [[{ node: 'Research: к врачу', type: 'main', index: 0 }]] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK main pharma-gate: узлов=' + wf.nodes.length + ', цикл[0]→' + ciklMain[0][0].node);
