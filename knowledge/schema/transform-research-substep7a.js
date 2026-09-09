// Трансформ ResearchTool0001 под 7a: сохранение отчёта после Проверки PDF, без разрыва возврата.
// Проверка PDF -> Сохранить отчёт (Postgres, onError continue) -> Вернуть отчёт (Code: json+binary из Проверки PDF).
// Запуск: node transform-research-substep7a.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }

ensure({
  parameters: {
    operation: 'executeQuery',
    query: "INSERT INTO research_report (bot_id,user_id,topic,summary,report_text,sources) VALUES ($1,$2,$3,$4,$5,$6::jsonb);",
    options: { queryReplacement: "={{ [$('Собрать отчёт').first().json.bot_id, Number(String($('Собрать отчёт').first().json.session_id).split(':')[1]), ($('Собрать отчёт').first().json.topic_ru || $('Собрать отчёт').first().json.topic), $('Собрать отчёт').first().json.summary_for_chat, $('Собрать отчёт').first().json.report_text, JSON.stringify($('Собрать отчёт').first().json.sources || [])] }}" }
  },
  id: 'g1000000-0000-4000-8000-000000000001',
  name: 'Сохранить отчёт',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
  position: [2440, -560],
  credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } },
  onError: 'continueRegularOutput'
});

ensure({
  parameters: {
    jsCode: "return [{ json: $('Проверка PDF').first().json, binary: $('Проверка PDF').first().binary }];"
  },
  id: 'g1000000-0000-4000-8000-000000000002',
  name: 'Вернуть отчёт',
  type: 'n8n-nodes-base.code', typeVersion: 2,
  position: [2660, -560]
});

conns['Проверка PDF'] = { main: [[{ node: 'Сохранить отчёт', type: 'main', index: 0 }]] };
conns['Сохранить отчёт'] = { main: [[{ node: 'Вернуть отчёт', type: 'main', index: 0 }]] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', save=' + !!byName['Сохранить отчёт'] + ', final=' + !!byName['Вернуть отчёт']);
