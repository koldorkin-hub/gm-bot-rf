/**
 * SelfDiag01 — ядро самодиагностики (только чтение).
 *
 * Прогоняет пробы по всем внешним зависимостям бота и возвращает
 * структурированный вердикт + готовый текст для Telegram (без разметки —
 * чтобы не ловить 400 can't parse entities на произвольном тексте ошибок).
 *
 * Вызывается из: SupportBot01 (команда /diag владельца) и DiagWatch01 (сторож).
 *
 * Сборка:  node schema/build-selfdiag.js   -> schema/SelfDiag01.json
 */
const fs = require('fs');
const path = require('path');

const CRED_PG = { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' };
const CRED_ANTHROPIC = { id: 'J8w0oAhcMJCaC4PY', name: 'Anthropic account' };
const CRED_GROQ = { id: 'GroqHdrAuth00001', name: 'Groq Header Auth' };

// Ответ HTTP-узла всегда с телом и кодом, ошибки статуса НЕ бросаем:
// диагносту нужен сам код (400 «кончились кредиты» — это результат, а не авария).
const httpResp = (timeout) => ({
  timeout,
  response: { response: { fullResponse: true, neverError: true } },
});

const SQL_DB = [
  'SELECT',
  "  to_char(now(),'YYYY-MM-DD HH24:MI:SS') AS now_utc,",
  '  (SELECT max(created_at) FROM n8n_chat_histories) AS last_msg_at,',
  '  COALESCE(round(EXTRACT(epoch FROM now() - (SELECT max(created_at) FROM n8n_chat_histories))/60)::int, -1) AS silence_min,',
  "  (SELECT count(*) FROM n8n_chat_histories WHERE created_at > now() - interval '24 hours') AS msgs_24h,",
  "  (SELECT count(*) FROM ops_error WHERE at > now() - interval '1 hour') AS err_1h,",
  "  (SELECT count(*) FROM ops_error WHERE at > now() - interval '24 hours') AS err_24h,",
  "  (SELECT string_agg(w || ' x' || c, ', ') FROM (SELECT COALESCE(workflow_name,'?') AS w, count(*) AS c",
  "     FROM ops_error WHERE at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t) AS err_top,",
  '  (SELECT left(message,200) FROM ops_error ORDER BY at DESC LIMIT 1) AS err_last,',
  "  (SELECT count(*) FROM research_state WHERE stage='running' AND started_at < now() - interval '25 minutes') AS research_orphans,",
  "  (SELECT count(*) FROM batch_busy WHERE started_at < now() - interval '10 minutes') AS batch_orphans,",
  '  (SELECT count(*) FROM user_access WHERE access_until >= current_date',
  '     AND NOT (user_id >= 999000 AND user_id < 1000000)) AS active_access,',
  '  (SELECT count(*) FROM feedback WHERE digested_at IS NULL) AS feedback_new;',
].join('\n');

// Тестовый бот tclient держит бутафорский токен (18 символов) — в пробу не берём.
const SQL_BOTS = [
  "SELECT bot_id AS label, bot_username, bot_token FROM clients",
  "  WHERE status='active' AND length(bot_token) > 40",
  'UNION ALL',
  "SELECT 'support' AS label, bot_username, bot_token FROM support_bot;",
].join('\n');

const ANTHROPIC_BODY = JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'ping' }],
});

