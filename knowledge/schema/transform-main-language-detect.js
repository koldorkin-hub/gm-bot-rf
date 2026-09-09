#!/usr/bin/env node
/*
 * Детерминированное СОХРАНЕНИЕ языка. Была проблема: агент не всегда вызывал
 * save_profile(language) при ответе → застревало в '__ASKING__'. Теперь ответ
 * пользователя (language='__ASKING__') обрабатывается детерминированно:
 *   определить (haiku, ТОЛЬКО название языка/UNCLEAR) → сохранить в client_profile
 *   → дальше обычный поток (Load Profile видит новый язык → агент приветствует на нём).
 * Невнятный ответ → переспрос. /language и первый вопрос — как раньше.
 *
 * Маршрут: маршрут[not-ask] → Язык: отвечает?(__ASKING__?) → [да] запрос→определить→
 *   разобрать→ясно?→[ясно] сохранить→Пачка: занят? /[невнятно] вопрос(стоп);
 *   [нет=готов] → Пачка: занят?. Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

for (const n of ['Язык: маршрут', 'Язык: вопрос', 'Пачка: занят?', 'Normalize', 'Load Config'])
  if (!nodes.find(x => x.name === n)) throw new Error('нет узла ' + n + ' (сначала языковой гейт)');

const PGCRED = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const ANTHCRED = { anthropicApi: { id: 'J8w0oAhcMJCaC4PY', name: 'Anthropic account' } };
const bot = "$('Load Config').first().json.bot_id";
const uid = "$('Normalize').first().json.message.from.id";
const DETECT_SYS = 'You detect which language a user wants to chat in. They were asked to pick a language. Given their reply, output ONLY the language name in English: Russian, English, Spanish, German, French, Italian, Portuguese, Turkish, Chinese, Arabic, Ukrainian, Polish, etc. If the reply does not clearly indicate a language preference, output exactly the word UNCLEAR. Output only the single language word, nothing else.';

function upsert(name, type, tv, parameters, position, onError, credentials) {
  let n = nodes.find(x => x.name === name);
  if (!n) {
    n = { parameters, id: 'lgd-' + Math.abs([...name].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)).toString(16), name, type, typeVersion: tv, position };
    if (onError) n.onError = onError; if (credentials) n.credentials = credentials;
    nodes.push(n); console.log('+', name);
  } else { n.parameters = parameters; n.type = type; n.typeVersion = tv; n.position = position; if (onError) n.onError = onError; else delete n.onError; if (credentials) n.credentials = credentials; console.log('~', name); }
}

upsert('Язык: отвечает?', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
    conditions: [{ id: 'ans', leftValue: "={{ ($('Язык: чек').first().json.lang || '') === '__ASKING__' }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {}
}, [-460, -120]);

upsert('Язык: запрос', 'n8n-nodes-base.code', 2, {
  jsCode: [
    "const text = String($('Normalize').first().json.message.text || '').slice(0, 200);",
    "const payload = { model: 'claude-haiku-4-5', max_tokens: 20, system: " + JSON.stringify(DETECT_SYS) + ", messages: [{ role: 'user', content: text || '(empty)' }] };",
    "return [{ json: { payload } }];"
  ].join('\n')
}, [-280, -60]);

upsert('Язык: определить', 'n8n-nodes-base.httpRequest', 4.4, {
  method: 'POST', url: 'https://api.anthropic.com/v1/messages',
  authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi',
  sendHeaders: true, headerParameters: { parameters: [ { name: 'anthropic-version', value: '2023-06-01' }, { name: 'content-type', value: 'application/json' } ] },
  sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.payload) }}',
  options: { timeout: 30000 }
}, [-100, -60], 'continueErrorOutput', ANTHCRED);

upsert('Язык: разобрать', 'n8n-nodes-base.code', 2, {
  jsCode: [
    "const resp = $input.first().json || {};",
    "let lang = ((resp.content||[]).filter(b=>b&&b.type==='text').map(b=>b.text).join('')||'').trim();",
    "lang = lang.replace(/[^A-Za-zА-Яа-яЁё \\-]/g,'').trim();",
    "const unclear = !lang || /unclear/i.test(lang) || lang.length > 30;",
    "return [{ json: { lang: unclear ? '' : lang, unclear } }];"
  ].join('\n')
}, [80, -60], 'continueRegularOutput');

upsert('Язык: ясно?', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
    conditions: [{ id: 'clr', leftValue: '={{ $json.unclear === false }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {}
}, [260, -60]);

upsert('Язык: сохранить', 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery',
  query: "UPDATE client_profile SET language=$3, updated_at=now() WHERE bot_id=$1 AND user_id=$2;",
  options: { queryReplacement: "={{ [ " + bot + ", " + uid + ", $json.lang ] }}" }
}, [440, -100], undefined, PGCRED);

// --- связи ---
const mk = (node, index = 0) => ({ node, type: 'main', index });
const set = (from, arr) => { conns[from] = { main: arr }; };
// маршрут[not-ask] (out1) -> Язык: отвечает?  (out0 ask -> пометить остаётся)
conns['Язык: маршрут'].main[1] = [ mk('Язык: отвечает?') ];
set('Язык: отвечает?', [ [ mk('Язык: запрос') ], [ mk('Пачка: занят?') ] ]);
set('Язык: запрос', [ [ mk('Язык: определить') ] ]);
set('Язык: определить', [ [ mk('Язык: разобрать') ], [ mk('Язык: разобрать') ] ]);
set('Язык: разобрать', [ [ mk('Язык: ясно?') ] ]);
set('Язык: ясно?', [ [ mk('Язык: сохранить') ], [ mk('Язык: вопрос') ] ]);
set('Язык: сохранить', [ [ mk('Пачка: занят?') ] ]);
console.log('маршрут[not-ask] -> отвечает? -> [запрос→определить→разобрать→ясно?→(сохранить→занят? / вопрос)] / занят?');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
