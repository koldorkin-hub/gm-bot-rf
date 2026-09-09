/**
 * DiagWatch01 — сторож. Каждые 15 минут гоняет SelfDiag01 и, если стало красным,
 * сам пишет владельцу через саппорт-бот. При восстановлении шлёт «полегчало».
 *
 * Почему сторож важнее команды /diag: чтобы спросить «что случилось», надо сначала
 * заметить, что случилось. 15.08 бот молчал ~6 часов именно потому, что никто не смотрел.
 *
 * Анти-спам — таблица ops_alert (не staticData: его стирает деплой).
 * Тревогу шлёт узел Telegram с credential SupportTg0000001: токен лежит в SQLite n8n,
 * поэтому тревога уйдёт даже если Postgres лежит и токен из базы не прочитать.
 *
 * Сборка:  node schema/build-diagwatch.js   -> schema/DiagWatch01.json
 */
const fs = require('fs');
const path = require('path');

const CRED_PG = { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' };
const CRED_TG = { id: 'SupportTg0000001', name: 'Telegram Support Bot' };
const OWNER_CHAT = '255171226';

// Снимок прошлого состояния + запись нового + подчистка старых записей журнала.
// old читает состояние ДО вставки (CTE видят один снимок) — так ловим переход red -> ok.
const SQL_STATE = [
  "WITH old AS (SELECT status FROM diag_state WHERE k='main'),",
  'upd AS (',
  "  INSERT INTO diag_state (k, status, changed_at, details) VALUES ('main', $1, now(), $2)",
  '  ON CONFLICT (k) DO UPDATE SET status = EXCLUDED.status, details = EXCLUDED.details,',
  '    changed_at = CASE WHEN diag_state.status <> EXCLUDED.status THEN now() ELSE diag_state.changed_at END',
  '  RETURNING status',
  '),',
  "cl AS (DELETE FROM ops_error WHERE at < now() - interval '30 days' RETURNING 1)",
  "SELECT COALESCE((SELECT status FROM old), 'none') AS prev,",
  '       COALESCE((SELECT status FROM upd), $1) AS cur,',
  '       (SELECT count(*) FROM cl) AS purged;',
].join('\n');

// Вернул строку — слать можно (и окно сдвинуто). Ноль строк — подавлено,
// узел тревоги просто не исполнится, потому что на входе нет items.
const SQL_ANTISPAM = [
  "INSERT INTO ops_alert (kind, last_at) VALUES ('diag_red', now())",
  '  ON CONFLICT (kind) DO UPDATE SET last_at = now()',
  "  WHERE ops_alert.last_at < now() - interval '30 minutes'",
  '  RETURNING kind;',
].join('\n');

// У всплеска клиентских сбоёв своё окно — шире, чем у аварии инфраструктуры:
// такие вещи чинятся правкой промпта или инструмента, а не сами собой за полчаса.
const SQL_ANTISPAM_ERR = [
  "INSERT INTO ops_alert (kind, last_at) VALUES ('diag_errors', now())",
  '  ON CONFLICT (kind) DO UPDATE SET last_at = now()',
  "  WHERE ops_alert.last_at < now() - interval '3 hours'",
  '  RETURNING kind;',
].join('\n');

// После восстановления окно анти-спама сбрасываем, иначе следующий сбой
// в ближайшие 30 минут будет молча подавлен. Возвращаем строку ВСЕГДА.
const SQL_RESET = [
  "WITH d AS (DELETE FROM ops_alert WHERE kind = 'diag_red' RETURNING 1)",
  'SELECT COALESCE((SELECT count(*) FROM d), 0) AS cleared;',
].join('\n');

const CODE_DECIDE = String.raw`
const diag = (() => { try { return $('Сторож: диагностика').first().json || {}; } catch (e) { return {}; } })();
const st = $input.first().json || {};
const prev = String(st.prev || 'none');
const cur = String(st.cur || diag.status || 'none');

// Узел Telegram умеет только Markdown/HTML — режима «без разметки» нет.
// В тексте ошибок попадаются & < >, на них Telegram роняет сообщение целиком.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const checks = Array.isArray(diag.checks) ? diag.checks : [];
const errSpike = checks.some((c) => c && c.key === 'errors');

let send = false, kind = 'none', text = '';
if (cur === 'red') {
  send = true; kind = 'red';
  text = '🔴 Сторож: в системе сбой\n\n' + esc(diag.text || 'нет деталей');
} else if (prev === 'red') {
  send = true; kind = 'recovered';
  text = '✅ Сторож: система восстановилась\n\n' + esc(diag.text || '');
} else if (errSpike) {
  // Инфраструктура зелёная, но у клиентов что-то не работает — отдельный класс,
  // своё окно анти-спама. Без этого сбои вроде «потолка шагов» проходят мимо тревог.
  send = true; kind = 'errors';
  text = '⚠️ Сторож: сбои у клиентов при живой инфраструктуре\n\n' + esc(diag.text || '');
}
// Прочие warn намеренно не будят: копятся в отчёте, будить ими незачем.
return [{ json: { send, kind, text, prev, cur } }];
`.trim();

const ifBool = (id, field) => ({
  conditions: {
    options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
    combinator: 'and',
    conditions: [{
      id,
      leftValue: '={{ $json.' + field + ' }}',
      rightValue: '',
      operator: { type: 'boolean', operation: 'true', singleValue: true },
    }],
  },
  options: {},
});

const wf = {
  id: 'DiagWatch00001',
  name: 'Диагностика — сторож',
  active: true,
  nodes: [
    {
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '*/15 * * * *' }] } },
      id: 'dw000000-0000-4000-8000-000000000001',
      name: 'Сторож: расписание',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-820, 0],
    },
    {
      parameters: {
        workflowId: { __rl: true, value: 'SelfDiag000001', mode: 'list', cachedResultName: 'Диагностика — проверка системы' },
        workflowInputs: { mappingMode: 'defineBelow', value: { source: 'watchdog' } },
        options: {},
      },
      id: 'dw000000-0000-4000-8000-000000000002',
      name: 'Сторож: диагностика',
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1.2,
      position: [-600, 0],
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: SQL_STATE,
        options: { queryReplacement: "={{ [ $json.status, String($json.summary || '').slice(0,300) ] }}" },
      },
      id: 'dw000000-0000-4000-8000-000000000003',
      name: 'Сторож: состояние',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-380, 0],
      credentials: { postgres: CRED_PG },
    },
    {
      parameters: { jsCode: CODE_DECIDE },
      id: 'dw000000-0000-4000-8000-000000000004',
      name: 'Сторож: решение',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-160, 0],
    },
    {
      parameters: ifBool('w1', 'send'),
      id: 'dw000000-0000-4000-8000-000000000005',
      name: 'Сторож: слать?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [60, 0],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
          combinator: 'and',
          conditions: [{
            id: 'w2',
            leftValue: '={{ $json.kind }}',
            rightValue: 'red',
            operator: { type: 'string', operation: 'equals' },
          }],
        },
        options: {},
      },
      id: 'dw000000-0000-4000-8000-000000000006',
      name: 'Сторож: красное?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [280, 0],
    },
    {
      parameters: { operation: 'executeQuery', query: SQL_ANTISPAM, options: {} },
      id: 'dw000000-0000-4000-8000-000000000007',
      name: 'Сторож: анти-спам',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [500, -120],
      credentials: { postgres: CRED_PG },
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
          combinator: 'and',
          conditions: [{
            id: 'w3',
            leftValue: '={{ $json.kind }}',
            rightValue: 'errors',
            operator: { type: 'string', operation: 'equals' },
          }],
        },
        options: {},
      },
      id: 'dw000000-0000-4000-8000-000000000010',
      name: 'Сторож: ошибки?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [500, 140],
    },
    {
      parameters: { operation: 'executeQuery', query: SQL_ANTISPAM_ERR, options: {} },
      id: 'dw000000-0000-4000-8000-000000000011',
      name: 'Сторож: анти-спам ошибок',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [720, 60],
      credentials: { postgres: CRED_PG },
    },
    {
      parameters: { operation: 'executeQuery', query: SQL_RESET, options: {} },
      id: 'dw000000-0000-4000-8000-000000000008',
      name: 'Сторож: сброс окна',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [720, 240],
      credentials: { postgres: CRED_PG },
      onError: 'continueRegularOutput',
    },
    {
      // Текст берём из «Сторож: решение», а НЕ из $json:
      // узлы Postgres выше заменяют item результатом запроса (грабля потока данных).
      parameters: {
        chatId: OWNER_CHAT,
        text: "={{ $('Сторож: решение').first().json.text }}",
        additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
      },
      id: 'dw000000-0000-4000-8000-000000000009',
      name: 'Сторож: алерт',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [740, 0],
      credentials: { telegramApi: CRED_TG },
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
    },
  ],
  connections: {
    'Сторож: расписание': { main: [[{ node: 'Сторож: диагностика', type: 'main', index: 0 }]] },
    'Сторож: диагностика': { main: [[{ node: 'Сторож: состояние', type: 'main', index: 0 }]] },
    'Сторож: состояние': { main: [[{ node: 'Сторож: решение', type: 'main', index: 0 }]] },
    'Сторож: решение': { main: [[{ node: 'Сторож: слать?', type: 'main', index: 0 }]] },
    'Сторож: слать?': { main: [[{ node: 'Сторож: красное?', type: 'main', index: 0 }], []] },
    'Сторож: красное?': {
      main: [
        [{ node: 'Сторож: анти-спам', type: 'main', index: 0 }],
        [{ node: 'Сторож: ошибки?', type: 'main', index: 0 }],
      ],
    },
    'Сторож: ошибки?': {
      main: [
        [{ node: 'Сторож: анти-спам ошибок', type: 'main', index: 0 }],
        [{ node: 'Сторож: сброс окна', type: 'main', index: 0 }],
      ],
    },
    'Сторож: анти-спам': { main: [[{ node: 'Сторож: алерт', type: 'main', index: 0 }]] },
    'Сторож: анти-спам ошибок': { main: [[{ node: 'Сторож: алерт', type: 'main', index: 0 }]] },
    'Сторож: сброс окна': { main: [[{ node: 'Сторож: алерт', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: 'ErrorNotify00001', executionTimeout: 240 },
};

const out = path.join(__dirname, 'DiagWatch01.json');
fs.writeFileSync(out, JSON.stringify([wf], null, 2), 'utf8');
console.log('OK ->', out, fs.statSync(out).size, 'байт,', wf.nodes.length, 'узлов');
