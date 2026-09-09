/**
 * Напоминания: инструмент агента (ReminderTool01) + тикер отправки (ReminderTick01).
 *
 * Повод (владелец, 20.08.2026): «не работают напоминания, даже если попросить —
 * бот просит завести будильник и написать первым».
 *
 * Принцип: время считает БАЗА, а не агент. Агент передаёт дату и время «как сказал
 * клиент» либо «через N минут», а перевод в UTC с учётом пояса клиента делает SQL
 * (`($1||' '||$2)::timestamp AT TIME ZONE tz`). После сегодняшней истории с датами
 * доверять арифметику модели нельзя.
 *
 * Отправленное напоминание пишется в историю диалога клиента — иначе бот не знает,
 * что он это сказал (тот же урок, что с /dm).
 *
 * Сборка:  node schema/build-reminder.js  ->  schema/ReminderTool01.json, ReminderTick01.json
 */
const fs = require('fs');
const path = require('path');

const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

/* ============================ ИНСТРУМЕНТ ============================ */

const CODE_PARAMS = String.raw`
const d = $input.first().json;
const action = String(d.action || 'create').trim().toLowerCase();
const bot = d.bot_id, uid = Number(d.user_id), chat = Number(d.chat_id) || null;
const tz = String(d.tz || '').trim() || 'Europe/Moscow';
const text = String(d.text || '').trim();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
const isTime = (s) => /^\d{1,2}:\d{2}$/.test(String(s || '').trim());
const pad = (s) => { const p = String(s).split(':'); return String(p[0]).padStart(2, '0') + ':' + p[1]; };

let query, params;

if (action === 'list') {
  query = "SELECT id, to_char(fire_at AT TIME ZONE $3, 'DD.MM HH24:MI') AS kogda, text, repeat_rule" +
          " FROM reminder WHERE bot_id=$1 AND user_id=$2 AND status='pending' ORDER BY fire_at LIMIT 20";
  params = [bot, uid, tz];
  return [{ json: { query, params, action } }];
}

if (action === 'cancel') {
  const id = Number(d.id);
  if (!isFinite(id)) throw new Error('для отмены нужен id напоминания - сначала вызови action=list');
  query = "UPDATE reminder SET status='cancelled' WHERE id=$1 AND bot_id=$2 AND user_id=$3 RETURNING id, text";
  params = [id, bot, uid];
  return [{ json: { query, params, action } }];
}

// создание
if (!text) throw new Error('нужен текст напоминания');
const mins = Number(d.in_minutes);
const rep = ['daily', 'weekly'].includes(String(d.repeat || '').trim()) ? String(d.repeat).trim() : 'none';

if (isFinite(mins) && mins > 0) {
  if (mins > 60 * 24 * 370) throw new Error('слишком далеко - максимум год');
  // Относительное время: считаем от now() базы, часовой пояс тут ни при чём.
  query = "INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule)" +
          " VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval, $5, $6)" +
          " RETURNING id, to_char(fire_at AT TIME ZONE $7, 'DD.MM HH24:MI') AS kogda";
  params = [bot, uid, chat, String(Math.round(mins)), text, rep, tz];
  return [{ json: { query, params, action: 'create' } }];
}

const dt = String(d.when_date || '').trim();
const tm = String(d.when_time || '').trim();
if (!isDate(dt) || !isTime(tm)) {
  throw new Error('нужна дата ГГГГ-ММ-ДД и время ЧЧ:ММ (бери дату из справки СЕГОДНЯ) либо in_minutes');
}
// Перевод местного времени клиента в UTC делает Postgres — не JS и не модель.
query = "INSERT INTO reminder (bot_id,user_id,chat_id,fire_at,text,repeat_rule)" +
        " VALUES ($1,$2,$3, ($4 || ' ' || $5)::timestamp AT TIME ZONE $6, $7, $8)" +
        " RETURNING id, to_char(fire_at AT TIME ZONE $6, 'DD.MM HH24:MI') AS kogda";
params = [bot, uid, chat, dt, pad(tm), tz, text, rep];
return [{ json: { query, params, action: 'create' } }];
`.trim();

