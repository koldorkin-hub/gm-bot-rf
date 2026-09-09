#!/usr/bin/env node
/*
 * Локализация /quiet и /support через LocalizeText01.
 * /quiet: Тихий: переключить (+RETURNING language) → Тихий: локализ (текст on/off по-русски + язык) → Тихий: ответ ($json.text)
 * /support: Команда: support?[0] → Support: язык (SELECT language) → Support: локализ (текст поддержки + язык) → Support: отправить ($json.text + кнопка)
 * Идемпотентно (маркер 'Тихий: локализ'). Запуск: node transform-main-localize-quiet-support.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (byName['Тихий: локализ']) { console.log('уже есть — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }
for (const t of ['Тихий: переключить', 'Тихий: ответ', 'Команда: support?', 'Support: отправить', 'Пачка: занят?']) if (!byName[t]) throw new Error('нет узла ' + t);

const mkLoc = (name, textExpr, id, pos) => ({
  parameters: {
    workflowId: { __rl: true, mode: 'list', value: 'LocalizeText01', cachedResultName: 'Инструмент — Локализация текста' },
    workflowInputs: { mappingMode: 'defineBelow', value: { text: textExpr, language: "={{ $json.language }}" } },
    options: {}
  },
  id: id, name: name, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: pos, onError: 'continueRegularOutput'
});

// --- /quiet ---
byName['Тихий: переключить'].parameters.query = "INSERT INTO client_profile (bot_id, user_id, proactive_enabled) VALUES ($1,$2,false) ON CONFLICT (bot_id,user_id) DO UPDATE SET proactive_enabled = NOT COALESCE(client_profile.proactive_enabled, true), updated_at=now() RETURNING proactive_enabled, language;";
const onTxt = '🔔 Напоминания включены. Буду присылать недельную сводку прогресса и по-доброму напоминать, если пропадёшь на время. Выключить — снова нажми /quiet.';
const offTxt = '🔕 Тихий режим включён. Я больше не пишу первым — отвечаю только когда пишешь ты. Вернуть напоминания — снова нажми /quiet.';
const quietTextExpr = "={{ $json.proactive_enabled ? " + JSON.stringify(onTxt) + " : " + JSON.stringify(offTxt) + " }}";
wf.nodes.push(mkLoc('Тихий: локализ', quietTextExpr, 'loc-quiet-01', [720, 940]));
// Тихий: ответ теперь шлёт $json.text
byName['Тихий: ответ'].parameters.bodyParameters.parameters.forEach(pp => { if (pp.name === 'text') pp.value = '={{ $json.text }}'; });

// --- /support ---
const supTxt = 'Есть вопрос, жалоба или идея по работе бота? Напиши нам — мы читаем и учитываем каждое сообщение 🙏';
const supLang = {
  parameters: { operation: 'executeQuery', query: "SELECT language FROM client_profile WHERE bot_id=$1 AND user_id=$2;", options: { queryReplacement: "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}" } },
  id: 'sup-lang-01', name: 'Support: язык', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [520, 820],
  credentials: byName['Тихий: переключить'].credentials, onError: 'continueRegularOutput'
};
wf.nodes.push(supLang);
wf.nodes.push(mkLoc('Support: локализ', '={{ ' + JSON.stringify(supTxt) + ' }}', 'loc-sup-01', [720, 820]));
byName['Support: отправить'].parameters.bodyParameters.parameters.forEach(pp => { if (pp.name === 'text') pp.value = '={{ $json.text }}'; });

// rewire
const C = wf.connections;
const setMain = (from, i, targets) => { if (!C[from]) C[from] = { main: [] }; while (C[from].main.length <= i) C[from].main.push([]); C[from].main[i] = targets.map(t => ({ node: t, type: 'main', index: 0 })); };
setMain('Тихий: переключить', 0, ['Тихий: локализ']);
setMain('Тихий: локализ', 0, ['Тихий: ответ']);
setMain('Команда: support?', 0, ['Support: язык']);
setMain('Support: язык', 0, ['Support: локализ']);
setMain('Support: локализ', 0, ['Support: отправить']);

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: /quiet и /support локализованы через LocalizeText01');
