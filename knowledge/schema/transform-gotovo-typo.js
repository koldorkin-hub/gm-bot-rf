#!/usr/bin/env node
/*
 * Фикс «готво»: опечатка в «готово» не распознавалась как сигнал финализации →
 * бот отвечал невпопад (комментарий + напоминание про файлы). Добавляем тайтовый
 * fuzzy-матч: слово из букв «гот» + только о/в (готв/гото/готоо/готво/готов/готово…),
 * не ловит «голова»/«готика». Только семейство «готово», прочие сигналы не трогаем.
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const n = wf.nodes.find(x => x.name === 'Текст: разбор');
if (!n) throw new Error('нет узла Текст: разбор');

n.parameters.jsCode = [
  "const st = $('Текст: копит?').first().json || {};",
  "const collecting = st.collecting === true || st.collecting === 't';",
  "const nItems = Number(st.items) || 0;",
  "const msg = $('Normalize').first().json.message || {};",
  "const text = String(msg.text || '');",
  "const t = text.toLowerCase().trim();",
  "const w = t.replace(/[^а-яё]/gi, '');",
  "const gotFuzzy = /^гот[ов]{0,4}$/.test(w);",
  "const sig = ['готово','готов','всё','все','обработай','обрабатывай','разбери','разберись','разбор','посмотри','глянь','давай','поехали','да','можно','ок','погнали'];",
  "const isSignal = gotFuzzy || sig.includes(t) || sig.some(s => t === s+'.' || t === s+'!') || /^(готов|всё готов|можно разбир|разбери|обрабат|погнали|давай разбир)/.test(t);",
  "let route = 'agent', outText = text;",
  "if (collecting && nItems > 0 && isSignal) route = 'finalize';",
  "else if (collecting && nItems > 0) { outText = text + '\\n\\n[Для тебя: у клиента ' + nItems + ' файлов ждут разбора в очереди. Ответь на его сообщение и в конце мягко напомни написать «готово», чтобы разобрать их вместе.]'; }",
  "return [{ json: { message: Object.assign({}, msg, { text: outText }), route } }];"
].join('\n');
console.log('~ Текст: разбор (fuzzy готово)');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
