#!/usr/bin/env node
/*
 * Собирает AccessDigest01 (ежедневная сводка новых заявок на доступ владельцу) из
 * клона SupportDigest01 (чтобы точно совпасть по telegram-ноде/cred алерт-бота).
 * Расписание 09:15 МСК; собирает access_request WHERE digested_at IS NULL (+ до какой даты выдан);
 * шлёт владельцу (255171226) через алерт-бот; помечает digested_at. Пусто → не шлёт.
 * Запуск: node build-accessdigest.js <sd.json> <out.json>
 */
const fs = require('fs');
const src = process.argv[2] || '/home/node/sd.json';
const out = process.argv[3] || '/home/node/accessdigest.json';
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

wf.id = 'AccessDigest01';
wf.name = 'Доступ — сводка заявок владельцу';
if (wf.active === undefined) wf.active = true;
delete wf.versionId; delete wf.activeVersionId; delete wf.versionCounter;

// расписание 09:15 МСК
for (const n of wf.nodes) {
  if (n.type.endsWith('scheduleTrigger')) {
    n.parameters = { rule: { interval: [ { field: 'cronExpression', expression: '15 9 * * *' } ] } };
  }
}
// Забрать — новые заявки
byName['Забрать'].parameters.query = "SELECT COALESCE(json_agg(json_build_object('bot',ar.bot_id,'uid',ar.user_id,'name',ar.display_name,'until',to_char(ua.access_until,'DD.MM.YYYY')) ORDER BY ar.requested_at),'[]'::json) AS rows, count(*) AS n FROM access_request ar LEFT JOIN user_access ua ON ua.bot_id=ar.bot_id AND ua.user_id=ar.user_id WHERE ar.digested_at IS NULL;";
byName['Забрать'].parameters.options = byName['Забрать'].parameters.options || {};

// Формат — текст сводки
byName['Формат'].parameters.jsCode = [
  "const a = $json || {};",
  "let rows = a.rows; if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch(e){ rows = []; } }",
  "rows = rows || [];",
  "if (!rows.length) { return []; }",
  "const lines = rows.map(r => '• ' + (r.name || '—') + ' · id ' + r.uid + ' · ' + r.bot + (r.until ? (' · доступ до ' + r.until) : ' · ДОСТУП НЕ ВЫДАН (выдай /grant)'));",
  "const text = '👥 <b>Новые заявки на доступ</b> (' + rows.length + ')\\n\\n' + lines.join('\\n') + '\\n\\nАвто-доступ (клиентский бот, в период) уже открыт. Кому нет — кнопка /grant. Отозвать — /revoke.';",
  "return [{ json: { text, n: rows.length } }];"
].join("\n");

// Пометить — digested_at
byName['Пометить'].parameters.query = "UPDATE access_request SET digested_at=now() WHERE digested_at IS NULL;";
byName['Пометить'].parameters.options = byName['Пометить'].parameters.options || {};

fs.writeFileSync(out, JSON.stringify([wf], null, 2));
console.log('OK: AccessDigest01 собран из SupportDigest01');
