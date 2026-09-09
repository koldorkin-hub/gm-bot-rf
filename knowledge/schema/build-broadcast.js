#!/usr/bin/env node
/*
 * Собирает подворкфлоу Broadcast01 (рассылка сервисных уведомлений владельцем).
 * Вход: command_text, owner_bot_id, owner_bot_token, owner_chat_id (из main по /broadcast*).
 * Режимы: draft (/broadcast <текст>) → Haiku полирует → превью+счётчик владельцу, черновик в broadcast_pending;
 *         send (/broadcast_send) → фан-аут по client/trusted (proactive_enabled, не тест), локализация LocalizeText01,
 *         троттлинг (batching), лог proactive_log, отчёт владельцу, очистка черновика;
 *         cancel (/broadcast_cancel) → удалить черновик.
 * Пишет /home/node/broadcast.json. Запуск: node build-broadcast.js <out>
 */
const fs = require('fs');
const out = process.argv[2] || '/home/node/broadcast.json';
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const ANTH = { anthropicApi: { id: 'J8w0oAhcMJCaC4PY', name: 'Anthropic account' } };

const rezhimCode = [
  "const d = $input.first().json;",
  "const raw = String(d.command_text || '').trim();",
  "let mode = 'draft', draft = '';",
  "if (/^\\/broadcast_send/i.test(raw)) mode = 'send';",
  "else if (/^\\/broadcast_cancel/i.test(raw)) mode = 'cancel';",
  "else { draft = raw.replace(/^\\/broadcast/i, '').trim(); }",
  "return [{ json: { mode, draft, owner_bot_id: d.owner_bot_id, owner_bot_token: d.owner_bot_token, owner_chat_id: d.owner_chat_id } }];"
].join("\n");

const promptCode = [
  "const d = $json;",
  "const system = 'Ты — редактор объявлений фитнес-сервиса «ИИ-Тренер». Преврати черновик владельца в короткое, тёплое, аккуратно оформленное объявление для клиентов в Telegram. Разрешён только HTML: <b>, <i>. Уместные эмодзи, без перебора. НЕ выдумывай фактов сверх черновика, не добавляй ссылок и обещаний, которых нет. Пиши по-русски. Верни ТОЛЬКО текст объявления, без пояснений и кавычек.';",
  "const payload = { model: 'claude-haiku-4-5-20251001', max_tokens: 1200, system: system, messages: [{ role: 'user', content: String(d.draft || '') }] };",
  "return [{ json: { payload, draft: d.draft } }];"
].join("\n");

const razborCode = [
  "let t = ''; try { t = $json.content[0].text; } catch (e) { t = ''; }",
  "t = String(t || '').trim();",
  "if (!t) { t = String($('Промпт полировки').first().json.draft || ''); }",
  "return [{ json: { text: t } }];"
].join("\n");

const itogCode = [
  "const items = $('Отправка').all();",
  "let ok = 0, fail = 0;",
  "for (const it of items) { if (it.json && it.json.ok === true) ok++; else fail++; }",
  "return [{ json: { ok, fail, total: items.length } }];"
].join("\n");

const audienceWhere = "c.bot_type IN ('client','trusted') AND cp.onboarding_done=true AND NOT (cp.user_id >= 999000 AND cp.user_id < 1000000) AND cp.proactive_enabled=true";

// Telegram sendMessage к владельцу (фикс. текст)
function ownerMsg(name, id, pos, textExpr) {
  return {
    parameters: {
      method: 'POST',
      url: "=https://api.telegram.org/bot{{ $('Триггер').first().json.owner_bot_token }}/sendMessage",
      sendBody: true,
      bodyParameters: { parameters: [
        { name: 'chat_id', value: "={{ $('Триггер').first().json.owner_chat_id }}" },
        { name: 'text', value: textExpr },
        { name: 'parse_mode', value: 'HTML' }
      ] },
      options: { timeout: 20000 }
    },
    id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: pos, onError: 'continueRegularOutput'
  };
}
function pg(name, id, pos, query, qr, extra) {
  const p = { operation: 'executeQuery', query, options: {} };
  if (qr) p.options.queryReplacement = qr;
  const n = { parameters: p, id, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG };
  return Object.assign(n, extra || {});
}
function code(name, id, pos, js) {
  return { parameters: { jsCode: js }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos };
}

