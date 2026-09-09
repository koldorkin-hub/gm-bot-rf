#!/usr/bin/env node
/*
 * OwnerAnalytics01: секция «Затраты за неделю» v2 — ПОЛНАЯ корректная версия.
 * Применяется к ЧИСТОМУ OA (без прежнего cost-блока): v1 (transform-oa-costs.js) была
 * повреждена граблей String.replace — `$'` в строке замены = спецпаттерн JS («хвост после
 * совпадения»), регулярки `[0-9]+$'` и знаки `$` в тексте отчёта были съедены. Здесь все
 * замены — через функцию (спецпаттерны отключены).
 * Считает КЛИЕНТОВ без владельца (255171226) и тестов (999xxx); владелец — отдельной строкой.
 * Идемпотентно (маркер: owner_msgs). Запуск: node transform-oa-costs2.js <path-to-clean-oa>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/oa-clean.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const q = byName['Собрать метрики']; if (!q) throw new Error('нет Собрать метрики');
const fmt = byName['Формат']; if (!fmt) throw new Error('нет Формат');
if (q.parameters.query.includes('owner_msgs')) { console.log('уже применено — пропуск'); process.exit(0); }
if (q.parameters.query.includes("'cost'")) throw new Error('в OA уже есть повреждённый cost-блок — применять к ЧИСТОМУ бэкапу');

const qAnchor = ') AS report;';
if (!q.parameters.query.includes(qAnchor)) throw new Error('якорь запроса не найден');
const costSql = `,
 'cost',(SELECT json_build_object(
   'msgs',(SELECT count(*) FROM n8n_chat_histories h WHERE h.created_at >= now()-interval '7 days' AND h.message->>'type'='human' AND h.session_id ~ '^[^:]+:[0-9]+$' AND NOT (split_part(h.session_id,':',2)::bigint BETWEEN 999000 AND 999999) AND split_part(h.session_id,':',2)::bigint <> 255171226),
   'owner_msgs',(SELECT count(*) FROM n8n_chat_histories h WHERE h.created_at >= now()-interval '7 days' AND h.message->>'type'='human' AND h.session_id ~ '^[^:]+:[0-9]+$' AND split_part(h.session_id,':',2)::bigint = 255171226),
   'research',(SELECT count(*) FROM research_attempts WHERE created_at >= now()-interval '7 days' AND status='done' AND COALESCE(session_id,'') NOT LIKE '%:255171226' AND COALESCE(session_id,'') !~ ':999[0-9]{3}$'),
   'rate',(SELECT COALESCE(value,'0.14') FROM app_config WHERE key='cost_per_msg_usd'),
   'top',(SELECT json_agg(t) FROM (SELECT split_part(h.session_id,':',2) AS uid, count(*) AS n FROM n8n_chat_histories h WHERE h.created_at >= now()-interval '7 days' AND h.message->>'type'='human' AND h.session_id ~ '^[^:]+:[0-9]+$' AND NOT (split_part(h.session_id,':',2)::bigint BETWEEN 999000 AND 999999) AND split_part(h.session_id,':',2)::bigint <> 255171226 GROUP BY 1 ORDER BY n DESC LIMIT 5) t)
 ))
) AS report;`;
q.parameters.query = q.parameters.query.replace(qAnchor, () => costSql);

const fmtAnchor = "return [{ json: { text: L.join('\\n') } }];";
if (!fmt.parameters.jsCode.includes(fmtAnchor)) throw new Error('якорь Формат не найден');
const costJs = `const c = r.cost || {};
const rate = Number(c.rate || 0.14);
const msgs = Number(c.msgs || 0), res = Number(c.research || 0), om = Number(c.owner_msgs || 0);
const est = msgs * rate + res * 0.52;
L.push('');
L.push('<b>💰 Затраты за неделю (расчёт)</b>');
L.push('Клиенты (БЕЗ владельца и тестов): ' + msgs + ' сообщ. × $' + rate.toFixed(2) + ' + research: ' + res + ' × $0.52 ≈ <b>$' + est.toFixed(2) + '</b>');
L.push('Владелец отдельно: ' + om + ' сообщ. ≈ $' + (om * rate).toFixed(2) + ' (в итог клиентов НЕ входит)');
const top = Array.isArray(c.top) ? c.top : (typeof c.top === 'string' ? JSON.parse(c.top || '[]') : []);
if (top && top.length) L.push('Топ клиентов: ' + top.map(t => t.uid + ' — ~$' + (Number(t.n) * rate).toFixed(2)).join(' · '));
L.push('<i>Ставка $/сообщ. — app_config.cost_per_msg_usd (оценка, сверяй с консолью Anthropic).</i>');
` + fmtAnchor;
fmt.parameters.jsCode = fmt.parameters.jsCode.replace(fmtAnchor, () => costJs);

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: OwnerAnalytics — корректный cost-блок v2 (клиенты без владельца/тестов, владелец отдельно)');
