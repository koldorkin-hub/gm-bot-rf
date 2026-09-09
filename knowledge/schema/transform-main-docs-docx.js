#!/usr/bin/env node
/*
 * ДОКУМЕНТЫ, часть 2.3 — DOCX (через Gotenberg LibreOffice → PDF → document-вызов).
 *
 * Роутер «Док: тип» получает ветку docx (mime wordprocessingml/msword или .doc/.docx):
 *   docx → «Док: docx размер?»(≤20МБ) → getFile → download(бинарь) →
 *   «Док: docx имя»(Code: выставить binary fileName=*.docx — Gotenberg определяет
 *      формат по расширению) → «Док: docx→pdf»(HTTP Gotenberg /forms/libreoffice/convert,
 *      multipart, ответ file в свойство `data`) → ВЛИВАЕТСЯ в существующий «Док: pdf
 *      подготовка» (base64+страницы) → pdf вызов → разбор → агент.
 * Сбои getFile/download/имя/конвертации → «Док: сбой»; большой → «Док: большой».
 * Gotenberg DOCX→PDF проверен живьём (HTTP 200, валидный %PDF). Требует части 2.1+2.2.
 *
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

for (const n of ['Док: тип', 'Док: формат', 'Док: большой', 'Док: сбой', 'Док: pdf подготовка', 'Normalize', 'Load Config'])
  if (!nodes.find(x => x.name === n)) throw new Error('нет узла ' + n + ' (сначала части 2.1+2.2)');

function upsert(name, type, typeVersion, parameters, position, onError) {
  let n = nodes.find(x => x.name === name);
  if (!n) {
    n = { parameters, id: 'docdocx-' + Math.abs([...name].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 11)).toString(16), name, type, typeVersion, position };
    if (onError) n.onError = onError;
    nodes.push(n); console.log('+', name);
  } else {
    n.parameters = parameters; n.type = type; n.typeVersion = typeVersion; n.position = position;
    if (onError) n.onError = onError; else delete n.onError;
    console.log('~', name);
  }
}

// --- роутер: правила txt + pdf + docx ---
const router = nodes.find(x => x.name === 'Док: тип');
const txtRule = "={{ ($json.message.document.mime_type || '').toLowerCase().startsWith('text/') || ['application/json','application/xml','application/csv','application/x-yaml','application/yaml'].includes(($json.message.document.mime_type||'').toLowerCase()) || /\\.(txt|md|markdown|csv|tsv|log|json|xml|ya?ml)$/.test(($json.message.document.file_name||'').toLowerCase()) }}";
const pdfRule = "={{ ($json.message.document.mime_type || '').toLowerCase() === 'application/pdf' || /\\.pdf$/.test(($json.message.document.file_name||'').toLowerCase()) }}";
const docxRule = "={{ ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'].includes(($json.message.document.mime_type||'').toLowerCase()) || /\\.docx?$/.test(($json.message.document.file_name||'').toLowerCase()) }}";
const mkRule = (id, expr, key) => ({ conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and', conditions: [{ id, leftValue: expr, rightValue: 'true', operator: { type: 'string', operation: 'equals' } }] }, renameOutput: true, outputKey: key });
router.parameters = { rules: { values: [ mkRule('dt-txt', txtRule, 'txt'), mkRule('dt-pdf', pdfRule, 'pdf'), mkRule('dt-docx', docxRule, 'docx') ] }, options: { fallbackOutput: 'extra' } };
console.log('~ Док: тип (txt+pdf+docx)');

upsert('Док: docx размер?', 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, combinator: 'and',
    conditions: [{ id: 'dxsz', leftValue: '={{ ($json.message.document.file_size || 0) <= 20000000 }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }] }, options: {}
}, [-100, 1960]);

upsert('Док: docx getFile', 'n8n-nodes-base.httpRequest', 4.4, {
  url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/getFile?file_id={{ $('Normalize').first().json.message.document.file_id }}",
  options: { timeout: 20000 }
}, [120, 1940], 'continueErrorOutput');

upsert('Док: docx download', 'n8n-nodes-base.httpRequest', 4.4, {
  url: "=https://api.telegram.org/file/bot{{ $('Load Config').first().json.bot_token }}/{{ $json.result.file_path }}",
  options: { response: { response: { responseFormat: 'file' } }, timeout: 60000 }
}, [340, 1940], 'continueErrorOutput');

upsert('Док: docx имя', 'n8n-nodes-base.code', 2, {
  jsCode: [
    "const item = $input.first();",
    "const norm = $('Normalize').first().json.message || {};",
    "let fn = String((norm.document && norm.document.file_name) || 'document.docx');",
    "if (!/\\.docx?$/i.test(fn)) fn = 'document.docx';",
    "const bin = item.binary && item.binary.data;",
    "if (!bin) throw new Error('нет бинарника docx');",
    "return [{ json: item.json, binary: { data: Object.assign({}, bin, { fileName: fn, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) } }];"
  ].join('\n')
}, [560, 1940], 'continueErrorOutput');

upsert('Док: docx→pdf', 'n8n-nodes-base.httpRequest', 4.4, {
  method: 'POST', url: 'http://gotenberg:3000/forms/libreoffice/convert',
  sendBody: true, contentType: 'multipart-form-data',
  bodyParameters: { parameters: [ { parameterType: 'formBinaryData', name: 'files', inputDataFieldName: 'data' } ] },
  options: { timeout: 120000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } }
}, [780, 1940], 'continueErrorOutput');

// --- связи ---
const mk = (node, index = 0) => ({ node, type: 'main', index });
const set = (from, arr) => { conns[from] = { main: arr }; };

set('Док: тип', [ [ mk('Док: txt размер?') ], [ mk('Док: pdf размер?') ], [ mk('Док: docx размер?') ], [ mk('Док: формат') ] ]);
set('Док: docx размер?', [ [ mk('Док: docx getFile') ], [ mk('Док: большой') ] ]);
set('Док: docx getFile', [ [ mk('Док: docx download') ], [ mk('Док: сбой') ] ]);
set('Док: docx download', [ [ mk('Док: docx имя') ], [ mk('Док: сбой') ] ]);
set('Док: docx имя', [ [ mk('Док: docx→pdf') ], [ mk('Док: сбой') ] ]);
set('Док: docx→pdf', [ [ mk('Док: pdf подготовка') ], [ mk('Док: сбой') ] ]);

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
