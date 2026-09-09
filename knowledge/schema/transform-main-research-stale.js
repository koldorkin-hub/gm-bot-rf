// Самоизлечение зависшего состояния research-B: если процесс убит (рестарт/краш) и
// «снять running» не отработал — состояние протухает по времени, клиент разблокируется сам.
// - «Research: занят?»: running считается активным только ≤20 мин (полный разбор макс ~11–25 мин;
//   на таймауте цикла running снимается через error-путь, орфан бывает лишь при убийстве процесса).
// - «Research: интейк?»: брошенный awaiting_topic/awaiting_goal протухает через 40 мин → обычное сообщение.
// Идемпотентно (признак "interval '20 minutes'" в занят?). Запуск: node transform-main-research-stale.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

const zan = byName['Research: занят?'];
const int = byName['Research: интейк?'];
if (!zan || !int) throw new Error('нет узлов Research: занят?/интейк?');

let changed = 0;
// занят?: добавить окно свежести running
const zq = zan.parameters.query;
if (zq.includes("interval '20 minutes'")) { console.log('занят?: уже со свежестью'); }
else {
  zan.parameters.query = zq.replace(
    "stage='running'",
    "stage='running' AND started_at > now() - interval '20 minutes'");
  changed++; console.log('занят?: ✓ добавлено окно 20 мин');
}
// интейк?: протухание awaiting через 40 мин
const iq = int.parameters.query;
if (iq.includes("interval '40 minutes'")) { console.log('интейк?: уже со свежестью'); }
else {
  int.parameters.query = iq.replace(
    "stage IN ('awaiting_topic','awaiting_goal')",
    "stage IN ('awaiting_topic','awaiting_goal') AND started_at > now() - interval '40 minutes'");
  changed++; console.log('интейк?: ✓ добавлено окно 40 мин');
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK stale: изменено ' + changed);
console.log('занят?.query =', zan.parameters.query.replace(/\s+/g,' '));
console.log('интейк?.query =', int.parameters.query.replace(/\s+/g,' ').slice(0,200));
