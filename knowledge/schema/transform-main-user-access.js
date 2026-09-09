// Per-user контроль доступа + админ-команды. После Access Gate[true]:
// Админ? (id==255171226 && команда) → grant/revoke/access/list ; иначе User Access? → пущен/отказ-с-id.
// Идемпотентно (признак 'User Access?'). Запуск: node transform-main-user-access.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const conns = wf.connections;
if (byName['User Access?']) { console.log('уже есть — пропускаю'); fs.writeFileSync(outp, JSON.stringify([wf], null, 1)); process.exit(0); }
const PG = { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } };
const ADMIN = 255171226;
const B = "$('Load Config').first().json.bot_id";
const U = "$('Normalize').first().json.message.from.id";
function ifBool(id, name, expr, pos) {
  return { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: id + '-c', leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos };
}
function pg(id, name, query, qr, pos) {
  return { parameters: { operation: 'executeQuery', query, options: qr ? { queryReplacement: qr } : {} },
    id, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos, credentials: PG };
}
function sendMsg(id, name, textExpr, pos) {
  const n = JSON.parse(JSON.stringify(byName['Голос не распознан']));
  n.id = id; n.name = name; n.position = pos;
  n.parameters.bodyParameters.parameters.find(p => p.name === 'text').value = textExpr;
  return n;
}

// --- узлы ---
byName['Админ?'] = ifBool('c8000000-0000-4000-8000-000000000001', 'Админ?',
  "={{ " + U + " === " + ADMIN + " && /^\\/(grant|revoke|access|list)\\b/i.test(" + "$('Normalize').first().json.message.text || '') }}", [120, -120]);
byName['Админ: разобрать'] = { parameters: { jsCode:
"const msg = $('Normalize').first().json.message || {};\n" +
"const text = String(msg.text || '').trim();\n" +
"const parts = text.split(/\\s+/);\n" +
"const action = parts[0].replace(/^\\//,'').toLowerCase();\n" +
"const bot = parts[1] || null;\n" +
"const uid = (parts[2] && /^\\d+$/.test(parts[2])) ? Number(parts[2]) : null;\n" +
"let until = null;\n" +
"const arg = parts[3];\n" +
"if (action === 'grant' && arg) {\n" +
"  const a = arg.toLowerCase();\n" +
"  if (a === 'free' || a === 'бессрочно') until = null;\n" +
"  else { const m = a.match(/^(\\d+)d$/); if (m) { const dt = new Date(Date.now() + Number(m[1])*86400000); until = dt.toISOString().slice(0,10); } else if (/^\\d{4}-\\d{2}-\\d{2}$/.test(a)) until = a; }\n" +
"}\n" +
"return [{ json: { action, bot, uid, until } }];" },
  id: 'c8000000-0000-4000-8000-000000000002', name: 'Админ: разобрать', type: 'n8n-nodes-base.code', typeVersion: 2, position: [340, -220] };
byName['Админ: выполнить'] = pg('c8000000-0000-4000-8000-000000000003', 'Админ: выполнить',
  "SELECT fn_admin_access($1,$2,$3,$4) AS reply;", "={{ [$json.action, $json.bot, $json.uid, $json.until] }}", [560, -220]);
byName['Админ: ответ'] = sendMsg('c8000000-0000-4000-8000-000000000004', 'Админ: ответ', "={{ $json.reply }}", [780, -220]);
byName['User Access?'] = pg('c8000000-0000-4000-8000-000000000005', 'User Access?',
  "SELECT EXISTS(SELECT 1 FROM user_access WHERE bot_id=$1 AND user_id=$2 AND (access_until IS NULL OR access_until >= current_date)) AS has_access;",
  "={{ [" + B + ", " + U + "] }}", [340, -40]);
byName['Пущен?'] = ifBool('c8000000-0000-4000-8000-000000000006', 'Пущен?', "={{ $json.has_access }}", [560, -40]);
byName['Нет доступа'] = sendMsg('c8000000-0000-4000-8000-000000000007', 'Нет доступа',
  "=Доступа к этому боту пока нет 🔒\nТвой ID: {{ " + U + " } } — передай его для активации доступа.".replace('} }','}}'), [780, 60]);

wf.nodes.push(byName['Админ?'], byName['Админ: разобрать'], byName['Админ: выполнить'], byName['Админ: ответ'], byName['User Access?'], byName['Пущен?'], byName['Нет доступа']);

// --- перевязка: Access Gate[0] был → Load Profile; теперь → Админ? ---
conns['Access Gate'].main[0] = [{ node: 'Админ?', type: 'main', index: 0 }];
conns['Админ?'] = { main: [ [{ node: 'Админ: разобрать', type: 'main', index: 0 }], [{ node: 'User Access?', type: 'main', index: 0 }] ] };
conns['Админ: разобрать'] = { main: [[{ node: 'Админ: выполнить', type: 'main', index: 0 }]] };
conns['Админ: выполнить'] = { main: [[{ node: 'Админ: ответ', type: 'main', index: 0 }]] };
conns['User Access?'] = { main: [[{ node: 'Пущен?', type: 'main', index: 0 }]] };
conns['Пущен?'] = { main: [ [{ node: 'Load Profile', type: 'main', index: 0 }], [{ node: 'Нет доступа', type: 'main', index: 0 }] ] };

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK user-access: Access Gate[0]→' + conns['Access Gate'].main[0][0].node + ', узлов+7');
