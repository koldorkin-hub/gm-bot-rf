#!/usr/bin/env node
/*
 * Трекинг модальностей: узел "Usage: событие" пишет в usage_event(feature) тип
 * входящего сообщения (voice/photo/document; text не логируется). Висит ПАРАЛЛЕЛЬНО
 * на Пущен?[0] (после гейта доступа) — второй выход, основной поток (Команда: about?)
 * НЕ трогается. onError=continue (сбой лога не влияет на бота). Нужен для отчёта
 * владельцу (OwnerAnalytics01). Клонирует PG-узел (Пачка: занят?) как шаблон.
 * Идемпотентно (маркер 'Usage: событие'). Запуск: node transform-main-usage-event.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

if (byName['Usage: событие']) { console.log('уже есть — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }
if (!byName['Пачка: занят?']) throw new Error('нет шаблона Пачка: занят?');
if (!byName['Пущен?']) throw new Error('нет Пущен?');

const n = JSON.parse(JSON.stringify(byName['Пачка: занят?']));
n.name = 'Usage: событие';
n.id = 'usageevt001';
n.position = [-100, 1100];
n.onError = 'continueRegularOutput';
n.parameters = {
  operation: 'executeQuery',
  query: "INSERT INTO usage_event (bot_id, user_id, feature) SELECT $1, $2, $3 WHERE $3 <> 'text';",
  options: {
    queryReplacement: "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id, ((m)=> m.voice ? 'voice' : (m.photo ? 'photo' : (m.document ? (((m.document.mime_type||'').indexOf('image/')===0) ? 'photo' : 'document') : 'text')))($('Normalize').first().json.message) ] }}"
  }
};
wf.nodes.push(n);

// параллельный выход: Пущен?[0] был → Команда: about? ; станет → [Команда: about?, Usage: событие]
const C = wf.connections;
const cur = (C['Пущен?'] && C['Пущен?'].main && C['Пущен?'].main[0]) ? C['Пущен?'].main[0].map(x => x.node) : [];
if (cur.indexOf('Команда: about?') < 0) throw new Error('Пущен?[0] не ведёт на Команда: about? — сначала buttons-transform');
C['Пущен?'].main[0] = ['Команда: about?', 'Usage: событие'].map(t => ({ node: t, type: 'main', index: 0 }));

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: Usage: событие добавлен, параллельно на Пущен?[0]. Логирует voice/photo/document (text — нет).');