const CODE_SVOD = String.raw`
// Свод проб в вердикт. Ничего не чинит и никуда не пишет — только читает.
const grab = (name) => { try { return $(name).first().json || {}; } catch (e) { return {}; } };
const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
const short = (v, n) => String(v == null ? '' : v).slice(0, n);

const checks = [];
const add = (key, title, status, detail) => checks.push({ key, title, status, detail });

// --- 1. Postgres (память клиентов, журналы, доступы) ---
const db = grab('Диаг: база');
const dbOk = db.now_utc !== undefined && db.now_utc !== null;
add('postgres', 'База данных', dbOk ? 'ok' : 'red',
  dbOk ? 'отвечает' : 'НЕ отвечает — ' + short(db.error && db.error.message || db.message || 'нет ответа', 180));

// --- 2. Anthropic: то самое, что молча убило бота на 6 часов ---
const an = grab('Диаг: anthropic');
const anCode = num(an.statusCode, 0);
const anBody = (() => { try { return JSON.stringify(an.body || {}); } catch (e) { return ''; } })();
let anSt = 'red', anDet = '';
if (anCode === 200) { anSt = 'ok'; anDet = 'отвечает, оплата в порядке'; }
else if (anCode === 400 && /credit balance/i.test(anBody)) { anDet = 'КОНЧИЛИСЬ КРЕДИТЫ — пополнить баланс в консоли Anthropic'; }
else if (anCode === 400) { anDet = 'отклонил запрос (400) — ' + short(anBody, 160); }
else if (anCode === 401) { anDet = 'ключ API отклонён (401) — проверить credential'; }
else if (anCode === 429) { anSt = 'warn'; anDet = 'упёрлись в лимит запросов (429)'; }
else if (anCode >= 500) { anDet = 'авария на стороне Anthropic (' + anCode + ')'; }
else { anDet = 'не отвечает — ' + short(an.error && an.error.message || an.message || 'сеть недоступна', 160); }
add('anthropic', 'Anthropic (мозг бота)', anSt, anDet);

// --- 3. Публичный адрес: этим путём Telegram приносит сообщения ---
const site = grab('Диаг: сайт');
const siteCode = num(site.statusCode, 0);
add('site', 'Публичный адрес n8n', siteCode === 200 ? 'ok' : 'red',
  siteCode === 200 ? 'отвечает (nginx + SSL живы)'
    : 'НЕ отвечает (' + (siteCode || 'сеть') + ') — Telegram не сможет достучаться');

// --- 4. Groq: расшифровка голосовых ---
const gq = grab('Диаг: groq');
const gqCode = num(gq.statusCode, 0);
add('groq', 'Groq (голосовые)', gqCode === 200 ? 'ok' : (gqCode === 401 ? 'red' : 'warn'),
  gqCode === 200 ? 'отвечает'
    : gqCode === 401 ? 'ключ отклонён (401) — голос не работает'
    : 'не отвечает (' + (gqCode || 'сеть') + ') — голос под вопросом');

// --- 5. Gotenberg: PDF-отчёты и графики ---
const gt = grab('Диаг: gotenberg');
const gtCode = num(gt.statusCode, 0);
add('gotenberg', 'Gotenberg (PDF и графики)', gtCode === 200 ? 'ok' : 'warn',
  gtCode === 200 ? 'отвечает' : 'не отвечает (' + (gtCode || 'сеть') + ') — PDF и графики не соберутся');

// --- 6. Боты Telegram: жив ли вебхук у каждого ---
let botRows = [];
try { botRows = $('Диаг: боты').all().map((i) => i.json); } catch (e) { botRows = []; }
const hooks = $input.all().map((i) => i.json);
const botLines = [];
let botStatus = 'ok';
const nowSec = Math.floor(new Date().getTime() / 1000);
botRows.forEach((b, idx) => {
  const h = hooks[idx] || {};
  const code = num(h.statusCode, 0);
  const body = h.body || {};
  const name = '@' + (b.bot_username || b.label);
  if (code !== 200 || body.ok !== true) {
    botStatus = 'red';
    botLines.push(name + ': не отвечает (' + (code || 'сеть') + ')');
    return;
  }
  const r = body.result || {};
  const pend = num(r.pending_update_count, 0);
  const lastErr = String(r.last_error_message || '');
  // last_error_message Telegram держит долго после починки — считаем сбоем
  // только свежую ошибку (моложе 30 минут), иначе сторож будет выть на старое.
  const errAge = r.last_error_date ? (nowSec - num(r.last_error_date, 0)) : 1e9;
  if (lastErr && errAge < 1800) {
    botStatus = 'red';
    botLines.push(name + ': вебхук с ошибкой — ' + short(lastErr, 120));
  } else if (pend > 20) {
    if (botStatus === 'ok') botStatus = 'warn';
    botLines.push(name + ': очередь ' + pend + ' необработанных');
  } else {
    botLines.push(name + ': ок' + (pend ? ' (в очереди ' + pend + ')' : ''));
  }
});
if (!botRows.length) { botStatus = 'warn'; botLines.push('список ботов не прочитан'); }
add('telegram', 'Боты Telegram', botStatus, botLines.join('; '));

// --- 7. Зависшие долгие операции (сами себя лечат свипами, но знать полезно) ---
const orphans = num(db.research_orphans, 0) + num(db.batch_orphans, 0);
if (orphans > 0) {
  add('orphans', 'Зависшие операции', 'warn',
    'research: ' + num(db.research_orphans, 0) + ', пачки файлов: ' + num(db.batch_orphans, 0));
}

// --- 8. Всплеск сбоёв у клиентов ---
// Инфраструктура при этом бывает полностью зелёной: 18.08.2026 агент упирался
// в потолок шагов, клиенты получали отказ, а все пробы показывали «всё хорошо».
const err1h = num(db.err_1h, 0);
if (dbOk && err1h >= 3) {
  add('errors', 'Сбои у клиентов', 'warn',
    err1h + ' за последний час' + (db.err_top ? ' — ' + short(db.err_top, 120) : ''));
}

// --- Итог ---
const worst = checks.some((c) => c.status === 'red') ? 'red'
  : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';

// --- Текст для Telegram. Без HTML-разметки: тексты ошибок произвольные,
// на < & > Telegram отбрасывает сообщение целиком (грабля алертов, п.2). ---
const icon = { ok: '✅', warn: '⚠️', red: '🔴' };
const verdict = { ok: 'всё в порядке', warn: 'есть предупреждения', red: 'ЕСТЬ СБОЙ' };
const mskNow = new Date().toLocaleString('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

const lines = [];
lines.push('🩺 Диагностика ИИ-Тренера');
lines.push('Итог: ' + icon[worst] + ' ' + verdict[worst]);
lines.push(mskNow + ' МСК');
lines.push('');
checks.forEach((c) => lines.push(icon[c.status] + ' ' + c.title + ' — ' + c.detail));

lines.push('');
if (!dbOk) {
  // Все счётчики ниже читаются из базы. Если она молчит — печатать нули нельзя:
  // «активных доступов: 0» во время аварии выглядит как факт, а это незнание.
  lines.push('Счётчики недоступны — база не отвечает.');
} else {
  const silence = num(db.silence_min, -1);
  const silenceTxt = silence < 0 ? 'сообщений ещё не было'
    : silence < 60 ? ('последнее ' + silence + ' мин назад')
    : ('последнее ' + Math.round(silence / 60) + ' ч назад');

  lines.push('Сейчас в системе:');
  lines.push('• сообщений за сутки: ' + num(db.msgs_24h, 0) + ', ' + silenceTxt);
  lines.push('• ошибок за час / сутки: ' + num(db.err_1h, 0) + ' / ' + num(db.err_24h, 0));
  if (db.err_top) lines.push('• где падало: ' + short(db.err_top, 200));
  if (num(db.err_24h, 0) > 0 && db.err_last) lines.push('• последняя ошибка: ' + short(db.err_last, 200));
  lines.push('• активных доступов: ' + num(db.active_access, 0));
  lines.push('• новых обращений в поддержку: ' + num(db.feedback_new, 0));
}

return [{ json: {
  status: worst,
  checks,
  text: lines.join('\n'),
  summary: checks.filter((c) => c.status !== 'ok').map((c) => c.title + ': ' + c.detail).join(' | '),
} }];
`.trim();

