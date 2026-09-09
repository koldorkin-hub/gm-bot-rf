// Фаза 2, часть 2: ветка фото — режим (single/entered/added) + накопление + приглашение (1 раз).
// single → путь 2.1 (getFile). entered/added → докопить в photo_batch(_item), invited-приглашение только entered.
// Идемпотентно (признак 'Фото: режим'). Запуск: node transform-main-photo-batch-2.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['Фото: режим']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const B = "$('Load Config').first().json.bot_id";
const U = "$('Normalize').first().json.message.from.id";
const CH = "$('Normalize').first().json.message.chat.id";
const MG = "$('Normalize').first().json.message.media_group_id || ''";
const FID = "$('Normalize').first().json.message.photo[$('Normalize').first().json.message.photo.length - 1].file_id";
const CAP = "$('Normalize').first().json.message.caption || null";
function ifEq(id, name, left, val, pos) {
  return { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: id + '-c', leftValue: left, rightValue: val, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos };
}

// --- Узел решения режима ---
byName['Фото: режим'] = {
  parameters: { operation: 'executeQuery',
    query: "WITH ex AS (SELECT 1 AS c FROM photo_batch WHERE bot_id=$1 AND user_id=$2), ins AS ( INSERT INTO photo_batch (bot_id,user_id,chat_id) SELECT $1,$2,$3 WHERE NULLIF($4,'') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ex) ON CONFLICT (bot_id,user_id) DO NOTHING RETURNING 1 AS entered ) SELECT CASE WHEN (SELECT c FROM ex) IS NOT NULL THEN 'added' WHEN (SELECT entered FROM ins) IS NOT NULL THEN 'entered' WHEN NULLIF($4,'') IS NOT NULL THEN 'added' ELSE 'single' END AS mode;",
    options: { queryReplacement: "={{ [" + B + ", " + U + ", " + CH + ", " + MG + "] }}" } },
  id: 'f7000000-0000-4000-8000-000000000001', name: 'Фото: режим',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-260, 620], credentials: PG
};
byName['Фото: single?'] = ifEq('f7000000-0000-4000-8000-000000000002', 'Фото: single?', '={{ $json.mode }}', 'single', [-40, 620]);
byName['Фото: докопить'] = {
  parameters: { operation: 'executeQuery',
    query: "WITH ins AS (INSERT INTO photo_batch_item (bot_id,user_id,file_id,caption) VALUES ($1,$2,$3,$4) RETURNING 1) UPDATE photo_batch SET last_file_at=now() WHERE bot_id=$1 AND user_id=$2;",
    options: { queryReplacement: "={{ [" + B + ", " + U + ", " + FID + ", " + CAP + "] }}" } },
  id: 'f7000000-0000-4000-8000-000000000003', name: 'Фото: докопить',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [180, 760], credentials: PG
};
byName['Фото: приглашать?'] = ifEq('f7000000-0000-4000-8000-000000000004', 'Фото: приглашать?', "={{ $('Фото: режим').first().json.mode }}", 'entered', [400, 760]);
// приглашение — клон sendMessage
const inv = JSON.parse(JSON.stringify(byName['Голос не распознан']));
inv.id = 'f7000000-0000-4000-8000-000000000005'; inv.name = 'Фото: приглашение'; inv.position = [620, 700];
inv.parameters.bodyParameters.parameters.find(p => p.name === 'text').value =
  'Вижу, ты присылаешь несколько файлов 📎 Скинь все, что нужно разобрать, и напиши «готово» — посмотрю вместе и дам один связный ответ. Или просто подожди — разберу сам через минуту.';
byName['Фото: приглашение'] = inv;
byName['Фото: тихо'] = { parameters: {}, id: 'f7000000-0000-4000-8000-000000000006', name: 'Фото: тихо', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [620, 860] };

wf.nodes.push(byName['Фото: режим'], byName['Фото: single?'], byName['Фото: докопить'], byName['Фото: приглашать?'], byName['Фото: приглашение'], byName['Фото: тихо']);

// --- Перевязка: Switch[photo] теперь → Фото: режим (было → Photo: getFile) ---
const sw = conns['Switch'].main;
const photoIdx = 2; // research(0) voice(1) photo(2) text(3)
sw[photoIdx] = [{ node: 'Фото: режим', type: 'main', index: 0 }];
conns['Фото: режим'] = { main: [[{ node: 'Фото: single?', type: 'main', index: 0 }]] };
conns['Фото: single?'] = { main: [ [{ node: 'Photo: getFile', type: 'main', index: 0 }], [{ node: 'Фото: докопить', type: 'main', index: 0 }] ] };
conns['Фото: докопить'] = { main: [[{ node: 'Фото: приглашать?', type: 'main', index: 0 }]] };
conns['Фото: приглашать?'] = { main: [ [{ node: 'Фото: приглашение', type: 'main', index: 0 }], [{ node: 'Фото: тихо', type: 'main', index: 0 }] ] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK photo-batch-2: Switch[photo]→' + conns['Switch'].main[2][0].node + ', узлов+6');
