#!/usr/bin/env node
/*
 * main: лимит клиентов на авто-доступ (app_config.access_max_clients). Правит:
 *  - 'Заявка: обработать' (PG): авто-выдача ТОЛЬКО если активных клиентов (user_access на client-ботах,
 *    непросроченные, без тест-диапазона) < max_clients; возвращает доп. флаг at_limit;
 *  - 'Заявка: текст' (Code): при at_limit — сообщение про бета-тест и рассмотрение после 01.10.2026.
 * Идемпотентно (маркер: 'max_clients' в запросе). Запуск: node transform-main-access-limit.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const proc = byName['Заявка: обработать']; if (!proc) throw new Error('нет Заявка: обработать');
const txt = byName['Заявка: текст']; if (!txt) throw new Error('нет Заявка: текст');
if ((proc.parameters.query || '').includes('max_clients')) { console.log('уже с лимитом — пропуск'); process.exit(0); }

proc.parameters.query =
"WITH cfg AS (SELECT (SELECT value FROM app_config WHERE key='access_promo_until')::date AS promo_until, (SELECT value FROM app_config WHERE key='access_grant_until')::date AS grant_until, (SELECT value::int FROM app_config WHERE key='access_max_clients') AS max_clients, (SELECT count(*) FROM user_access ua JOIN clients c ON ua.bot_id=c.bot_id WHERE c.bot_type='client' AND (ua.access_until IS NULL OR ua.access_until>=current_date) AND NOT (ua.user_id>=999000 AND ua.user_id<1000000)) AS active_clients), "
+ "me AS (SELECT (SELECT bot_type FROM clients WHERE bot_id=$1) AS bt), "
+ "req AS (INSERT INTO access_request (bot_id,user_id,display_name,status) VALUES ($1,$2,$3,'pending') ON CONFLICT (bot_id,user_id) DO NOTHING RETURNING user_id), "
+ "grn AS (INSERT INTO user_access (bot_id,user_id,access_until,note,updated_at) SELECT $1,$2,(SELECT grant_until FROM cfg),'авто-доступ (заявка фокус-группы)',now() WHERE (SELECT bt FROM me)='client' AND current_date <= (SELECT promo_until FROM cfg) AND (SELECT active_clients FROM cfg) < (SELECT max_clients FROM cfg) ON CONFLICT (bot_id,user_id) DO UPDATE SET access_until=EXCLUDED.access_until, note=EXCLUDED.note, updated_at=now() RETURNING user_id) "
+ "SELECT ((SELECT count(*) FROM req)>0) AS is_new, ((SELECT count(*) FROM grn)>0) AS auto_granted, ((SELECT bt FROM me)='client' AND current_date <= (SELECT promo_until FROM cfg) AND (SELECT active_clients FROM cfg) >= (SELECT max_clients FROM cfg)) AS at_limit, (SELECT to_char(grant_until,'DD.MM.YYYY') FROM cfg) AS grant_until;";

txt.parameters.jsCode = [
  "const r = $json || {};",
  "const g = r.grant_until || '';",
  "let text;",
  "if (r.auto_granted) { text = '👋 Привет! Доступ открыт до ' + g + ' — добро пожаловать в ИИ-Тренер!\\n\\nНапиши мне ещё раз (или сразу расскажи о своей цели) — и начнём. 💪'; }",
  "else if (r.at_limit) { text = '🧪 Сейчас наш бот на бета-тестировании, и число пользователей ограничено. Твоя заявка сохранена — мы рассмотрим её после 01.10.2026. Спасибо за интерес! 🙌'; }",
  "else if (r.is_new) { text = '✅ Заявка на доступ отправлена. Обычно открываю доступ в течение дня — загляни чуть позже и просто напиши мне.'; }",
  "else { text = '⏳ Твоя заявка уже у меня — скоро вернусь с ответом.'; }",
  "return [{ json: { text } }];"
].join("\n");

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: лимит клиентов (max_clients) + бета-сообщение сверх лимита');