const wf = {
  id: 'SelfDiag000001',
  name: 'Диагностика — проверка системы',
  active: false,
  nodes: [
    {
      parameters: {
        inputSource: 'workflowInputs',
        workflowInputs: { values: [{ name: 'source', type: 'string' }] },
      },
      id: 'dg000000-0000-4000-8000-000000000001',
      name: 'Запуск',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.2,
      position: [-820, 0],
    },
    {
      parameters: { operation: 'executeQuery', query: SQL_DB, options: {} },
      id: 'dg000000-0000-4000-8000-000000000002',
      name: 'Диаг: база',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-600, 0],
      credentials: { postgres: CRED_PG },
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'anthropicApi',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'anthropic-version', value: '2023-06-01' },
            { name: 'content-type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: ANTHROPIC_BODY,
        options: httpResp(12000),
      },
      id: 'dg000000-0000-4000-8000-000000000003',
      name: 'Диаг: anthropic',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [-380, 0],
      credentials: { anthropicApi: CRED_ANTHROPIC },
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'GET',
        url: 'https://n8n.exlogist.com/healthz',
        options: httpResp(8000),
      },
      id: 'dg000000-0000-4000-8000-000000000004',
      name: 'Диаг: сайт',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [-160, 0],
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'GET',
        url: 'https://api.groq.com/openai/v1/models',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        options: httpResp(8000),
      },
      id: 'dg000000-0000-4000-8000-000000000005',
      name: 'Диаг: groq',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [60, 0],
      credentials: { httpHeaderAuth: CRED_GROQ },
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'GET',
        url: 'http://gotenberg:3000/health',
        options: httpResp(6000),
      },
      id: 'dg000000-0000-4000-8000-000000000006',
      name: 'Диаг: gotenberg',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [280, 0],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { operation: 'executeQuery', query: SQL_BOTS, options: {} },
      id: 'dg000000-0000-4000-8000-000000000007',
      name: 'Диаг: боты',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [500, 0],
      credentials: { postgres: CRED_PG },
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        method: 'GET',
        url: '=https://api.telegram.org/bot{{ $json.bot_token }}/getWebhookInfo',
        options: httpResp(6000),
      },
      id: 'dg000000-0000-4000-8000-000000000008',
      name: 'Диаг: вебхуки',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [720, 0],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { jsCode: CODE_SVOD },
      id: 'dg000000-0000-4000-8000-000000000009',
      name: 'Диаг: свод',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [940, 0],
    },
  ],
  connections: {
    'Запуск': { main: [[{ node: 'Диаг: база', type: 'main', index: 0 }]] },
    'Диаг: база': { main: [[{ node: 'Диаг: anthropic', type: 'main', index: 0 }]] },
    'Диаг: anthropic': { main: [[{ node: 'Диаг: сайт', type: 'main', index: 0 }]] },
    'Диаг: сайт': { main: [[{ node: 'Диаг: groq', type: 'main', index: 0 }]] },
    'Диаг: groq': { main: [[{ node: 'Диаг: gotenberg', type: 'main', index: 0 }]] },
    'Диаг: gotenberg': { main: [[{ node: 'Диаг: боты', type: 'main', index: 0 }]] },
    'Диаг: боты': { main: [[{ node: 'Диаг: вебхуки', type: 'main', index: 0 }]] },
    'Диаг: вебхуки': { main: [[{ node: 'Диаг: свод', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001', executionTimeout: 180 },
};

const out = path.join(__dirname, 'SelfDiag01.json');
fs.writeFileSync(out, JSON.stringify([wf], null, 2), 'utf8');
console.log('OK ->', out, fs.statSync(out).size, 'байт,', wf.nodes.length, 'узлов');
