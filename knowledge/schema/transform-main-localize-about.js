#!/usr/bin/env node
/*
 * Локализация /about (команда + приветствие новичку): текст из bot_content(ru)
 * прогоняется через подворкфлоу LocalizeText01 (русский → как есть, иначе Haiku-перевод
 * на язык клиента). About: текст/текст2 теперь возвращают ещё и language.
 * Идемпотентно (маркер 'About: локализ'). Запуск: node transform-main-localize-about.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (byName['About: локализ']) { console.log('уже есть — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }
for (const t of ['About: текст', 'About: текст2', 'About: отправить', 'About: приветствие']) if (!byName[t]) throw new Error('нет узла ' + t);

const aboutQuery = "SELECT bc.text, (SELECT language FROM client_profile WHERE bot_id=$1 AND user_id=$2) AS language FROM bot_content bc WHERE bc.key='about' AND bc.lang='ru' LIMIT 1;";
const aboutRepl = "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id ] }}";
byName['About: текст'].parameters.query = aboutQuery;
byName['About: текст'].parameters.options = { queryReplacement: aboutRepl };
byName['About: текст2'].parameters.query = aboutQuery;
byName['About: текст2'].parameters.options = { queryReplacement: aboutRepl };

function mkLocalize(name, pos) {
  return {
    parameters: {
      workflowId: { __rl: true, mode: 'list', value: 'LocalizeText01', cachedResultName: 'Инструмент — Локализация текста' },
      workflowInputs: { mappingMode: 'defineBelow', value: { text: "={{ $json.text }}", language: "={{ $json.language }}" } },
      options: {}
    },
    id: name === 'About: локализ' ? 'loc-about-01' : 'loc-about-02',
    name: name,
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: pos,
    onError: 'continueRegularOutput'
  };
}
wf.nodes.push(mkLocalize('About: локализ', [420, 640]));
wf.nodes.push(mkLocalize('About: локализ2', [420, 960]));

const C = wf.connections;
const setMain = (from, i, targets) => { if (!C[from]) C[from] = { main: [] }; while (C[from].main.length <= i) C[from].main.push([]); C[from].main[i] = targets.map(t => ({ node: t, type: 'main', index: 0 })); };
// About: текст → About: локализ → About: отправить
setMain('About: текст', 0, ['About: локализ']);
setMain('About: локализ', 0, ['About: отправить']);
// About: текст2 → About: локализ2 → About: приветствие
setMain('About: текст2', 0, ['About: локализ2']);
setMain('About: локализ2', 0, ['About: приветствие']);

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: /about локализован (текст+текст2 отдают language → LocalizeText01 → отправка)');
