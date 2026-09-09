#!/usr/bin/env node
/*
 * ProfileTool00001 (save_profile): добавляет plan_started_on (дата старта активной программы)
 * в whitelist + upsert. Мирроринг паттерна plan_month/plan_week.
 * Идемпотентно (маркер: plan_started_on). Запуск: node transform-profiletool-planstart.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/pt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const collect = byName['Проверить и собрать']; if (!collect) throw new Error('нет Проверить и собрать');
const ups = byName['Апсерт профиля']; if (!ups) throw new Error('нет Апсерт профиля');
if ((collect.parameters.jsCode || '').includes('plan_started_on')) { console.log('уже есть — пропуск'); process.exit(0); }

collect.parameters.jsCode = collect.parameters.jsCode.replace(
  "'plan_month','plan_week'];", "'plan_month','plan_week','plan_started_on'];");
if (!collect.parameters.jsCode.includes("'plan_started_on']")) throw new Error('WL-якорь не найден');

let q = ups.parameters.query;
q = q.replace('plan_month, plan_week, updated_at) SELECT', 'plan_month, plan_week, plan_started_on, updated_at) SELECT');
q = q.replace("j->>'plan_month', j->>'plan_week', now() FROM", "j->>'plan_month', j->>'plan_week', (j->>'plan_started_on')::date, now() FROM");
q = q.replace(
  'plan_week = COALESCE(EXCLUDED.plan_week, cp.plan_week), updated_at = now();',
  'plan_week = COALESCE(EXCLUDED.plan_week, cp.plan_week), plan_started_on = COALESCE(EXCLUDED.plan_started_on, cp.plan_started_on), updated_at = now();'
);
if ((q.match(/plan_started_on/g) || []).length < 3) throw new Error('upsert-замены не полны');
ups.parameters.query = q;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: ProfileTool — plan_started_on в whitelist + upsert');
