#!/usr/bin/env node
/*
 * ФИКС длинного ответа: Telegram sendMessage режет на 4096 символов → ответ агента
 * >4096 давал «Bad request» + падение workflow + тревогу владельцу (exec 5387).
 *
 * Вставляем «Ответ: нарезка» между AI Agent[успех] и HTTP Request1: режем вывод
 * агента на куски ≤4000 (по границам абзацев → строк → жёстко), эмитим по item на
 * кусок. HTTP Request1 шлёт по сообщению на item (chat_id/text из item),
 * onError=continueRegularOutput (сбой куска не роняет и не тревожит).
 *
 * Общий путь ответа — чинит длинные разборы для текста/голоса/фото/документов.
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const nodes = wf.nodes, conns = wf.connections;

const agent = nodes.find(n => n.name === 'AI Agent');
const reply = nodes.find(n => n.name === 'HTTP Request1');
const norm = nodes.find(n => n.name === 'Normalize');
if (!agent || !reply || !norm) throw new Error('нет AI Agent / HTTP Request1 / Normalize');

const jsCode = [
  "const out = String(($('AI Agent').first().json.output) || '').trim();",
  "const chat_id = $('Normalize').first().json.message.chat.id;",
  "const MAX = 4000;",
  "function split(text){",
  "  if (text.length <= MAX) return [text];",
  "  const chunks = []; let buf = '';",
  "  const push = () => { if (buf) { chunks.push(buf); buf = ''; } };",
  "  for (let para of text.split('\\n\\n')) {",
  "    const cand = buf ? buf + '\\n\\n' + para : para;",
  "    if (cand.length <= MAX) { buf = cand; continue; }",
  "    push();",
  "    if (para.length <= MAX) { buf = para; continue; }",
  "    for (let line of para.split('\\n')) {",
  "      const c2 = buf ? buf + '\\n' + line : line;",
  "      if (c2.length <= MAX) { buf = c2; continue; }",
  "      push();",
  "      while (line.length > MAX) { chunks.push(line.slice(0, MAX)); line = line.slice(MAX); }",
  "      buf = line;",
  "    }",
  "  }",
  "  push();",
  "  return chunks;",
  "}",
  "const parts = out ? split(out).filter(t => t.trim()) : [];",
  "if (!parts.length) return [];",
  "return parts.map((t, i) => ({ json: { chat_id, text: t, part: i + 1, total: parts.length } }));"
].join('\n');

let cut = nodes.find(n => n.name === 'Ответ: нарезка');
if (!cut) {
  cut = { parameters: { jsCode }, id: 'reply-chunk-0001', name: 'Ответ: нарезка', type: 'n8n-nodes-base.code', typeVersion: 2, position: [ (agent.position[0] + reply.position[0]) / 2, agent.position[1] - 40 ] };
  nodes.push(cut); console.log('+ Ответ: нарезка');
} else { cut.parameters.jsCode = jsCode; console.log('~ Ответ: нарезка'); }

// HTTP Request1: тянуть chat_id/text из item, не ронять на сбое
reply.parameters.bodyParameters.parameters = [
  { name: 'chat_id', value: '={{ $json.chat_id }}' },
  { name: 'text', value: '={{ $json.text }}' }
];
reply.onError = 'continueRegularOutput';
console.log('~ HTTP Request1 (item chat_id/text, onError continue)');

// связи: AI Agent[0] -> Ответ: нарезка -> HTTP Request1
const am = conns['AI Agent'].main;
am[0] = [ { node: 'Ответ: нарезка', type: 'main', index: 0 } ];
conns['Ответ: нарезка'] = { main: [ [ { node: 'HTTP Request1', type: 'main', index: 0 } ] ] };
console.log('AI Agent[0] -> Ответ: нарезка -> HTTP Request1');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
