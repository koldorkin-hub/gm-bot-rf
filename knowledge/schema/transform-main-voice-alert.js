// #3 Алерт владельцу о падении голоса.
// Ошибки Groq (HTTP Request3) и загрузки файла (HTTP Request2) шли только в «Голос не распознан» (юзеру).
// Теперь: ошибка -> «Голос: разбор сбоя» (вытащить HTTP-код) -> веером в «Голос не распознан» (юзеру)
//   И в «Голос: системный?» (401/403/429/5xx) -> «Голос: анти-спам» (окно 30 мин, RETURNING) -> «Голос: алерт владельцу» (бот-тревог).
// Анти-спам: если запрос вернул 0 строк (в пределах 30 мин) — нода алерта не исполняется (нет входных items).
// Идемпотентно (признак 'Голос: разбор сбоя'). Запуск: node transform-main-voice-alert.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Голос: разбор сбоя']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };

// 1) Code: вытащить HTTP-код и признак системности из error-item
byName['Голос: разбор сбоя'] = {
  parameters: { jsCode:
    "const j = $input.first().json || {};\n" +
    "const err = j.error || {};\n" +
    "const msg = String(err.message || '');\n" +
    "const stack = String(err.stack || '');\n" +
    "const m = msg.match(/^\\s*(\\d{3})/) || stack.match(/status code (\\d{3})/i) || msg.match(/\\b([45]\\d\\d)\\b/);\n" +
    "const code = m ? Number(m[1]) : 0;\n" +
    "const systemic = code===401 || code===403 || code===429 || (code>=500 && code<600);\n" +
    "return [{ json: { code, systemic, snippet: msg.slice(0,180) } }];" },
  id: 'da000000-0000-4000-8000-000000000001', name: 'Голос: разбор сбоя',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 660]
};

// 2) IF: системный сбой?
byName['Голос: системный?'] = {
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: 'vs-c', leftValue: '={{ $json.systemic }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
  id: 'da000000-0000-4000-8000-000000000002', name: 'Голос: системный?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [880, 760]
};

// 3) Postgres: анти-спам 30 мин (окно). Вернёт строку только если можно слать.
byName['Голос: анти-спам'] = {
  parameters: { operation: 'executeQuery',
    query: "INSERT INTO ops_alert(kind,last_at) VALUES ('voice_down', now())\n" +
           "ON CONFLICT (kind) DO UPDATE SET last_at=now()\n" +
           "WHERE ops_alert.last_at < now() - interval '30 minutes'\n" +
           "RETURNING kind;",
    options: {} },
  id: 'da000000-0000-4000-8000-000000000003', name: 'Голос: анти-спам',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [1100, 760], credentials: PG
};

// 4) Telegram: алерт владельцу через бот-тревог
byName['Голос: алерт владельцу'] = {
  parameters: {
    chatId: '255171226',
    text: "=⚠️ <b>Голос упал</b>\n" +
          "Groq вернул код {{ $('Голос: разбор сбоя').first().json.code }}.\n" +
          "{{ $('Голос: разбор сбоя').first().json.snippet }}\n\n" +
          "Проверь/обнови ключ Groq → console.groq.com → credential <code>GroqHdrAuth00001</code>.\n" +
          "След. алерт не раньше чем через 30 мин.",
    additionalFields: { appendAttribution: false, parse_mode: 'HTML' }
  },
  id: 'da000000-0000-4000-8000-000000000004', name: 'Голос: алерт владельцу',
  type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1320, 760],
  credentials: { telegramApi: { id: '372DoMw3VRfbXpFL', name: 'Telegram account' } },
  retryOnFail: true, maxTries: 3, waitBetweenTries: 3000
};

wf.nodes.push(byName['Голос: разбор сбоя'], byName['Голос: системный?'], byName['Голос: анти-спам'], byName['Голос: алерт владельцу']);

// --- перевязка ---
// Ошибки HTTP Request2/3 (out[1]) вели в «Голос не распознан»; теперь → «Голос: разбор сбоя»
for (const src of ['HTTP Request2', 'HTTP Request3']) {
  if (conns[src] && conns[src].main && conns[src].main[1]) {
    conns[src].main[1] = [{ node: 'Голос: разбор сбоя', type: 'main', index: 0 }];
  }
}
// «Голос: разбор сбоя» веером: юзеру + проверка системности
conns['Голос: разбор сбоя'] = { main: [[
  { node: 'Голос не распознан', type: 'main', index: 0 },
  { node: 'Голос: системный?', type: 'main', index: 0 }
]] };
conns['Голос: системный?'] = { main: [
  [{ node: 'Голос: анти-спам', type: 'main', index: 0 }],
  []
] };
conns['Голос: анти-спам'] = { main: [[{ node: 'Голос: алерт владельцу', type: 'main', index: 0 }]] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK voice-alert: R2/R3 err → Голос: разбор сбоя → {юзер + системный?→анти-спам→алерт}');
