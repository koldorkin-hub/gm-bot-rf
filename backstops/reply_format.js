/**
 * Пост-обработка ответа модели перед отправкой в Telegram — узел «Ответ: нарезка».
 *
 * Четыре задачи, каждая из-за уже случавшегося дефекта:
 *  1. Кнопки: вырезать метку [[кнопки: а | б]] и собрать reply_markup
 *     (knowledge/memory/inline-buttons.md). Регэксп терпимый: переживает отсутствие
 *     закрывающих скобок, латинское слово «knopki», дубли метки.
 *  2. Срыв генерации вызова: модель дописывает вызов инструмента текстом
 *     (knowledge/memory/tool-call-leak.md, 0.1 % ответов) — вырезать, повтор прогона нельзя.
 *  3. Иероглифы: у открытых моделей CJK лезет в русский текст — сигнал на регенерацию.
 *  4. Разметка markdown: в Telegram она не работает — снять.
 *
 * Нарезка на куски по 4096 знаков, кнопки вешаются на ПОСЛЕДНИЙ кусок.
 * В n8n: Code-узел, require запрещён — файл самодостаточен.
 */

const CJK = /[一-鿿぀-ヿ가-힯]/;
const BUTTONS = /\[\[\s*(?:кнопк[а-яё]*|knopki|buttons)\s*:\s*([^\]\n]+)\]?\]?\s*$/gim;
const TOOL_LEAK = /(<tool_call>[\s\S]*?<\/tool_call>|<function[^>]*>[\s\S]*?<\/function>|```json\s*\{[\s\S]*?"(?:name|tool|tool_name)"[\s\S]*?\}\s*```)/gi;
const TG_LIMIT = 4096;

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, ''))
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S[^*\n]*?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)__(.+?)__(?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '— ')
    .replace(/^\s*>\s?/gm, '');
}

function extractButtons(text) {
  let options = null;
  let clean = text;
  const matches = [...text.matchAll(BUTTONS)];
  if (matches.length) {
    const last = matches[matches.length - 1];
    options = last[1].split('|').map((s) => s.trim()).filter(Boolean);
    // Дубли метки тоже убираем: клиент не должен увидеть служебную строку.
    clean = text.replace(BUTTONS, '').trimEnd();
    if (options.length < 2 || options.length > 4 || options.some((o) => o.length > 25)) {
      options = null;                       // метка не по правилам — кнопок не будет, текст уйдёт
    }
  }
  return { text: clean, options };
}

function splitChunks(text, limit = TG_LIMIT) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [''];
}

/**
 * @param {string} raw — текст, как его вернула модель
 * @returns {{chunks: string[], reply_markup: object|null, needsRegen: boolean, warnings: string[]}}
 *   needsRegen — в ответе иероглифы: это брак, ответ нужно перегенерировать, а не отправлять.
 */
function formatReply(raw) {
  const warnings = [];
  let text = String(raw == null ? '' : raw);

  if (text.match(TOOL_LEAK)) {
    text = text.replace(TOOL_LEAK, '').replace(/\n{3,}/g, '\n\n');
    warnings.push('вырезан вызов инструмента, утёкший в текст');
  }
  const needsRegen = CJK.test(text);
  if (needsRegen) warnings.push('в ответе иероглифы — нужна регенерация');

  const before = text;
  text = stripMarkdown(text);
  if (text !== before) warnings.push('снята разметка markdown');

  const { text: clean, options } = extractButtons(text);
  const chunks = splitChunks(clean);
  const reply_markup = options
    ? { inline_keyboard: [options.map((label, i) => ({ text: label, callback_data: `opt:${i}` }))] }
    : null;

  return { chunks, reply_markup, needsRegen, warnings };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatReply, stripMarkdown, extractButtons, splitChunks };
}
