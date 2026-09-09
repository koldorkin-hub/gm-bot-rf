#!/usr/bin/env node
/*
 * GetResearchRep01: при НЕСКОЛЬКИХ подходящих разборах — не отдавать «лучший» молча,
 * а вернуть агенту список кандидатов на выбор клиента (дата + тема); выдача — после
 * подтверждения (повторный вызов с уточнёнными словами). Однозначное совпадение или
 * пустой query — отдаётся сразу, как раньше.
 * Изменения: query «Найти» + matched_cnt/matched_list; новый IF «Однозначно?» и Code
 * «Ответ: выбор»; переводка Найден?[да] → Однозначно?.
 * Идемпотентно (маркер: matched_cnt). Запуск: node transform-grr-choice.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/grr-w2.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const find = byName['Найти']; if (!find) throw new Error('нет узла Найти');
if (find.parameters.query.includes('matched_cnt')) { console.log('уже применено — пропуск'); process.exit(0); }
const cond = byName['Найден?']; if (!cond) throw new Error('нет Найден?');
const struct = byName['Есть структура?']; if (!struct) throw new Error('нет Есть структура?');

const anchor = "AS on_date\nFROM scored";
if (!find.parameters.query.includes(anchor)) throw new Error('якорь запроса Найти не найден');
find.parameters.query = find.parameters.query.replace(anchor,
`AS on_date,
  (SELECT count(*) FROM scored s2 WHERE s2.score > 0) AS matched_cnt,
  (SELECT string_agg(to_char(s3.created_at,'YYYY-MM-DD')||' — '||s3.topic, E'\\n' ORDER BY s3.created_at DESC) FROM scored s3 WHERE s3.score > 0) AS matched_list
FROM scored`);

const ifNode = {
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{
        id: 'g3000000-0000-4000-8000-000000000001-c',
        leftValue: "={{ Number($json.matched_cnt || 0) <= 1 }}",
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true }
      }],
      combinator: 'and'
    },
    options: {}
  },
  id: 'g3000000-0000-4000-8000-000000000001',
  name: 'Однозначно?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [struct.position[0] - 200, struct.position[1] - 140]
};
const choiceNode = {
  parameters: {
    jsCode: `const j = $input.first().json || {};
const list = String(j.matched_list || '').trim();
return [{ json: { response: 'По запросу подходят НЕСКОЛЬКО сохранённых разборов:\\n' + list + '\\nПокажи клиенту этот список (дата и тема) человеческим языком и спроси, какой прислать. Когда клиент выберет — вызови get_research_report ещё раз со словами выбранной темы.' } }];`
  },
  id: 'g3000000-0000-4000-8000-000000000002',
  name: 'Ответ: выбор',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [struct.position[0] - 200, struct.position[1] - 280]
};
wf.nodes.push(ifNode, choiceNode);

// Найден?[да] шёл в «Есть структура?» → теперь в «Однозначно?»
const outs = wf.connections['Найден?'].main;
if (!outs || !outs[0]) throw new Error('нет выхода Найден?[да]');
outs[0] = [{ node: 'Однозначно?', type: 'main', index: 0 }];
wf.connections['Однозначно?'] = { main: [
  [{ node: 'Есть структура?', type: 'main', index: 0 }],
  [{ node: 'Ответ: выбор', type: 'main', index: 0 }]
] };

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: GetResearchRep01 — выбор при нескольких кандидатах');
