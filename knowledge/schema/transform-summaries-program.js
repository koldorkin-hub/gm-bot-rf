/**
 * Сводки памяти не должны спорить с программой тренировок.
 *
 * Повод (владелец, 11.09.2026): бот выдал в День 4 упражнения понедельника и пресс. Программа в
 * базе была одна, но в промпт шли ещё две памяти: «нить диалога» (DialogSummary01) записала туда
 * неправильную раскладку, которую бот сам выдал утром, а «выжимка о клиенте» (MemoryExtract001)
 * с 20.08 хранила старый цикл дней. Модель смешала всё вместе.
 *
 * Что меняется в обоих workflow:
 *  - запрос сессий отдаёт флаг has_program (есть ли действующая программа тренировок);
 *  - есть программа → модулю сводки запрещено пересказывать состав дней, сплиты и раскладки:
 *    программа хранится отдельно и главнее; изменение программы — одной строкой «что изменили»;
 *  - программы нет → можно зафиксировать только ПОСЛЕДНИЙ согласованный клиентом план, явно
 *    отменив старые; раскладку, которую бот выдал сам без подтверждения, как план не записывать.
 *
 * Прогон:  node transform-summaries-program.js <ds.in> <ds.out> <me.in> <me.out>
 */
const fs = require('fs');

const [, , DS_IN, DS_OUT, ME_IN, ME_OUT] = process.argv;
if (!ME_OUT) { console.error('usage: node transform-summaries-program.js <ds.in> <ds.out> <me.in> <me.out>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const once = (s, from, what) => { const k = s.split(from).length - 1; if (k !== 1) fail(what + ': якорь встречается ' + k + ' раз'); };
const swap = (s, from, to, what) => { once(s, from, what); return s.replace(from, () => to); };

const PRG_RULE = ' ПРОГРАММА ТРЕНИРОВОК у клиента сохранена отдельно и главнее любой сводки: состав тренировочных дней, списки упражнений, сплиты, кардио и раскладки тренировок, которые выдавал бот, в сводку НЕ пиши. Если клиент изменил программу — одна строка «программу тренировок изменили: что именно».';
const NOPRG_RULE = ' Сохранённой программы тренировок у клиента нет: если клиент ЯВНО согласовал программу (состав дней), зафиксируй кратко только ПОСЛЕДНЮЮ согласованную версию и прямо напиши, что прежние версии отменены. Раскладку, которую бот выдал сам без подтверждения клиента, как программу или договорённость не записывай.';
const FLAG_SQL = "c.current_summary, EXISTS (SELECT 1 FROM training_program tp WHERE tp.bot_id = c.bot_id AND tp.user_id = c.user_id AND tp.status = 'active') AS has_program, (SELECT string_agg";

function patch(IN, OUT, queryNode, what) {
  const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const wf = Array.isArray(raw) ? raw[0] : raw;
  const q = wf.nodes.find((n) => n.name === queryNode) || fail(what + ': нет узла ' + queryNode);
  const pr = wf.nodes.find((n) => n.name === 'Промпт') || fail(what + ': нет узла Промпт');
  if (!q.parameters.query.includes('AS has_program')) {
    q.parameters.query = swap(q.parameters.query, 'c.current_summary, (SELECT string_agg', FLAG_SQL, what + '/запрос');
  }
  if (!pr.parameters.jsCode.includes('PRG_RULE')) {
    let c = pr.parameters.jsCode;
    c = swap(c, 'const out = [];', 'const PRG_RULE = ' + JSON.stringify(PRG_RULE) + ';\nconst NOPRG_RULE = ' + JSON.stringify(NOPRG_RULE) + ';\nconst out = [];', what + '/правила');
    c = swap(c, 'system: system', 'system: system + (d.has_program === true || d.has_program === \'t\' || d.has_program === \'true\' ? PRG_RULE : NOPRG_RULE)', what + '/system');
    pr.parameters.jsCode = c;
  }
  const before = JSON.stringify(wf.connections);
  fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf), 'utf8');
  return { wf, pr, q, before };
}

let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };

for (const [IN, OUT, qn, what] of [[DS_IN, DS_OUT, 'Сессии', 'нить диалога'], [ME_IN, ME_OUT, 'Клиенты', 'выжимка']]) {
  const { wf, pr, q, before } = patch(IN, OUT, qn, what);
  check(what + ': флаг has_program в запросе ровно один', (q.parameters.query.match(/AS has_program/g) || []).length === 1);
  const run = (items) => new Function('$input', pr.parameters.jsCode)({ all: () => items.map((j) => ({ json: j })) });
  const item = { bot_id: 'users', user_id: 999608, max_id: 10, current_summary: '', transcript: 'КЛИЕНТ: привет' };
  const withP = run([{ ...item, has_program: true }]);
  const noP = run([{ ...item, has_program: false }]);
  const sys = (o) => JSON.parse(o[0].json.body).system;
  check(what + ': есть программа — запрет пересказывать состав дней', sys(withP).includes('в сводку НЕ пиши') && !sys(withP).includes('Сохранённой программы тренировок у клиента нет'));
  check(what + ': нет программы — только последний согласованный план', sys(noP).includes('только ПОСЛЕДНЮЮ согласованную') && !sys(noP).includes('в сводку НЕ пиши'));
  check(what + ': исходные правила сводки сохранены', sys(noP).startsWith('Ты — модуль'));
  check(what + ': связи не тронуты', JSON.stringify(JSON.parse(fs.readFileSync(OUT, 'utf8'))[0] ? JSON.parse(fs.readFileSync(OUT, 'utf8'))[0].connections : JSON.parse(fs.readFileSync(OUT, 'utf8')).connections) === before);
}

if (bad.length) fail('провалено ' + bad.length + ' из ' + total + ' проверок');
console.log('OK ->', DS_OUT, ME_OUT, '| проверок пройдено:', total);