const CODE_ANSWER = String.raw`
const act = $('Параметры').first().json.action;
const rows = $input.all().map(i => i.json).filter(r => r && (r.id || r.kogda));

if (act === 'list') {
  if (!rows.length) return [{ json: { response: 'Активных напоминаний нет.' } }];
  const list = rows.map(r => '#' + r.id + ' — ' + r.kogda + ' — ' + r.text +
    (r.repeat_rule && r.repeat_rule !== 'none' ? ' (повтор: ' + (r.repeat_rule === 'daily' ? 'ежедневно' : 'еженедельно') + ')' : '')).join('\n');
  return [{ json: { response: 'Активные напоминания:\n' + list } }];
}

if (act === 'cancel') {
  if (!rows.length) return [{ json: { response: 'Такого напоминания нет или оно уже закрыто.' } }];
  return [{ json: { response: 'Отменил напоминание #' + rows[0].id + '.' } }];
}

if (!rows.length) return [{ json: { response: 'Не удалось поставить напоминание.' } }];
return [{ json: { response: 'Напоминание поставлено на ' + rows[0].kogda + ' (время клиента), номер #' + rows[0].id +
  '. Оно придёт само, будильник заводить не нужно.' } }];
`.trim();

const tool = {
  id: 'ReminderTool01',
  name: 'Инструмент — Напоминания',
  active: false,
  nodes: [
    {
      parameters: {
        inputSource: 'workflowInputs',
        workflowInputs: {
          values: [
            { name: 'bot_id', type: 'string' }, { name: 'user_id', type: 'number' },
            { name: 'chat_id', type: 'number' }, { name: 'tz', type: 'string' },
            { name: 'action', type: 'string' }, { name: 'text', type: 'string' },
            { name: 'when_date', type: 'string' }, { name: 'when_time', type: 'string' },
            { name: 'in_minutes', type: 'number' }, { name: 'repeat', type: 'string' },
            { name: 'id', type: 'number' },
          ],
        },
      },
      id: 'rm000000-0000-4000-8000-000000000001',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.2,
      position: [-600, 0],
    },
    {
      parameters: { jsCode: CODE_PARAMS },
      id: 'rm000000-0000-4000-8000-000000000002',
      name: 'Параметры',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-380, 0],
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: '={{ $json.query }}',
        options: { queryReplacement: '={{ $json.params }}' },
      },
      id: 'rm000000-0000-4000-8000-000000000003',
      name: 'Данные',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-160, 0],
      credentials: PG,
      alwaysOutputData: true,
    },
    {
      parameters: { jsCode: CODE_ANSWER },
      id: 'rm000000-0000-4000-8000-000000000004',
      name: 'Ответ агенту',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [60, 0],
    },
  ],
  connections: {
    'When Executed by Another Workflow': { main: [[{ node: 'Параметры', type: 'main', index: 0 }]] },
    'Параметры': { main: [[{ node: 'Данные', type: 'main', index: 0 }]] },
    'Данные': { main: [[{ node: 'Ответ агенту', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001', executionTimeout: 120 },
};

/* ============================== ТИКЕР ============================== */

// Забираем ровно те, чей срок настал. Тестовый диапазон id не исключаем:
// напоминания ставит сам клиент, синтетика сюда не попадает случайно.
const SQL_DUE = [
  'SELECT r.id, r.bot_id, r.user_id, COALESCE(r.chat_id, r.user_id) AS chat_id, r.text,',
  '       r.repeat_rule, c.bot_token',
  '  FROM reminder r JOIN clients c ON c.bot_id = r.bot_id',
  " WHERE r.status = 'pending' AND r.fire_at <= now()",
  ' ORDER BY r.fire_at',
  ' LIMIT 50;',
].join('\n');

// Закрываем, пишем в диалог клиента и, если нужно, ставим следующий повтор — одним запросом.
// $3 = удалась ли отправка. Если Telegram отверг (клиент заблокировал бота), помечаем failed,
// в историю НЕ пишем и повтор НЕ ставим: иначе бот считал бы, что сказал то, чего клиент не видел.
const SQL_CLOSE = [
  'WITH done AS (',
  "  UPDATE reminder SET status = CASE WHEN $3 THEN 'sent' ELSE 'failed' END, sent_at = now()",
  "   WHERE id = $1 AND status = 'pending'",
  '   RETURNING bot_id, user_id, chat_id, text, repeat_rule, fire_at',
  '),',
  'hist AS (',
  '  INSERT INTO n8n_chat_histories (session_id, message)',
  "  SELECT bot_id || ':' || user_id, jsonb_build_object('type','ai','content', $2) FROM done WHERE $3",
  '),',
  'nxt AS (',
  '  INSERT INTO reminder (bot_id, user_id, chat_id, fire_at, text, repeat_rule)',
  '  SELECT bot_id, user_id, chat_id,',
  "         CASE repeat_rule WHEN 'daily' THEN fire_at + interval '1 day'",
  "                          ELSE fire_at + interval '7 days' END,",
  '         text, repeat_rule',
  "    FROM done WHERE $3 AND repeat_rule IN ('daily','weekly')",
  ')',
  'SELECT 1;',
].join('\n');

const tick = {
  id: 'ReminderTick01',
  name: 'Напоминания — отправка по расписанию',
  active: true,
  nodes: [
    {
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '*/5 * * * *' }] } },
      id: 'rt000000-0000-4000-8000-000000000001',
      name: 'Каждые 5 минут',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-600, 0],
    },
    {
      parameters: { operation: 'executeQuery', query: SQL_DUE, options: {} },
      id: 'rt000000-0000-4000-8000-000000000002',
      name: 'Напоминания: выборка',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-380, 0],
      credentials: PG,
    },
    {
      // neverError: заблокировавший бота клиент не должен ронять весь тик.
      parameters: {
        method: 'POST',
        url: '=https://api.telegram.org/bot{{ $json.bot_token }}/sendMessage',
        sendBody: true,
        bodyParameters: {
          parameters: [
            { name: 'chat_id', value: '={{ $json.chat_id }}' },
            { name: 'text', value: '={{ "⏰ Напоминание\\n\\n" + $json.text }}' },
          ],
        },
        options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true } } },
      },
      id: 'rt000000-0000-4000-8000-000000000003',
      name: 'Напоминания: отправить',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [-160, 0],
      onError: 'continueRegularOutput',
    },
    {
      // Значения берём через .item — узел выше вернул ответ Telegram, а не строку напоминания.
      parameters: {
        operation: 'executeQuery',
        query: SQL_CLOSE,
        options: {
          queryReplacement:
            '={{ [ $(\'Напоминания: выборка\').item.json.id, "⏰ Напоминание\\n\\n" + $(\'Напоминания: выборка\').item.json.text, ' +
            '($json.statusCode === 200 && $json.body && $json.body.ok === true) ] }}',
        },
      },
      id: 'rt000000-0000-4000-8000-000000000004',
      name: 'Напоминания: закрыть',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [60, 0],
      credentials: PG,
      onError: 'continueRegularOutput',
    },
  ],
  connections: {
    'Каждые 5 минут': { main: [[{ node: 'Напоминания: выборка', type: 'main', index: 0 }]] },
    'Напоминания: выборка': { main: [[{ node: 'Напоминания: отправить', type: 'main', index: 0 }]] },
    'Напоминания: отправить': { main: [[{ node: 'Напоминания: закрыть', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001', executionTimeout: 300 },
};

const out1 = path.join(__dirname, 'ReminderTool01.json');
const out2 = path.join(__dirname, 'ReminderTick01.json');
fs.writeFileSync(out1, JSON.stringify([tool], null, 2), 'utf8');
fs.writeFileSync(out2, JSON.stringify([tick], null, 2), 'utf8');
new Function(CODE_PARAMS);
new Function(CODE_ANSWER);
console.log('OK ->', out1, tool.nodes.length, 'узлов');
console.log('OK ->', out2, tick.nodes.length, 'узлов');
