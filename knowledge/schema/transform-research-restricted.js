// Фикс over-block: гейт /research блокировал клиента по широкому is_pharma (вкл. БАД: креатин и т.п.).
// Вводим узкий is_restricted (только рецептурное/гормоны/ААС/запрещённое) и гейтим по нему.
// is_pharma остаётся для юр-дисклеймера в PDF. Идемпотентно. Запуск: node transform-research-restricted.js <in> <out>
const fs = require('fs');
const [,, inp, outp] = process.argv;
const doc = JSON.parse(fs.readFileSync(inp, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const rep = [];
function rin(node, key, find, replace) {
  const cur = node.parameters[key];
  if (cur.indexOf(find) === -1) throw new Error('НЕ найдено «' + find.slice(0, 45) + '…» в [' + node.name + ']');
  node.parameters[key] = cur.split(find).join(replace);
  rep.push(node.name + '/' + key);
}

// 1. Тело плана: просим is_restricted + определение
const tp = byName['Тело плана'];
if (!/is_restricted/.test(tp.parameters.jsCode)) {
  rin(tp, 'jsCode',
    '{"topic_ru":"короткая тема по-русски","is_pharma":true|false,"queries":["...","..."]}',
    '{"topic_ru":"короткая тема по-русски","is_pharma":true|false,"is_restricted":true|false,"queries":["...","..."]}');
  rin(tp, 'jsCode',
    "'is_pharma = true, если тема касается лекарств, гормонов, БАД или веществ с фармакологическим действием.'",
    "'is_pharma = true, если тема касается лекарств, гормонов, БАД или веществ с фармакологическим действием.',\n  '',\n  'is_restricted = true ТОЛЬКО для рецептурных препаратов, гормонов и гормональной терапии, анаболических стероидов, запрещённых или контролируемых веществ. Обычные спортивные добавки — креатин, протеин, аминокислоты, кофеин, бета-аланин, витамины, омега-3 и подобное — is_restricted = false.'");
}

// 2. Разобрать план: извлечь is_restricted (при сомнении — false, чтобы не переблокировать обычное)
const rp = byName['Разобрать план'];
if (!/is_restricted/.test(rp.parameters.jsCode)) {
  rin(rp, 'jsCode', 'is_pharma: plan.is_pharma !== false,', 'is_pharma: plan.is_pharma !== false,\n    is_restricted: plan.is_restricted === true,');
}

// 3. Фарма-гейт: условие по is_restricted вместо is_pharma
const gate = byName['Фарма-гейт'];
const cond = gate.parameters.conditions.conditions[0];
if (/is_pharma/.test(cond.leftValue)) {
  cond.leftValue = cond.leftValue.split('!$json.is_pharma').join('!$json.is_restricted');
  rep.push('Фарма-гейт/condition');
}

fs.writeFileSync(outp, JSON.stringify([wf], null, 1));
console.log('OK research is_restricted:\n  ' + rep.join('\n  '));
