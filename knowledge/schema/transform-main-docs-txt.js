#!/usr/bin/env node
/*
 * ДОКУМЕНТЫ, часть 2.1 — TXT (чтение для ответа).
 *
 * Ветка Switch out4 (docother) раньше → «Док: формат» (общий отказ).
 * Теперь: out4 → «Док: тип» (роутер):
 *   - txt (text/*, json/xml/csv/yaml или расширение) → размер-гейт → getFile →
 *     download(responseFormat=text) → Code (текст→message.text, кап 50k) → AI Agent
 *   - прочее → «Док: формат» (вежливый отказ; PDF/DOCX подключим в 2.2/2.3)
 * Отказоустойчивость: слишком большой → «Док: большой»; сбой getFile/download →
 * «Док: сбой»; пустой/нечитаемый → сообщение без краша. message.text всегда
 * непустой (урок «No prompt specified»).
 *
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

const need = ['Switch', 'Док: формат', 'AI Agent', 'Normalize', 'Load Config'];
for (const n of need) if (!nodes.find(x => x.name === n)) throw new Error('нет узла ' + n);

function upsert(name, type, typeVersion, parameters, position, onError) {
  let n = nodes.find(x => x.name === name);
  if (!n) {
    n = { parameters, id: 'doc-' + name.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 14) + '-2a1', name, type, typeVersion, position };
    if (onError) n.onError = onError;
    nodes.push(n);
    console.log('+ узел', name);
  } else {
    n.parameters = parameters; n.type = type; n.typeVersion = typeVersion; n.position = position;
    if (onError) n.onError = onError; else delete n.onError;
    console.log('~ узел обновлён', name);
  }
  return n;
}

const txtRule = "={{ ($json.message.document.mime_type || '').toLowerCase().startsWith('text/') || ['application/json','application/xml','application/csv','application/x-yaml','application/yaml'].includes(($json.message.document.mime_type||'').toLowerCase()) || /\\.(txt|md|markdown|csv|tsv|log|json|xml|ya?ml)$/.test(($json.message.document.file_name||'').toLowerCase()) }}";

upsert('Док: тип', 'n8n-nodes-base.switch', 3.4, {
  rules: { values: [
    { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
      conditions: [ { id: 'dt-txt', leftValue: txtRule, rightValue: 'true', operator: { type: 'string', operation: 'equals' } } ] },
      renameOutput: true, outputKey: 'txt' }
  ] },
  options: { fallbackOutput: 'extra' }
}, [-320, 1160]);

upsert('Док: txt размер?', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
    conditions: [ { id: 'dsz', leftValue: '={{ ($json.message.document.file_size || 0) <= 200000 }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } } ] },
  options: {}
}, [-100, 1160]);

upsert('Док: getFile', 'n8n-nodes-base.httpRequest', 4.4, {
  url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/getFile?file_id={{ $('Normalize').first().json.message.document.file_id }}",
  options: { timeout: 20000 }
}, [120, 1120], 'continueErrorOutput');

upsert('Док: download', 'n8n-nodes-base.httpRequest', 4.4, {
  url: "=https://api.telegram.org/file/bot{{ $('Load Config').first().json.bot_token }}/{{ $json.result.file_path }}",
  options: { response: { response: { responseFormat: 'text' } }, timeout: 60000 }
}, [340, 1120], 'continueErrorOutput');

upsert('Док: текст', 'n8n-nodes-base.code', 2, {
  jsCode: [
    "const norm = $('Normalize').first().json.message || {};",
    "const cap = String(norm.caption || '').trim();",
    "const fname = String((norm.document && norm.document.file_name) || 'документ.txt');",
    "const inp = $input.first().json || {};",
    "let content = typeof inp === 'string' ? inp : String(inp.data != null ? inp.data : (inp.body != null ? inp.body : ''));",
    "content = content.replace(/\\u0000/g, '').replace(/\\r\\n/g, '\\n').trim();",
    "const LIMIT = 50000;",
    "let note = '';",
    "if (content.length > LIMIT) { content = content.slice(0, LIMIT); note = '\\n\\n[Документ длиннее лимита — прочитаны первые ' + LIMIT + ' символов.]'; }",
    "let text;",
    "if (!content) {",
    "  text = 'Клиент прислал текстовый файл «' + fname + '», но он оказался пустым или нечитаемым. Скажи об этом мягко и предложи прислать текст прямо сообщением.';",
    "} else {",
    "  const ask = cap || 'Клиент прислал текстовый документ на разбор. Прочитай его и помоги в рамках своих функций (тренировки, техника, питание, прогресс, восстановление) и границ безопасности.';",
    "  text = ask + '\\n\\n[Содержимое документа «' + fname + '»]:\\n' + content + note;",
    "}",
    "return [{ json: { message: Object.assign({}, norm, { text }) } }];"
  ].join('\n')
}, [560, 1120]);

function refusal(name, msg, pos) {
  upsert(name, 'n8n-nodes-base.httpRequest', 4.4, {
    method: 'POST',
    url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage",
    sendBody: true,
    bodyParameters: { parameters: [
      { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" },
      { name: 'text', value: msg }
    ] },
    options: { timeout: 20000 }
  }, pos, 'continueRegularOutput');
}
refusal('Док: большой', 'Текстовый файл великоват 📄 Пришли покороче или вставь ключевую часть прямо сообщением.', [120, 1320]);
refusal('Док: сбой', 'Не смог открыть этот файл 😕 Попробуй ещё раз или пришли текст прямо сообщением.', [340, 1320]);

// --- связи ---
function set(from, arr) { conns[from] = { main: arr }; }
const mk = (node, index = 0) => ({ node, type: 'main', index });

// Switch out4 (docother): Док: формат -> Док: тип
const sm = conns['Switch'].main;
sm[4] = [ mk('Док: тип') ];
console.log('Switch out4 ->', JSON.stringify(sm[4]));

set('Док: тип', [ [ mk('Док: txt размер?') ], [ mk('Док: формат') ] ]);
set('Док: txt размер?', [ [ mk('Док: getFile') ], [ mk('Док: большой') ] ]);
set('Док: getFile', [ [ mk('Док: download') ], [ mk('Док: сбой') ] ]);
set('Док: download', [ [ mk('Док: текст') ], [ mk('Док: сбой') ] ]);
set('Док: текст', [ [ mk('AI Agent') ] ]);

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
