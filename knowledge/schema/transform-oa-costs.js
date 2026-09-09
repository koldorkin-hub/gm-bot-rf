#!/usr/bin/env node
/*
 * OwnerAnalytics01: секция «Затраты за неделю (расчёт)» в понедельничном отчёте —
 * сообщения×ставка (app_config.cost_per_msg_usd) + research×$0.52, топ-5 юзеров по сообщениям.
 * Тест-диапазон 999xxx исключён. Идемпотентно (маркер: cost_per_msg_usd в запросе).
 * Запуск: node transform-oa-costs.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/oa-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const q = byName['Собрать метрики']; if (!q) throw new Error('нет Собрать метрики');
const fmt = byName['Формат']; if (!fmt) throw new Error('нет Формат');
if (q.parameters.query.includes('cost_per_msg_usd')) { console.log('уже применено — пропуск'); process.exit(0); }

const anchor = ') AS report;';
if (!q.parameters.query.includes(anchor)) throw new Error('якорь запроса не найден');
q.parameters.query = q.parameters.query.replace(anchor,
`,
 'cost',(SELECT json_build_object(
   'msgs',(SELECT count(*) FROM n8n_chat_histories h WHERE h.created_at >= now()-interval '7 days' AND h.message->>'type'='human' AND h.session_id ~ '^[^:]+:[0-9]+$' AND NOT (split_part(h.session_id,':',2)::bigint BETWEEN 999000 AND 999999)),
   'research',(SELECT count(*) FROM research_attempts WHERE created_at >= now()-interval '7 days' AND status='done'),
   'rate',(SELECT COALESCE(value,'0.14') FROM app_config WHERE key='cost_per_msg_usd'),
   'top',(SELECT json_agg(t) FROM (SELECT split_part(h.session_id,':',2) AS uid, count(*) AS n FROM n8n_chat_histories h WHERE h.created_at >= now()-interval '7 days' AND h.message->>'type'='human' AND h.session_id ~ '^[^:]+:[0-9]+$' AND NOT (split_part(h.session_id,':',2)::bigint BETWEEN 999000 AND 999999) GROUP BY 1 ORDER BY n DESC LIMIT 5) t)
 ))
) AS report;`);

const fmtAnchor = "return [{ json: { text: L.join('\\n') } }];";
if (!fmt.parameters.jsCode.includes(fmtAnchor)) throw new Error('якорь Формат не найден');
fmt.parameters.jsCode = fmt.parameters.jsCode.replace(fmtAnchor,
`const c = r.cost || {};
const rate = Number(c.rate || 0.14);
const msgs = Number(c.msgs || 0), res = Number(c.research || 0);
const est = msgs * rate + res * 0.52;
L.push('');
L.push('<b>💰 Затраты за неделю (расчёт)</b>');
L.push('Сообщений: ' + msgs + ' × $' + rate.toFixed(2) + ' + research: ' + res + ' × $0.52 ≈ <b>$' + est.toFixed(2) + '</b>');
const top = Array.isArray(c.top) ? c.top : (typeof c.top === 'string' ? JSON.parse(c.top || '[]') : []);
if (top && top.length) L.push('Топ по сообщениям: ' + top.map(t => t.uid + ' — ~$' + (Number(t.n) * rate).toFixed(2)).join(' · '));
L.push('<i>Ставка $/сообщ. — app_config.cost_per_msg_usd (сейчас оценка, сверяй с консолью Anthropic).</i>');
` + fmtAnchor);

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: OwnerAnalytics01 — секция затрат за неделю');
