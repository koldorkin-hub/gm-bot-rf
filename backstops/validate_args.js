/**
 * Проверка аргументов инструмента по JSON-схеме — первым узлом каждого подчинённого workflow.
 *
 * Зачем. У открытых моделей самое уязвимое место — числа и даты в аргументах инструментов
 * (research/РФ-СТЕК-04, раздел «Квантование»). Ошибку надо не глотать, а вернуть модели
 * ТЕКСТОМ: она чинит вызов сама, со второй попытки, и клиент этого не видит.
 *
 * Почему без библиотек. В Code-узле n8n запрещён require (knowledge/memory/n8n-dataflow-gotchas.md),
 * поэтому валидатор написан руками под то подмножество JSON Schema, которое используется
 * в схемах инструментов: type, enum, pattern, required, properties, items, maxItems,
 * minimum/maximum, additionalProperties.
 *
 * Использование в n8n (Code-узел, режим «Run Once for All Items»):
 *   const schema = { ... };                       // схема инструмента
 *   const r = validateArgs(schema, $json);
 *   if (!r.ok) return [{ json: { response: r.message } }];   // ответ агенту текстом ошибки
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' && Number.isFinite(value);
  if (expected === 'integer') return actual === 'number' && Number.isInteger(value);
  return actual === expected;
}

function describe(value) {
  if (typeof value === 'string') return `«${value}»`;
  if (Array.isArray(value)) return `список из ${value.length}`;
  if (value && typeof value === 'object') return 'объект';
  return String(value);
}

/**
 * @returns {{ok: boolean, errors: string[], message: string}} — сообщения по-русски.
 */
function validateArgs(schema, value, path = '') {
  const errors = [];
  const at = path || 'аргументы';

  const walk = (schema, value, path) => {
    const at = path || 'аргументы';
    if (!schema || typeof schema !== 'object') return;

    if (schema.type && !typeMatches(value, schema.type)) {
      const names = { string: 'строкой', number: 'числом', integer: 'целым числом',
        boolean: 'да/нет', object: 'объектом', array: 'списком' };
      errors.push(`${at}: должно быть ${names[schema.type] || schema.type}, передано ${describe(value)}`);
      return;                                   // дальше по этой ветке проверять нечего
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${at}: допустимые значения — ${schema.enum.join(', ')}; передано ${describe(value)}`);
    }
    if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
      const hint = schema.description ? ` (${schema.description})` : '';
      errors.push(`${at}: значение ${describe(value)} не в требуемом формате${hint}`);
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${at}: ${value} меньше допустимого ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${at}: ${value} больше допустимого ${schema.maximum}`);
      }
    }
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${at}: элементов ${value.length}, максимум ${schema.maxItems}`);
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${at}: элементов ${value.length}, минимум ${schema.minItems}`);
      }
      if (schema.items) value.forEach((item, i) => walk(schema.items, item, `${at}[${i}]`));
    }
    if (schema.type === 'object' || schema.properties) {
      if (typeOf(value) !== 'object') return;
      (schema.required || []).forEach((key) => {
        if (value[key] === undefined || value[key] === null || value[key] === '') {
          errors.push(`${at}: обязательный параметр «${key}» не передан`);
        }
      });
      const known = Object.keys(schema.properties || {});
      if (schema.additionalProperties === false) {
        const extra = Object.keys(value).filter((k) => !known.includes(k));
        if (extra.length) errors.push(`${at}: лишние параметры — ${extra.join(', ')}`);
      }
      known.forEach((key) => {
        if (value[key] !== undefined && value[key] !== null) {
          walk(schema.properties[key], value[key], path ? `${path}.${key}` : key);
        }
      });
    }
  };

  walk(schema, value, path);
  const message = errors.length
    ? `Вызов не выполнен: ${errors.join('; ')}. Исправь аргументы и вызови инструмент заново.`
    : '';
  return { ok: errors.length === 0, errors, message, at };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { validateArgs };
