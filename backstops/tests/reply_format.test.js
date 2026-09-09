const test = require('node:test');
const assert = require('node:assert');
const { formatReply, stripMarkdown, splitChunks } = require('../reply_format.js');

test('обычный ответ проходит без изменений', () => {
  const r = formatReply('Записал: гречка 150 г, это 165 ккал.');
  assert.deepStrictEqual(r.chunks, ['Записал: гречка 150 г, это 165 ккал.']);
  assert.strictEqual(r.reply_markup, null);
  assert.strictEqual(r.needsRegen, false);
  assert.deepStrictEqual(r.warnings, []);
});

test('кнопки вырезаны из текста и собраны в разметку', () => {
  const r = formatReply('Уточни жирность.\n[[кнопки: 5 процентов | 9 процентов | Обезжиренный]]');
  assert.strictEqual(r.chunks[0], 'Уточни жирность.');
  assert.strictEqual(r.reply_markup.inline_keyboard[0].length, 3);
  assert.strictEqual(r.reply_markup.inline_keyboard[0][0].text, '5 процентов');
  assert.strictEqual(r.reply_markup.inline_keyboard[0][0].callback_data, 'opt:0');
});

test('метка без закрывающих скобок и латиницей всё равно ловится', () => {
  const r = formatReply('Что дальше?\n[[knopki: Записать | Исправить');
  assert.strictEqual(r.chunks[0], 'Что дальше?');
  assert.strictEqual(r.reply_markup.inline_keyboard[0].length, 2);
});

test('метка не по правилам — кнопок нет, но и служебной строки в тексте нет', () => {
  const r = formatReply('Выбери.\n[[кнопки: а | б | в | г | д]]');
  assert.strictEqual(r.reply_markup, null);
  assert.strictEqual(r.chunks[0].includes('кнопки'), false);
});

test('слишком длинная подпись отбраковывает набор целиком', () => {
  const r = formatReply('Выбери.\n[[кнопки: подпись длиннее двадцати пяти знаков точно | Нет]]');
  assert.strictEqual(r.reply_markup, null);
});

test('иероглифы помечают ответ на регенерацию', () => {
  const r = formatReply('Записал 好的');
  assert.strictEqual(r.needsRegen, true);
  assert.match(r.warnings.join(' '), /иероглифы/);
});

test('утёкший вызов инструмента вырезается', () => {
  const r = formatReply('Сейчас запишу.\n```json\n{"name": "log_food", "arguments": {"kcal": 165}}\n```\nГотово.');
  assert.strictEqual(r.chunks[0].includes('log_food'), false);
  assert.match(r.warnings.join(' '), /утёкший/);
  assert.match(r.chunks[0], /Готово\./);
});

test('вызов в теге tool_call тоже вырезается', () => {
  const r = formatReply('Хорошо. <tool_call>{"name":"log_food"}</tool_call>');
  assert.strictEqual(r.chunks[0].includes('tool_call'), false);
});

test('разметка снимается, структура текста остаётся читаемой', () => {
  const out = stripMarkdown('**Итого**\n## План\n- присед\n- жим\n> цитата');
  assert.strictEqual(out.includes('**'), false);
  assert.strictEqual(out.includes('##'), false);
  assert.match(out, /— присед/);
});

test('умножение внутри слова не считается разметкой', () => {
  assert.strictEqual(stripMarkdown('4*8*45 кг'), '4*8*45 кг');
});

test('длинный ответ режется по границам абзацев', () => {
  const long = ('Абзац про тренировку. '.repeat(120) + '\n\n').repeat(3);
  const chunks = splitChunks(long);
  assert.strictEqual(chunks.every((c) => c.length <= 4096), true);
  assert.strictEqual(chunks.length > 1, true);
  assert.strictEqual(chunks.join(' ').includes('Абзац про тренировку.'), true);
});

test('кнопки вешаются на последний кусок длинного ответа', () => {
  const long = 'Текст. '.repeat(900) + '\n[[кнопки: Да | Нет]]';
  const r = formatReply(long);
  assert.strictEqual(r.chunks.length > 1, true);
  assert.strictEqual(r.reply_markup.inline_keyboard[0].length, 2);
  assert.strictEqual(r.chunks[r.chunks.length - 1].includes('кнопки'), false);
});

test('пустой ответ не роняет узел', () => {
  const r = formatReply(null);
  assert.deepStrictEqual(r.chunks, ['']);
  assert.strictEqual(r.reply_markup, null);
});