const nodes = [
  { parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [
      { name: 'command_text', type: 'string' }, { name: 'owner_bot_id', type: 'string' },
      { name: 'owner_bot_token', type: 'string' }, { name: 'owner_chat_id', type: 'string' } ] } },
    id: 'bc-node-000001', name: 'Триггер', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [-1200, 0] },
  code('Режим', 'bc-node-000002', [-1000, 0], rezhimCode),
  { parameters: { rules: { values: [
      { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'r0', leftValue: '={{ $json.mode }}', rightValue: 'draft', operator: { type: 'string', operation: 'equals' } } ] }, renameOutput: true, outputKey: 'draft' },
      { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'r1', leftValue: '={{ $json.mode }}', rightValue: 'send', operator: { type: 'string', operation: 'equals' } } ] }, renameOutput: true, outputKey: 'send' },
      { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'r2', leftValue: '={{ $json.mode }}', rightValue: 'cancel', operator: { type: 'string', operation: 'equals' } } ] }, renameOutput: true, outputKey: 'cancel' }
    ] }, options: {} },
    id: 'bc-node-000003', name: 'Маршрут', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [-800, 0] },

  // DRAFT
  { parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 'd1', leftValue: '={{ $json.draft }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } } ] }, options: {} },
    id: 'bc-node-000004', name: 'Есть текст?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [-600, -160] },
  code('Промпт полировки', 'bc-node-000005', [-400, -240], promptCode),
  { parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi', sendHeaders: true, headerParameters: { parameters: [ { name: 'anthropic-version', value: '2023-06-01' }, { name: 'content-type', value: 'application/json' } ] }, sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.payload) }}', options: { timeout: 30000, retry: { retry: { maxTries: 2, waitBetweenTries: 1500 } } } },
    id: 'bc-node-000006', name: 'Полировка', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [-200, -240], credentials: ANTH },
  code('Разбор', 'bc-node-000007', [0, -240], razborCode),
  pg('Сохранить черновик', 'bc-node-000008', [200, -240],
     "INSERT INTO broadcast_pending (bot_id, owner_id, text_html, stage) VALUES ($1,$2,$3,'ready') ON CONFLICT (bot_id,owner_id) DO UPDATE SET text_html=$3, stage='ready', created_at=now();",
     "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id, $('Разбор').first().json.text ] }}"),
  pg('Аудитория счёт', 'bc-node-000009', [400, -240],
     "SELECT count(*) AS n FROM client_profile cp JOIN clients c ON cp.bot_id=c.bot_id WHERE " + audienceWhere + ";", null, { alwaysOutputData: true }),
  ownerMsg('Превью', 'bc-node-000010', [600, -300], "={{ $('Разбор').first().json.text }}"),
  ownerMsg('Контроль', 'bc-node-000011', [800, -300], "=☝️ Так объявление увидят клиенты.\nПолучателей сейчас: {{ $('Аудитория счёт').first().json.n }}.\n\n/broadcast_send — разослать всем\n/broadcast_cancel — отмена"),
  pg('Ждём текст', 'bc-node-000012', [-400, -80],
     "INSERT INTO broadcast_pending (bot_id, owner_id, text_html, stage) VALUES ($1,$2,'','awaiting_text') ON CONFLICT (bot_id,owner_id) DO UPDATE SET text_html='', stage='awaiting_text', created_at=now();",
     "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}"),
  ownerMsg('Спроси текст', 'bc-node-000025', [-200, -80], "=✍️ Что разослать клиентам? Напиши текст объявления одним сообщением — я оформлю его красиво и покажу превью.\n\nОтмена — /broadcast_cancel"),

  // SEND
  pg('Загрузить', 'bc-node-000013', [-600, 40],
     "SELECT text_html FROM broadcast_pending WHERE bot_id=$1 AND owner_id=$2 LIMIT 1;",
     "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}", { alwaysOutputData: true }),
  { parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [ { id: 's1', leftValue: '={{ $json.text_html }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } } ] }, options: {} },
    id: 'bc-node-000014', name: 'Есть черновик?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [-400, 40] },
  pg('Аудитория', 'bc-node-000015', [-200, 0],
     "SELECT cp.bot_id, cp.user_id, coalesce(cp.language,'Russian') AS lang, c.bot_token, bp.text_html FROM client_profile cp JOIN clients c ON cp.bot_id=c.bot_id CROSS JOIN (SELECT text_html FROM broadcast_pending WHERE bot_id=$1 AND owner_id=$2 LIMIT 1) bp WHERE " + audienceWhere + ";",
     "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}", { alwaysOutputData: true }),
  { parameters: { workflowId: { __rl: true, mode: 'list', value: 'LocalizeText01', cachedResultName: 'Инструмент — Локализация текста' }, workflowInputs: { mappingMode: 'defineBelow', value: { text: '={{ $json.text_html }}', language: '={{ $json.lang }}' }, matchingColumns: [], schema: [ { id: 'text', displayName: 'text', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }, { id: 'language', displayName: 'language', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' } ], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} },
    id: 'bc-node-000016', name: 'Локализация', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [0, 0] },
  { parameters: { method: 'POST', url: "=https://api.telegram.org/bot{{ $('Аудитория').item.json.bot_token }}/sendMessage", sendBody: true, bodyParameters: { parameters: [ { name: 'chat_id', value: '={{ $(\'Аудитория\').item.json.user_id }}' }, { name: 'text', value: '={{ $json.text }}' }, { name: 'parse_mode', value: 'HTML' } ] }, options: { batching: { batch: { batchSize: 20, batchInterval: 1500 } }, timeout: 20000 } },
    id: 'bc-node-000017', name: 'Отправка', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [200, 0], onError: 'continueRegularOutput' },
  pg('Лог', 'bc-node-000018', [400, 0],
     "INSERT INTO proactive_log (bot_id,user_id,kind,sent_at) VALUES ($1,$2,'broadcast',now());",
     "={{ [ $('Аудитория').item.json.bot_id, $('Аудитория').item.json.user_id ] }}", { onError: 'continueRegularOutput' }),
  code('Итог', 'bc-node-000019', [600, 0], itogCode),
  ownerMsg('Отчёт', 'bc-node-000020', [800, 0], "=✅ Рассылка завершена.\nДоставлено: {{ $('Итог').first().json.ok }}\nОшибок/заблокировали: {{ $('Итог').first().json.fail }}\nВсего адресатов: {{ $('Итог').first().json.total }}"),
  pg('Очистить', 'bc-node-000021', [1000, 0],
     "DELETE FROM broadcast_pending WHERE bot_id=$1 AND owner_id=$2;",
     "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}"),
  ownerMsg('Нет черновика', 'bc-node-000022', [-200, 160], "=Нет готового черновика для рассылки. Сначала /broadcast <текст>, затем /broadcast_send."),

  // CANCEL
  pg('Удалить', 'bc-node-000023', [-600, 220],
     "DELETE FROM broadcast_pending WHERE bot_id=$1 AND owner_id=$2;",
     "={{ [ $('Триггер').first().json.owner_bot_id, $('Триггер').first().json.owner_chat_id ] }}"),
  ownerMsg('Отменено', 'bc-node-000024', [-400, 220], "=Черновик рассылки отменён.")
];

const c = {};
c['Триггер'] = { main: [ [ { node: 'Режим', type: 'main', index: 0 } ] ] };
c['Режим'] = { main: [ [ { node: 'Маршрут', type: 'main', index: 0 } ] ] };
c['Маршрут'] = { main: [
  [ { node: 'Есть текст?', type: 'main', index: 0 } ],
  [ { node: 'Загрузить', type: 'main', index: 0 } ],
  [ { node: 'Удалить', type: 'main', index: 0 } ]
] };
c['Есть текст?'] = { main: [ [ { node: 'Промпт полировки', type: 'main', index: 0 } ], [ { node: 'Ждём текст', type: 'main', index: 0 } ] ] };
c['Ждём текст'] = { main: [ [ { node: 'Спроси текст', type: 'main', index: 0 } ] ] };
c['Промпт полировки'] = { main: [ [ { node: 'Полировка', type: 'main', index: 0 } ] ] };
c['Полировка'] = { main: [ [ { node: 'Разбор', type: 'main', index: 0 } ] ] };
c['Разбор'] = { main: [ [ { node: 'Сохранить черновик', type: 'main', index: 0 } ] ] };
c['Сохранить черновик'] = { main: [ [ { node: 'Аудитория счёт', type: 'main', index: 0 } ] ] };
c['Аудитория счёт'] = { main: [ [ { node: 'Превью', type: 'main', index: 0 } ] ] };
c['Превью'] = { main: [ [ { node: 'Контроль', type: 'main', index: 0 } ] ] };
c['Загрузить'] = { main: [ [ { node: 'Есть черновик?', type: 'main', index: 0 } ] ] };
c['Есть черновик?'] = { main: [ [ { node: 'Аудитория', type: 'main', index: 0 } ], [ { node: 'Нет черновика', type: 'main', index: 0 } ] ] };
c['Аудитория'] = { main: [ [ { node: 'Локализация', type: 'main', index: 0 } ] ] };
c['Локализация'] = { main: [ [ { node: 'Отправка', type: 'main', index: 0 } ] ] };
c['Отправка'] = { main: [ [ { node: 'Лог', type: 'main', index: 0 } ] ] };
c['Лог'] = { main: [ [ { node: 'Итог', type: 'main', index: 0 } ] ] };
c['Итог'] = { main: [ [ { node: 'Отчёт', type: 'main', index: 0 } ] ] };
c['Отчёт'] = { main: [ [ { node: 'Очистить', type: 'main', index: 0 } ] ] };
c['Удалить'] = { main: [ [ { node: 'Отменено', type: 'main', index: 0 } ] ] };

const wf = { id: 'Broadcast01', name: 'Рассылка — сервисные уведомления', active: true, nodes, connections: c, settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001' } };
fs.writeFileSync(out, JSON.stringify([wf], null, 2));
console.log('OK: Broadcast01 записан в ' + out + ' (узлов: ' + nodes.length + ')');
