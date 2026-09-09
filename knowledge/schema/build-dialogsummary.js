#!/usr/bin/env node
/*
 * Собирает воркфлоу DialogSummary01 «Память — скользящая сводка диалога»:
 * каждые 30 мин находит сессии с ≥8 новыми сообщениями сверх водяного знака dialog_summary,
 * Haiku обновляет короткую сводку нити (что обсуждали/договорились, с датами),
 * upsert в dialog_summary. Тест-диапазон 999000–999999 исключён.
 * Структура — клон MemoryExtract001 (fan-out Промпт/Разобрать с pairedItem).
 * Запуск: node build-dialogsummary.js <output.json>
 */
const fs = require('fs');
const out = process.argv[2] || '/tmp/deploy/ds-work.json';

const sessQuery = `SELECT c.bot_id, c.user_id, c.max_id, c.last_id, c.current_summary, (SELECT string_agg(line, E'\\n' ORDER BY sid) FROM (SELECT h2.id AS sid, '[' || to_char(h2.created_at, 'YYYY-MM-DD') || '] ' || CASE WHEN h2.message->>'type'='human' THEN 'КЛИЕНТ: ' ELSE 'БОТ: ' END || left(h2.message->>'content', 500) AS line FROM n8n_chat_histories h2 WHERE h2.session_id = c.bot_id||':'||c.user_id AND h2.id > c.last_id AND h2.id <= c.max_id AND h2.message->>'type' IN ('human','ai') ORDER BY h2.id DESC LIMIT 120) s) AS transcript FROM (SELECT split_part(h.session_id,':',1) AS bot_id, split_part(h.session_id,':',2)::bigint AS user_id, max(h.id) AS max_id, coalesce(max(ds.last_message_id),0) AS last_id, max(ds.summary_text) AS current_summary, count(*) FILTER (WHERE h.id > coalesce(ds.last_message_id,0)) AS new_cnt FROM n8n_chat_histories h LEFT JOIN dialog_summary ds ON ds.bot_id=split_part(h.session_id,':',1) AND ds.user_id=split_part(h.session_id,':',2)::bigint WHERE h.session_id ~ '^[^:]+:[0-9]+$' AND NOT (split_part(h.session_id,':',2)::bigint BETWEEN 999000 AND 999999) GROUP BY 1,2 HAVING max(h.id) > coalesce(max(ds.last_message_id),0) AND count(*) FILTER (WHERE h.id > coalesce(ds.last_message_id,0)) >= 8) c;`;

const promptCode = `const items = $input.all();
const system = 'Ты — модуль сводки диалога персонального фитнес-бота. Веди СКОЛЬЗЯЩУЮ СВОДКУ переписки с клиентом: что обсуждали и о чём договорились в последние дни. Ответь ТОЛЬКО текстом обновлённой сводки, без пояснений и markdown-заголовков. Формат: короткие строки-маркеры, каждая начинается с даты [YYYY-MM-DD]. Включай: договорённости и решения, обещания бота, незакрытые вопросы, важный контекст (командировка, самочувствие, смена планов). НЕ включай: перечисление съеденного/подходов/замеров (журналы лежат в базе), приветствия и пустую болтовню. Объедини со старой сводкой: устаревшее (старше ~7 дней) и потерявшее актуальность выкидывай. Максимум ~1200 символов.';
const out = [];
for (let i = 0; i < items.length; i++) {
  const d = items[i].json;
  const transcript = String(d.transcript || '').trim();
  if (!transcript) continue;
  const cur = String(d.current_summary || '').trim() || '(сводки пока нет)';
  const user = 'ТЕКУЩАЯ СВОДКА НИТИ:\\n' + cur + '\\n\\nНОВЫЕ СООБЩЕНИЯ (могут идти с конца, ориентируйся на даты):\\n' + transcript;
  const body = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: system, messages: [{ role: 'user', content: user }] });
  out.push({ json: { bot_id: d.bot_id, user_id: d.user_id, max_id: d.max_id, body: body }, pairedItem: { item: i } });
}
return out;`;

const parseCode = `const out = [];
const inp = $input.all();
const prompts = $('Промпт').all();
for (let i = 0; i < inp.length; i++) {
  const r = inp[i].json;
  const p = prompts[i].json;
  let text = '';
  try { text = r.content[0].text; } catch (e) { text = ''; }
  text = String(text).trim().slice(0, 2500);
  if (!text) continue;
  out.push({ json: { bot_id: p.bot_id, user_id: p.user_id, max_id: p.max_id, summary: text }, pairedItem: { item: i } });
}
return out;`;

const saveQuery = `INSERT INTO dialog_summary (bot_id, user_id, summary_text, last_message_id, updated_at) SELECT $1, $2, $3, $4, now() WHERE EXISTS (SELECT 1 FROM clients WHERE bot_id=$1) ON CONFLICT (bot_id, user_id) DO UPDATE SET summary_text = EXCLUDED.summary_text, last_message_id = EXCLUDED.last_message_id, updated_at = now();`;

const wf = {
  id: 'DialogSummary01',
  name: 'Память — скользящая сводка диалога',
  active: true,
  isArchived: false,
  nodes: [
    { parameters: { rule: { interval: [{ field: 'cronExpression', expression: '7,37 * * * *' }] } },
      id: 's1000000-0000-4000-8000-000000000001', name: 'Каждые полчаса',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-800, 0] },
    { parameters: { operation: 'executeQuery', query: sessQuery, options: {} },
      id: 's1000000-0000-4000-8000-000000000002', name: 'Сессии',
      type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-560, 0],
      credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } } },
    { parameters: { jsCode: promptCode },
      id: 's1000000-0000-4000-8000-000000000003', name: 'Промпт',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [-320, 0] },
    { parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi', sendHeaders: true, headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] }, sendBody: true, specifyBody: 'json', jsonBody: '={{ $json.body }}', options: { timeout: 120000, retry: { retry: { maxTries: 3, waitBetweenTries: 3000 } } } },
      id: 's1000000-0000-4000-8000-000000000004', name: 'Сводить',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [-80, 0],
      credentials: { anthropicApi: { id: 'J8w0oAhcMJCaC4PY', name: 'Anthropic account' } } },
    { parameters: { jsCode: parseCode },
      id: 's1000000-0000-4000-8000-000000000005', name: 'Разобрать',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [160, 0] },
    { parameters: { operation: 'executeQuery', query: saveQuery, options: { queryReplacement: '={{ [$json.bot_id, $json.user_id, $json.summary, $json.max_id] }}' } },
      id: 's1000000-0000-4000-8000-000000000006', name: 'Сохранить',
      type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [400, 0],
      credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } } }
  ],
  connections: {
    'Каждые полчаса': { main: [[{ node: 'Сессии', type: 'main', index: 0 }]] },
    'Сессии': { main: [[{ node: 'Промпт', type: 'main', index: 0 }]] },
    'Промпт': { main: [[{ node: 'Сводить', type: 'main', index: 0 }]] },
    'Сводить': { main: [[{ node: 'Разобрать', type: 'main', index: 0 }]] },
    'Разобрать': { main: [[{ node: 'Сохранить', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1', executionTimeout: 600, errorWorkflow: 'ErrorNotify00001' },
  staticData: null, meta: null, pinData: null
};
fs.writeFileSync(out, JSON.stringify([wf], null, 2));
console.log('OK: DialogSummary01 →', out);
