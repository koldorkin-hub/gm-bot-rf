// Трансформ ResearchTool0001: узел «Сохранить отчёт» дополнительно сохраняет report_json
// (структуру для пересборки PDF из памяти). Идемпотентно (признак 'report_json' в query).
// Запуск: node transform-research-savejson.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const node = wf.nodes.find(n => n.name === 'Сохранить отчёт');
if (!node) { console.error('НЕ найден узел «Сохранить отчёт»'); process.exit(1); }

if (!/report_json/.test(node.parameters.query)) {
  node.parameters.query = 'INSERT INTO research_report (bot_id,user_id,topic,summary,report_text,sources,report_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb);';
  const cs = "$('Собрать отчёт').first().json";
  node.parameters.options = node.parameters.options || {};
  node.parameters.options.queryReplacement =
    '={{ [' +
      cs + '.bot_id, ' +
      'Number(String(' + cs + '.session_id).split(\':\')[1]), ' +
      '(' + cs + '.topic_ru || ' + cs + '.topic), ' +
      cs + '.summary_for_chat, ' +
      cs + '.report_text, ' +
      'JSON.stringify(' + cs + '.sources || []), ' +
      'JSON.stringify({topic:' + cs + '.topic, topic_ru:' + cs + '.topic_ru, is_pharma:' + cs + '.is_pharma, owner_mode:' + cs + '.owner_mode, report:' + cs + '.report, sources:' + cs + '.sources, sources_count:' + cs + '.sources_count})' +
    '] }}';
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: report_json в query=' + /report_json/.test(node.parameters.query));
