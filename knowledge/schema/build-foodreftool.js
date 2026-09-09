#!/usr/bin/env node
/*
 * Собирает подворкфлоу FoodRefTool0001 (инструмент lookup_food): триггер(query) →
 * «Параметры» (по словам строит ILIKE-SQL со скорингом) → «Данные» (Postgres) →
 * «Ответ агенту» (форматирует БЖУ на 100 г + инструкция пересчитать порцию через calculate).
 * Пишет /home/node/foodref.json для import:workflow. Запуск: node build-foodreftool.js <out>
 */
const fs = require('fs');
const out = process.argv[2] || '/home/node/foodref.json';

const paramsCode = [
  "const q = String($input.first().json.query || '').toLowerCase().trim();",
  "const words = q.split(/[^a-zA-Zа-яёА-ЯЁ0-9]+/).filter(w => w.length >= 3).slice(0, 6);",
  "if (!words.length) {",
  "  return [{ json: { query: 'SELECT name, kcal, protein_g, fat_g, carb_g, basis, note, 0 AS score FROM food_reference WHERE false', params: [], words: [], raw: q } }];",
  "}",
  "const likeConds = words.map((w,i) => `search_text ILIKE '%'||$${i+1}||'%'`);",
  "const scoreExpr = words.map((w,i) => `(search_text ILIKE '%'||$${i+1}||'%')::int`).join('+');",
  "const query = `SELECT name, kcal, protein_g, fat_g, carb_g, basis, note, (${scoreExpr}) AS score FROM food_reference WHERE ${likeConds.join(' OR ')} ORDER BY score DESC, length(name) ASC LIMIT 6`;",
  "return [{ json: { query, params: words, words, raw: q } }];"
].join("\n");

const respCode = [
  "const rows = $input.all().map(i => i.json).filter(r => r && r.name);",
  "const p = $('Параметры').first().json;",
  "if (!p.words || !p.words.length) return [{ json: { response: 'Пустой запрос — уточни, какой продукт искать в справочнике БЖУ.' } }];",
  "if (!rows.length) return [{ json: { response: 'В справочнике БЖУ нет совпадения для «' + p.raw + '». Оцени БЖУ по составу и весу порции сам и честно предупреди клиента, что значения приблизительные.' } }];",
  "const fmt = r => r.name + ': ' + r.kcal + ' ккал, Б ' + r.protein_g + ' / Ж ' + r.fat_g + ' / У ' + r.carb_g + ' г на ' + r.basis + (r.note ? ' (' + r.note + ')' : '');",
  "const best = rows.slice(0, 5).map(fmt).join('\\n');",
  "return [{ json: { response: 'Справочник БЖУ (значения на 100 г, если не указано иное) — бери ИМЕННО эти цифры и пересчитай на реальный вес порции через calculate, не оценивай на глаз:\\n' + best } }];"
].join("\n");

const wf = {
  id: "FoodRefTool0001",
  name: "Инструмент — Справочник БЖУ",
  active: true,
  nodes: [
    {
      parameters: { inputSource: "workflowInputs", workflowInputs: { values: [ { name: "query", type: "string" } ] } },
      id: "fr-0000-0000-0000-000000000001",
      name: "When Executed by Another Workflow",
      type: "n8n-nodes-base.executeWorkflowTrigger",
      typeVersion: 1.2,
      position: [-600, 0]
    },
    {
      parameters: { jsCode: paramsCode },
      id: "fr-0000-0000-0000-000000000002",
      name: "Параметры",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-360, 0]
    },
    {
      parameters: { operation: "executeQuery", query: "={{ $json.query }}", options: { queryReplacement: "={{ $json.params }}" } },
      id: "fr-0000-0000-0000-000000000003",
      name: "Данные",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.6,
      position: [-120, 0],
      alwaysOutputData: true,
      credentials: { postgres: { id: "LXIg26xUOtUdy7DJ", name: "Postgres account" } }
    },
    {
      parameters: { jsCode: respCode },
      id: "fr-0000-0000-0000-000000000004",
      name: "Ответ агенту",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [120, 0]
    }
  ],
  connections: {
    "When Executed by Another Workflow": { main: [ [ { node: "Параметры", type: "main", index: 0 } ] ] },
    "Параметры": { main: [ [ { node: "Данные", type: "main", index: 0 } ] ] },
    "Данные": { main: [ [ { node: "Ответ агенту", type: "main", index: 0 } ] ] }
  },
  settings: { executionOrder: "v1", errorWorkflow: "ErrorNotify00001" }
};

fs.writeFileSync(out, JSON.stringify([wf], null, 2));
console.log("OK: FoodRefTool0001 записан в " + out);
