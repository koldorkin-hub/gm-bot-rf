// Миграция main с owner_mode на bot_type. Load Config использует SELECT * — bot_type уже отдаётся.
// Правим: «Research: списать лимит» (SQL безлимита), «Research: цикл» (вход в подворкфлоу).
// Запуск: node transform-main-bottype.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const report = [];
function replOne(nodeName, obj, key, find, replace) {
  const cur = obj[key];
  if (cur.indexOf(find) === -1) throw new Error('НЕ найдено «' + find.slice(0, 40) + '…» в [' + nodeName + ']');
  obj[key] = cur.split(find).join(replace);
  report.push(nodeName + ': «' + find.slice(0, 30) + '…»');
}

// 1. Research: списать лимит — SQL owner_mode -> bot_type
const lim = byName['Research: списать лимит'].parameters;
replOne('Лимит SQL', lim, 'query', 'SELECT bot_id, research_daily_limit, owner_mode FROM clients', 'SELECT bot_id, research_daily_limit, bot_type FROM clients');
replOne('Лимит SQL', lim, 'query', 'WHERE NOT c.owner_mode', "WHERE c.bot_type <> 'owner'");
replOne('Лимит SQL', lim, 'query', 'WHERE c.owner_mode;', "WHERE c.bot_type = 'owner';");

// 2. Research: цикл — вход owner_mode -> bot_type
const wi = byName['Research: цикл'].parameters.workflowInputs.value;
if (!('owner_mode' in wi) && !('bot_type' in wi)) throw new Error('в Research: цикл нет ни owner_mode, ни bot_type');
delete wi.owner_mode;
wi.bot_type = "={{ $('Load Config').first().json.bot_type }}";
report.push('Research: цикл: owner_mode->bot_type');

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK main bot_type:\n  ' + report.join('\n  '));
