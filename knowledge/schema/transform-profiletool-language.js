#!/usr/bin/env node
/*
 * save_profile: добавить колонку language в сохранение профиля (мультиязычность).
 * Три места: WL (Code), список колонок INSERT/SELECT, DO UPDATE SET.
 * Подворкфлоу ProfileTool00001 — после import нужен publish. Идемпотентен.
 */
const fs = require('fs');
const path = process.argv[2] || '/tmp/pt-export.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;

const code = wf.nodes.find(x => x.name === 'Проверить и собрать');
const up = wf.nodes.find(x => x.name === 'Апсерт профиля');
if (!code || !up) throw new Error('нет узлов ProfileTool');

let changed = 0;
// 1) WL
if (code.parameters.jsCode.indexOf("'language'") < 0) {
  code.parameters.jsCode = code.parameters.jsCode.replace("'current_weight_on','onboarding_done'", "'current_weight_on','language','onboarding_done'");
  changed++; console.log('~ WL += language');
} else console.log('= WL уже с language');

let q = up.parameters.query;
if (q.indexOf('language') < 0) {
  // 2) список колонок
  q = q.replace('current_weight_on, onboarding_done', 'current_weight_on, language, onboarding_done');
  // 3) SELECT
  q = q.replace("(j->>'current_weight_on')::date, COALESCE((j->>'onboarding_done')", "(j->>'current_weight_on')::date, j->>'language', COALESCE((j->>'onboarding_done')");
  // 4) DO UPDATE SET
  q = q.replace('current_weight_on = COALESCE(EXCLUDED.current_weight_on, cp.current_weight_on), onboarding_done',
                'current_weight_on = COALESCE(EXCLUDED.current_weight_on, cp.current_weight_on), language = COALESCE(EXCLUDED.language, cp.language), onboarding_done');
  up.parameters.query = q;
  changed++; console.log('~ SQL += language (колонки/SELECT/DO UPDATE)');
} else console.log('= SQL уже с language');

// проверки согласованности
const cols = (up.parameters.query.match(/language/g) || []).length;
console.log('проверка: упоминаний language в SQL =', cols, '(ожидаем 4: колонка, select, do-update x2)');

const out = Array.isArray(raw) ? [wf] : wf;
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK: записано', path, '| изменений:', changed);
