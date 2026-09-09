// Трансформ main: get_research_report теперь ОТПРАВЛЯЕТ PDF файлом (пересборка из памяти).
// Обновляет описание инструмента и правило в промпте (агент кратко подтверждает, не дублирует текст).
// Идемпотентно. Запуск: node transform-main-getresearch-v2.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;

// --- 1. Описание инструмента ---
const tool = nodes.find(n => (n.parameters && n.parameters.name === 'get_research_report') || n.name === 'get_research_report');
if (tool) {
  tool.parameters.description =
    'Достаёт ранее сохранённый доказательный разбор (/research) по теме и САМ ОТПРАВЛЯЕТ его клиенту готовым PDF-файлом (пересобирает из памяти, без нового поиска и без траты суточного лимита). Вызывай, когда клиент просит скинуть/напомнить/показать прошлый разбор по теме. query — ключевые слова темы (или пусто для последнего). После вызова НЕ пересказывай текст отчёта — файл уже ушёл клиенту, просто коротко подтверди.';
}

// --- 2. Правило в systemMessage ---
const agent = nodes.find(n => n.name === 'AI Agent');
let sm = agent.parameters.options.systemMessage;
const oldRe = /Когда клиент просит скинуть, напомнить или показать ПРОШЛЫЙ доказательный разбор[^\n]*/;
const newRule = 'Когда клиент просит скинуть, напомнить или показать ПРОШЛЫЙ доказательный разбор (/research) по теме — вызови get_research_report: он сам отправит клиенту готовый PDF-файл из памяти (новый /research не запускается, лимит и токены не тратятся). После вызова НЕ пересказывай текст отчёта — файл уже отправлен, кратко подтверди по-человечески. Новый /research — только если сохранённого нет или клиент явно просит свежий.';
if (oldRe.test(sm)) {
  sm = sm.replace(oldRe, newRule);
} else if (!sm.includes('он сам отправит клиенту готовый PDF-файл')) {
  sm = sm.replace('=== ПРОФИЛЬ КЛИЕНТА', newRule + '\n\n=== ПРОФИЛЬ КЛИЕНТА');
}
agent.parameters.options.systemMessage = sm;

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: tool desc=' + (tool ? tool.parameters.description.length : 'NOT FOUND') + ', rule=' + sm.includes('он сам отправит клиенту готовый PDF-файл'));
