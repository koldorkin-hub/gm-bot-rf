/**
 * Прикладное шифрование полей контура здоровья ключом вне базы.
 *
 * Зачем (marketing/ДАННЫЕ-О-ЗДОРОВЬЕ.md, мера 1). Флаг sensitive без отдельного ключа —
 * не мера защиты, а комментарий. Шифрование не снимает состав по ч.16 ст.13.11 КоАП, но
 * это единственное, что превращает украденный дамп базы в бесполезный файл: ключ лежит
 * не в базе, а в окружении сервиса, поэтому копия базы сама по себе ничего не раскрывает.
 *
 * Схема: AES-256-GCM, случайный вектор на каждое значение, тег целостности.
 * Значение привязано к своему месту через AAD — «бот:пользователь:поле». Поэтому шифротекст
 * нельзя переставить в другую строку: расшифровка сломается, а не отдаст чужое значение.
 * Формат хранения: v1:<iv>:<тег>:<шифротекст>, всё base64 — версия нужна для смены ключа.
 *
 * Ключ: переменная окружения GM_FIELD_KEY, 32 байта в hex (64 знака).
 *   openssl rand -hex 32
 * Ключ НЕ хранится в базе, НЕ попадает в репозиторий и НЕ печатается в журналы.
 *
 * Ограничение n8n: в Code-узлах require запрещён по умолчанию. Для этого модуля контейнеру
 * n8n нужен NODE_FUNCTION_ALLOW_BUILTIN=crypto — это настройка развёртывания РФ-сервера,
 * записана в schema/README.md. Иначе шифрование выносится отдельным HTTP-узлом.
 */
const crypto = require('node:crypto');

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function keyFrom(hex) {
  const raw = hex || process.env.GM_FIELD_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('ключ шифрования полей должен быть 32 байтами в hex (64 знака); проверь GM_FIELD_KEY');
  }
  return Buffer.from(raw, 'hex');
}

/** Контекст привязки: значение нельзя переставить в другую строку или другое поле. */
function aad(context) {
  const { bot_id, user_id, field } = context || {};
  if (!bot_id || user_id == null || !field) {
    throw new Error('контекст шифрования неполон: нужны bot_id, user_id и field');
  }
  return Buffer.from(`${bot_id}:${user_id}:${field}`, 'utf8');
}

function encryptField(value, context, keyHex) {
  if (value === null || value === undefined || value === '') return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFrom(keyHex), iv);
  cipher.setAAD(aad(context));
  const ct = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'),
    ct.toString('base64')].join(':');
}

function decryptField(blob, context, keyHex) {
  if (blob === null || blob === undefined || blob === '') return null;
  const parts = String(blob).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`не разобрать шифрованное значение (ожидался формат ${VERSION}:iv:tag:ct)`);
  }
  const [, iv, tag, ct] = parts;
  const decipher = crypto.createDecipheriv(ALGO, keyFrom(keyHex), Buffer.from(iv, 'base64'));
  decipher.setAAD(aad(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  // Подмена шифротекста, тега или контекста валит расшифровку — это и есть проверка целостности.
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

/** Пометка: значение уже зашифровано (для миграций и выборочных проверок). */
function isEncrypted(value) {
  return typeof value === 'string' && /^v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/.test(value);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { encryptField, decryptField, isEncrypted, VERSION };
}
