// Трансформ основного workflow под подэтап 5 (Рецепты).
// Поверх текущего main. Идемпотентно.
// Запуск: node transform-main-substep5.js <in.json> <out.json>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const nodes = wf.nodes;
const conns = wf.connections;
const byName = {}; nodes.forEach(n => byName[n.name] = n);
function ensure(node) { if (!byName[node.name]) { nodes.push(node); byName[node.name] = node; } }
function sc(names) { return names.map(n => ({ id: n[0], displayName: n[0], required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: n[1] })); }
function tool(id, name, wfId, cachedName, desc, values, cols, pos) {
  ensure({
    parameters: { name, description: desc, source: 'database', workflowId: { __rl: true, mode: 'list', value: wfId, cachedResultName: cachedName }, workflowInputs: { mappingMode: 'defineBelow', value: values, matchingColumns: [], schema: sc(cols), attemptToConvertTypes: false, convertFieldsToString: false } },
    id, name, type: '@n8n/n8n-nodes-langchain.toolWorkflow', typeVersion: 2.1, position: pos
  });
  conns[name] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };
}
const B = "={{ $('Load Config').first().json.bot_id }}";
const U = "={{ $('Normalize').first().json.message.from.id }}";

tool('c3000000-0000-4000-8000-000000000070', 'find_recipes', 'FindRecipesTool01', 'Инструмент — Найти рецепт',
  'Ищет рецепт в сохранённой библиотеке клиента. Вызывай ПЕРВЫМ, когда клиент просит рецепт/меню/идею блюда — прежде чем придумывать новый. query — ключевое слово (блюдо, приём пищи, кухня) или пусто для всех. Возвращает список сохранённых рецептов с БЖУ на порцию.',
  { bot_id: B, user_id: U, query: "={{ $fromAI('query', 'ключевое слово для поиска рецепта или пусто', 'string') }}" },
  [['bot_id','string'],['user_id','number'],['query','string']], [1140, 1120]);

tool('c3000000-0000-4000-8000-000000000071', 'check_recipe_allergens', 'CheckAllergTool01', 'Инструмент — Проверка аллергенов',
  'ДЕТЕРМИНИРОВАННО проверяет ингредиенты рецепта против аллергий и непереносимостей клиента. Вызывай ОБЯЗАТЕЛЬНО перед тем, как предложить клиенту любой рецепт (и найденный, и придуманный). ingredients — JSON-массив названий ингредиентов. При БЛОКИРОВКЕ (аллергия) рецепт не предлагать, ингредиент заменить.',
  { bot_id: B, user_id: U, ingredients: "={{ $fromAI('ingredients', 'JSON-массив названий ингредиентов', 'string') }}" },
  [['bot_id','string'],['user_id','number'],['ingredients','string']], [1140, 1260]);

tool('c3000000-0000-4000-8000-000000000072', 'save_recipe', 'SaveRecipeTool01', 'Инструмент — Сохранить рецепт',
  'Сохраняет придуманный/подобранный рецепт в библиотеку клиента структурно. БЖУ на порцию считает КОД (сумма ингредиентов ÷ порции) — ты не считай. ingredients — JSON-массив объектов {item, amount, unit, kcal, protein_g, fat_g, carb_g}, где kcal/БЖУ — на указанный объём ингредиента (оцени сам). servings — число порций. tags — JSON {meal:[],cuisine:[],method:[]}. source=bot|client|found, status=saved|favorite. Дедуп по названию: повтор не создаётся. Возвращает БЖУ на порцию — показывай их клиенту.',
  { bot_id: B, user_id: U, title: "={{ $fromAI('title', 'название рецепта', 'string') }}", servings: "={{ $fromAI('servings', 'число порций', 'number') }}", prep_minutes: "={{ $fromAI('prep_minutes', 'время готовки, мин', 'number') }}", tags: "={{ $fromAI('tags', 'JSON тегов {meal,cuisine,method}', 'string') }}", source: "={{ $fromAI('source', 'bot|client|found', 'string') }}", status: "={{ $fromAI('status', 'saved|favorite', 'string') }}", ingredients: "={{ $fromAI('ingredients', 'JSON-массив {item,amount,unit,kcal,protein_g,fat_g,carb_g}', 'string') }}" },
  [['bot_id','string'],['user_id','number'],['title','string'],['servings','number'],['prep_minutes','number'],['tags','string'],['source','string'],['status','string'],['ingredients','string']], [1140, 1400]);

// systemMessage: блок РЕЦЕПТЫ
let sm = byName['AI Agent'].parameters.options.systemMessage;
if (!sm.includes('=== РЕЦЕПТЫ ===')) {
  const rec =
    "=== РЕЦЕПТЫ ===\n" +
    "Когда клиент просит рецепт, меню или идею блюда: (1) СНАЧАЛА вызови find_recipes — поиск в его библиотеке; не придумывай, пока не проверил сохранённое. (2) Если подходящий есть — проверь его ингредиенты через check_recipe_allergens и, если чисто, предложи его, не генерируя заново. (3) Если ничего нет — придумай рецепт, для каждого ингредиента оцени вес и питательность (kcal, protein_g, fat_g, carb_g на этот объём), вызови check_recipe_allergens по списку ингредиентов; при БЛОКИРОВКЕ замени ингредиент на безопасный. (4) Затем вызови save_recipe (ingredients с полями item, amount, unit, kcal, protein_g, fat_g, carb_g) — БЖУ на порцию посчитает КОД, сам не считай; показывай клиенту цифры из ответа save_recipe.\n\n";
  sm = sm.replace("=== ПРОФИЛЬ КЛИЕНТА", rec + "=== ПРОФИЛЬ КЛИЕНТА");
  byName['AI Agent'].parameters.options.systemMessage = sm;
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK: узлов=' + nodes.length + ', find=' + !!byName['find_recipes'] + ', check=' + !!byName['check_recipe_allergens'] + ', save=' + !!byName['save_recipe'] + ', sm=' + byName['AI Agent'].parameters.options.systemMessage.includes('=== РЕЦЕПТЫ ==='));
