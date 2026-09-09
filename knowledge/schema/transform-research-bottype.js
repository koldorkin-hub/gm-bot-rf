// Миграция ResearchTool0001 с owner_mode на bot_type (единый источник правды).
// is_owner = bot_type==='owner' (привилегии владельца в research: безлимит/owner-PDF/practical).
// pharma_open = bot_type in (owner,trusted) — понадобится для фарма-гейта (шаг 1.3).
// Строгие замены с проверкой числа совпадений. Запуск: node transform-research-bottype.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const report = [];
function repl(nodeName, getter, setter, find, replace, expectMin) {
  const cur = getter(byName[nodeName]);
  const n = (cur.split(find).length - 1);
  if (n < (expectMin === undefined ? 1 : expectMin)) { throw new Error('НЕ найдено «' + find.slice(0, 40) + '…» в [' + nodeName + '] (найдено ' + n + ')'); }
  setter(byName[nodeName], cur.split(find).join(replace));
  report.push(nodeName + ': ×' + n);
}
const js = n => n.parameters.jsCode;
const setJs = (n, v) => { n.parameters.jsCode = v; };

// 1. Вход триггера owner_mode(boolean) -> bot_type(string)
const vals = byName['When Executed by Another Workflow'].parameters.workflowInputs.values;
const om = vals.find(v => v.name === 'owner_mode');
if (om) { om.name = 'bot_type'; om.type = 'string'; report.push('trigger input: owner_mode->bot_type'); }
else if (!vals.find(v => v.name === 'bot_type')) { vals.push({ name: 'bot_type', type: 'string' }); report.push('trigger input: +bot_type'); }

// 2. Инициализация: вычисление флагов из bot_type
repl('Инициализация', js, setJs,
  "const ownerMode = (inp.owner_mode === true || inp.owner_mode === 'true');",
  "const bot_type = String(inp.bot_type || 'client');\nconst isOwner = bot_type === 'owner';\nconst pharmaOpen = (bot_type === 'owner' || bot_type === 'trusted');");
repl('Инициализация', js, setJs,
  "owner_mode: ownerMode,",
  "is_owner: isOwner,\n    pharma_open: pharmaOpen,\n    bot_type: bot_type,");
repl('Инициализация', js, setJs, "legal_prompt: ownerMode", "legal_prompt: isOwner");

// 3. Downstream: owner_mode -> is_owner
repl('Тело синтеза', js, setJs, "init.owner_mode", "init.is_owner");
repl('Собрать отчёт', js, setJs, "owner_mode: init.owner_mode", "is_owner: init.is_owner");
repl('HTML отчёта', js, setJs, "d.owner_mode", "d.is_owner", 2);
repl('Проверка PDF', js, setJs, "d.owner_mode", "d.is_owner");

// 4. Сохранить отчёт: report_json field owner_mode -> is_owner
const qrGet = n => n.parameters.options.queryReplacement;
const qrSet = (n, v) => { n.parameters.options.queryReplacement = v; };
repl('Сохранить отчёт', qrGet, qrSet,
  "owner_mode:$('Собрать отчёт').first().json.owner_mode",
  "is_owner:$('Собрать отчёт').first().json.is_owner");

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research bot_type:\n  ' + report.join('\n  '));
