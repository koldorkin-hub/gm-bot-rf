/**
 * ProactiveWeekly01: клиентская недельная сводка — понедельник 11:00 → воскресенье 20:00.
 *
 * Решение владельца (29.08.2026): итоги недели должны приходить вечером в воскресенье,
 * когда неделя закончилась, а не утром понедельника, когда началась следующая.
 *
 * SQL не трогаем: период и так скользящий (now() - interval '7 days'), то есть
 * при запуске в воскресенье 20:00 он покрывает ровно прошедшую неделю.
 *
 * ⚠️ n8n считает cron в GENERIC_TIMEZONE=Europe/Moscow, не в UTC — 20:00 здесь московские.
 *
 * Прогон:  node schema/transform-weekly-sunday.js <вход.json> <выход.json>
 */
const fs = require('fs');
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-weekly-sunday.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const trig = wf.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger') || fail('нет узла расписания');
const was = JSON.stringify(trig.parameters.rule.interval);
trig.parameters.rule.interval = [{ field: 'cronExpression', expression: '0 20 * * 0' }];

// Имя узла — часть документации схемы, оставлять «Понедельник 11:00» нельзя.
const oldName = trig.name;
const newName = 'Воскресенье 20:00';
if (oldName !== newName) {
  trig.name = newName;
  if (wf.connections[oldName]) {
    wf.connections[newName] = wf.connections[oldName];
    delete wf.connections[oldName];
  }
  // Ссылки вида $('Понедельник 11:00') в коде узлов — заменить, если есть.
  wf.nodes.forEach((n) => {
    const s = JSON.stringify(n);
    if (s.indexOf(oldName) !== -1) {
      const fixed = s.split(oldName).join(newName);
      Object.assign(n, JSON.parse(fixed));
    }
  });
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const t = w.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
if (t.parameters.rule.interval[0].expression !== '0 20 * * 0') fail('расписание не поменялось');
if (t.name !== newName) fail('узел не переименован');
if (!w.connections[newName]) fail('связь от триггера потеряна');
const targets = JSON.stringify(w.connections[newName]);
console.log('было:', was);
console.log('стало: [{"field":"cronExpression","expression":"0 20 * * 0"}] — воскресенье 20:00 МСК');
console.log('узел:', oldName, '->', t.name, '| ведёт в:', JSON.parse(targets).main[0].map((x) => x.node).join(', '));
