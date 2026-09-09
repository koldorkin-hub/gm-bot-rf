#!/usr/bin/env node
/*
 * main: регистрирует инструмент lookup_food (узел toolWorkflow → FoodRefTool0001) +
 * ai_tool к AI Agent; правит systemMessage — при записи еды и вопросах о калориях/БЖУ
 * СНАЧАЛА искать точные значения в справочнике (lookup_food), потом пересчитывать порцию.
 * Клонирует структуру узла get_progress (тот же тип toolWorkflow с workflowInputs).
 * Идемпотентно (маркер: узел 'lookup_food'). Запуск: node transform-main-add-foodref-tool.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');
const tmpl = byName['get_progress']; if (!tmpl) throw new Error('нет get_progress (шаблон toolWorkflow)');

if (!byName['lookup_food']) {
  const n = JSON.parse(JSON.stringify(tmpl));
  n.name = 'lookup_food';
  n.id = 'foodreftool01';
  n.position = [ (tmpl.position ? tmpl.position[0] : 0) + 40, (tmpl.position ? tmpl.position[1] : 0) + 200 ];
  n.parameters = {
    name: 'lookup_food',
    description: 'Возвращает ТОЧНЫЕ БЖУ (ккал, белки, жиры, углеводы на 100 г) продукта из справочника. Вызывай ПЕРЕД тем как записать приём пищи (log_food) или ответить «сколько калорий/белка в X» — для КАЖДОГО значимого продукта. Значения бери из ответа и пересчитывай на вес порции через calculate, не оценивай на глаз. query — название продукта по-русски (напр. «куриная грудка», «гречка», «банан»). Если продукта нет в справочнике — так и ответит, тогда оцени сам и честно предупреди о приблизительности.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'FoodRefTool0001', cachedResultName: 'Инструмент — Справочник БЖУ' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: { query: "={{ $fromAI('query', 'название продукта для поиска БЖУ, по-русски (напр. куриная грудка, гречка, банан)', 'string') }}" },
      matchingColumns: [],
      schema: [ { id: 'query', displayName: 'query', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' } ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  };
  delete n.credentials;
  wf.nodes.push(n);
  if (!wf.connections['lookup_food']) wf.connections['lookup_food'] = {};
  wf.connections['lookup_food'].ai_tool = [ [ { node: 'AI Agent', type: 'ai_tool', index: 0 } ] ];
  console.log('OK: узел lookup_food + ai_tool → AI Agent');
} else { console.log('lookup_food уже есть — пропуск узла'); }

// systemMessage
let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');
if (!sm.includes('lookup_food')) {
  const a1 = 'Когда клиент рассказал о приёме пищи — вызови log_food (description обязательно; kcal и БЖУ оцени сам по составу и весу порции).';
  const a1r = 'Когда клиент рассказал о приёме пищи — СНАЧАЛА для каждого значимого продукта вызови lookup_food (точные БЖУ на 100 г из справочника) и пересчитай на вес порции через calculate; чего в справочнике нет — оцени по составу и честно пометь как приблизительное. Затем вызови log_food (description обязательно; kcal и БЖУ — из справочника/расчёта, не с потолка).';
  if (!sm.includes(a1)) throw new Error('якорь log_food не найден в systemMessage');
  sm = sm.replace(a1, a1r);

  // recipes: питательность ингредиентов из справочника
  const a2 = 'придумай рецепт, для каждого ингредиента оцени вес и питательность (kcal, protein_g, fat_g, carb_g на этот объём)';
  if (sm.includes(a2)) {
    sm = sm.replace(a2, 'придумай рецепт, для каждого ингредиента оцени вес и питательность (kcal, protein_g, fat_g, carb_g на этот объём — БЖУ бери из lookup_food, где продукт есть)');
  }
  ai.parameters.options.systemMessage = sm;
  console.log('OK: systemMessage — lookup_food в трекинге еды и рецептах');
} else { console.log('systemMessage уже с lookup_food — пропуск'); }

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('DONE');
