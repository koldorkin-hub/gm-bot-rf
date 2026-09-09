const test = require('node:test');
const assert = require('node:assert');
const { encryptField, decryptField, isEncrypted } = require('../field_crypto.js');

const KEY = 'a'.repeat(64);
const KEY2 = 'b'.repeat(64);
const CTX = { bot_id: 'devbot', user_id: 999002, field: 'allergen.substance' };

test('туда и обратно', () => {
  const blob = encryptField('орехи', CTX, KEY);
  assert.strictEqual(isEncrypted(blob), true);
  assert.strictEqual(blob.includes('орехи'), false, 'открытый текст не должен быть виден');
  assert.strictEqual(decryptField(blob, CTX, KEY), 'орехи');
});

test('два шифрования одного значения дают разные шифротексты', () => {
  assert.notStrictEqual(encryptField('орехи', CTX, KEY), encryptField('орехи', CTX, KEY));
});

test('чужой ключ не расшифровывает', () => {
  const blob = encryptField('метформин', CTX, KEY);
  assert.throws(() => decryptField(blob, CTX, KEY2));
});

test('значение нельзя переставить в другую строку', () => {
  const blob = encryptField('орехи', CTX, KEY);
  const other = { ...CTX, user_id: 999003 };
  assert.throws(() => decryptField(blob, other, KEY), 'чужой пользователь');
  assert.throws(() => decryptField(blob, { ...CTX, field: 'condition.name' }, KEY), 'чужое поле');
});

test('подмена шифротекста ломает расшифровку, а не отдаёт мусор', () => {
  const blob = encryptField('гипотиреоз', CTX, KEY);
  const parts = blob.split(':');
  const broken = [parts[0], parts[1], parts[2],
    Buffer.from('подмена', 'utf8').toString('base64')].join(':');
  assert.throws(() => decryptField(broken, CTX, KEY));
});

test('подмена тега целостности ломает расшифровку', () => {
  const parts = encryptField('гипотиреоз', CTX, KEY).split(':');
  const broken = [parts[0], parts[1], Buffer.alloc(16).toString('base64'), parts[3]].join(':');
  assert.throws(() => decryptField(broken, CTX, KEY));
});

test('пустые значения проходят насквозь', () => {
  for (const v of [null, undefined, '']) {
    assert.strictEqual(encryptField(v, CTX, KEY), null);
    assert.strictEqual(decryptField(v, CTX, KEY), null);
  }
});

test('короткий или кривой ключ отвергается сразу', () => {
  assert.throws(() => encryptField('х', CTX, 'abc'), /32 байтами в hex/);
  assert.throws(() => encryptField('х', CTX, 'z'.repeat(64)), /32 байтами в hex/);
});

test('неполный контекст отвергается — привязка обязательна', () => {
  assert.throws(() => encryptField('х', { bot_id: 'devbot' }, KEY), /контекст шифрования неполон/);
  assert.throws(() => encryptField('х', null, KEY), /контекст шифрования неполон/);
});

test('чужой формат значения отвергается с внятной ошибкой', () => {
  assert.throws(() => decryptField('орехи', CTX, KEY), /не разобрать шифрованное значение/);
  assert.throws(() => decryptField('v9:a:b:c', CTX, KEY), /не разобрать шифрованное значение/);
});

test('длинный текст и юникод переживают цикл', () => {
  const long = 'Заключение по анализам: ТТГ 5.8, ферритин 15. '.repeat(50) + '💊';
  assert.strictEqual(decryptField(encryptField(long, CTX, KEY), CTX, KEY), long);
});

test('ключ берётся из окружения, если не передан явно', () => {
  const saved = process.env.GM_FIELD_KEY;
  process.env.GM_FIELD_KEY = KEY;
  try {
    assert.strictEqual(decryptField(encryptField('орехи', CTX), CTX), 'орехи');
  } finally {
    if (saved === undefined) delete process.env.GM_FIELD_KEY; else process.env.GM_FIELD_KEY = saved;
  }
});
