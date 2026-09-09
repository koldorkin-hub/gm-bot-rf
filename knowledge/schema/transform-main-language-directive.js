#!/usr/bin/env node
/*
 * Мультиязычность: языковая директива в НАЧАЛО profile_block (Build Profile Context).
 * Не выбран → первое и единственное действие: спросить язык НА АНГЛИЙСКОМ; ответил →
 * save_profile(language) + дальше всё на его языке. Выбран → всегда отвечать на нём,
 * смена словами или /language. prof.language приходит из client_profile.language.
 * Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/main-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const bpc = wf.nodes.find(x => x.name === 'Build Profile Context');
if (!bpc) throw new Error('нет Build Profile Context');

const RET = 'return [{ json: { message: msg, profile_block: block } }];';
if (bpc.parameters.jsCode.indexOf(RET) < 0) throw new Error('не нашёл return-строку');
if (bpc.parameters.jsCode.indexOf('ЯЗЫК ОБЩЕНИЯ') >= 0) {
  console.log('= языковая директива уже есть — пропуск (идемпотентно)');
  const outX = Array.isArray(raw) ? [wf] : wf;
  fs.writeFileSync(path, JSON.stringify(outX, null, 2));
  process.exit(0);
}

const NOTSET = [
  '=== ЯЗЫК ОБЩЕНИЯ НЕ ВЫБРАН — АБСОЛЮТНЫЙ ПРИОРИТЕТ (важнее онбординга, приветствия и всего остального) ===',
  'Если пользователь ещё НЕ указал язык — твоё ПЕРВОЕ и ЕДИНСТВЕННОЕ действие: коротко и дружелюбно спросить НА АНГЛИЙСКОМ, на каком языке ему удобно общаться (например: «Hi! Which language would you like to chat in? — English, Русский, Español, … Just reply with your language.»). Только этот вопрос: НЕ приветствуй иначе, НЕ начинай онбординг, НЕ задавай других вопросов, НЕ вызывай инструменты.',
  'Если сообщение пользователя УЖЕ является ответом про язык (написал «English», «по-русски», «español» или просто пишет на каком-то языке) — определи язык, СРАЗУ вызови save_profile с полем language (значение — название языка по-английски: «Russian», «Spanish», «English», …), затем поприветствуй и дальше веди ВЕСЬ диалог (включая онбординг) на этом языке.'
].join('\\n');

const inject = [
  "const lang = (prof.language && String(prof.language).trim()) ? String(prof.language).trim() : '';",
  "const langBlock = lang",
  "  ? ('=== ЯЗЫК ОБЩЕНИЯ: ' + lang + ' ===\\n' + 'Отвечай ВСЕГДА на этом языке, независимо от того, на каком языке написано сообщение пользователя. Если пользователь просит сменить язык — словами («давай по-английски», «switch to Spanish») или командой /language — определи новый язык, сохрани его через save_profile (поле language), и дальше продолжай на нём.')",
  "  : (" + JSON.stringify(NOTSET) + ");",
  "block = langBlock + '\\n\\n' + block;",
  RET
].join('\n');

bpc.parameters.jsCode = bpc.parameters.jsCode.replace(RET, () => inject);
console.log('~ языковая директива вставлена в Build Profile Context');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path);
