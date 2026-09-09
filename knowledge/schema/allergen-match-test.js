// Автономный тест матч-логики Слоя 2 (та же логика, что в инструменте).
// Читает наборы (allergens/groups/foods) из dump-файлов и гоняет сценарии.
const fs = require('fs');

function match(sets, names) {
  function pj(v){ if (typeof v === 'string'){ try { return JSON.parse(v); } catch(e){ return []; } } return v || []; }
  let allergens = pj(sets.allergens) || [];
  let groups = pj(sets.groups) || [];
  let foods = pj(sets.foods) || [];
  if (!allergens.length) return 'НЕТ АЛЛЕРГИЙ';
  const norm = s => String(s||'').toLowerCase().trim();
  const sevRank = { allergy: 2, intolerance: 1 };
  const groupSyn = {}; const groupTitle = {};
  for (const g of groups) { groupSyn[g.group_key] = (g.synonyms||[]).map(norm); groupTitle[g.group_key] = g.title_ru || g.group_key; }
  const clientGroups = {}; const clientRaw = [];
  for (const a of allergens) {
    const sub = norm(a.substance); if (!sub) continue;
    clientRaw.push({ substance: sub, severity: a.severity });
    for (const gk in groupSyn) {
      let hit = false;
      for (const sy of groupSyn[gk]) { if (!sy) continue; if (sub === sy || sub.indexOf(sy) !== -1 || sy.indexOf(sub) !== -1) { hit = true; break; } }
      if (hit && (!clientGroups[gk] || sevRank[a.severity] > sevRank[clientGroups[gk]])) clientGroups[gk] = a.severity;
    }
  }
  const hits = [];
  for (const nmRaw of names) {
    const nm = norm(nmRaw); if (!nm) continue;
    for (const c of clientRaw) { if (c.substance && nm.indexOf(c.substance) !== -1) hits.push({ ing: nmRaw, label: c.substance, severity: c.severity }); }
    for (const gk in clientGroups) { for (const sy of (groupSyn[gk]||[])) { if (sy && nm.indexOf(sy) !== -1) { hits.push({ ing: nmRaw, label: groupTitle[gk], severity: clientGroups[gk] }); break; } } }
    for (const f of foods) { const ft = norm(f.food_term); if (!ft) continue; if ((nm.indexOf(ft) !== -1 || ft.indexOf(nm) !== -1) && clientGroups[f.group_key]) hits.push({ ing: nmRaw, label: groupTitle[f.group_key], severity: clientGroups[f.group_key] }); }
  }
  const seen = new Set(); const uniq = [];
  for (const h of hits) { const k = norm(h.ing)+'|'+norm(h.label); if (!seen.has(k)) { seen.add(k); uniq.push(h); } }
  const block = uniq.filter(h => h.severity === 'allergy');
  const warn = uniq.filter(h => h.severity === 'intolerance');
  const parts = [];
  if (block.length) parts.push('БЛОК: ' + block.map(h => h.ing + '→' + h.label).join('; '));
  if (warn.length) parts.push('ПРЕДУПР: ' + warn.map(h => h.ing + '→' + h.label).join('; '));
  if (!parts.length) parts.push('нет совпадений (+консерв. оговорка)');
  return parts.join(' | ');
}

const a1 = JSON.parse(fs.readFileSync('/tmp/a999001.json','utf8')); // орехи (allergy)
const a2 = JSON.parse(fs.readFileSync('/tmp/a999002.json','utf8')); // лактоза (intolerance)

const cases = [
  ['999001 орехи | марципан (составной, скрытый)', a1, ['марципан'], 'BLOCK орехи'],
  ['999001 орехи | миндаль (категория)', a1, ['миндаль'], 'BLOCK орехи'],
  ['999001 орехи | песто', a1, ['песто'], 'BLOCK орехи'],
  ['999001 орехи | сурими (рыба, НЕ орехи)', a1, ['сурими'], 'нет совпадений'],
  ['999001 орехи | куриная грудка (чисто)', a1, ['куриная грудка'], 'нет совпадений'],
  ['999001 орехи | нутелла (орехи+молоко)', a1, ['нутелла'], 'BLOCK орехи'],
  ['999002 лактоза | марципан (орехи, НЕ молоко)', a2, ['марципан'], 'нет совпадений'],
  ['999002 лактоза | песто (молоко)', a2, ['песто'], 'ПРЕДУПР молоко'],
  ['999002 лактоза | сыр (категория молоко)', a2, ['сыр'], 'ПРЕДУПР молоко'],
];
for (const [label, sets, names, expect] of cases) {
  console.log('• ' + label);
  console.log('    ожид: ' + expect);
  console.log('    факт: ' + match(sets, names));
}
