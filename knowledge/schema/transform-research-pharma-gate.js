// Часть 1, шаг 1.3 (research): фарма-гейт /research.
// После «Разобрать план»: если !pharma_open && is_pharma → research возвращает {refused_pharma:true},
// не запуская дорогой цикл. Иначе — как обычно. Заодно чистка устаревших комментариев owner_mode.
// Идемпотентно (признак 'Фарма-гейт'). Запуск: node transform-research-pharma-gate.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Фарма-гейт']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }

// Чистка устаревших комментариев owner_mode в Инициализация (косметика после миграции)
let ini = byName['Инициализация'].parameters.jsCode;
ini = ini.split('query/session_id/bot_id/owner_mode').join('query/session_id/bot_id/bot_type');
ini = ini.split('колонка clients.owner_mode').join('колонка clients.bot_type');
byName['Инициализация'].parameters.jsCode = ini;

const pos = (byName['Разобрать план'].position) || [0, 0];

wf.nodes.push({
  parameters: {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'pg-1', leftValue: "={{ $('Инициализация').first().json.pharma_open || !$json.is_pharma }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and' },
    options: {}
  },
  id: 'e4000000-0000-4000-8000-000000000001', name: 'Фарма-гейт', type: 'n8n-nodes-base.if', typeVersion: 2.2,
  position: [pos[0] + 200, pos[1]]
});
wf.nodes.push({
  parameters: { jsCode: "const p = $('Разобрать план').first().json || {};\nconst ini = $('Инициализация').first().json || {};\nreturn [{ json: { refused_pharma: true, topic_ru: (p.topic_ru || ''), session_id: ini.session_id, bot_id: ini.bot_id } }];" },
  id: 'e4000000-0000-4000-8000-000000000002', name: 'Фарма-отказ', type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [pos[0] + 200, pos[1] + 180]
});

// Перевязка: Разобрать план → Фарма-гейт; гейт[true]→Сбор доказательств, [false]→Фарма-отказ
conns['Разобрать план'] = { main: [[{ node: 'Фарма-гейт', type: 'main', index: 0 }]] };
conns['Фарма-гейт'] = { main: [ [{ node: 'Сбор доказательств', type: 'main', index: 0 }], [{ node: 'Фарма-отказ', type: 'main', index: 0 }] ] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research pharma-gate: узлов=' + wf.nodes.length);
