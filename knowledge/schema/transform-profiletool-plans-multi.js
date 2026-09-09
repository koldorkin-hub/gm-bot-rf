#!/usr/bin/env node
/*
 * ProfileTool00001 (save_profile): добавляет plan_month, plan_week (раздельные горизонты плана)
 * в whitelist + upsert. НЕ перезаписывают друг друга и active_plan. Мирроринг active_plan.
 * Идемпотентно (маркер: plan_week). Запуск: node transform-profiletool-plans-multi.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/pt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const collect = byName['Проверить и собрать']; if (!collect) throw new Error('нет Проверить и собрать');
const ups = byName['Апсерт профиля']; if (!ups) throw new Error('нет Апсерт профиля');
if ((collect.parameters.jsCode || '').includes('plan_week')) { console.log('уже есть — пропуск'); process.exit(0); }

collect.parameters.jsCode = collect.parameters.jsCode.replace(
  "'active_plan'];", "'active_plan','plan_month','plan_week'];");
if (!collect.parameters.jsCode.includes("'plan_week']")) throw new Error('WL-якорь не найден');

let q = ups.parameters.query;
q = q.replace('active_plan, updated_at) SELECT', 'active_plan, plan_month, plan_week, updated_at) SELECT');
q = q.replace("j->>'active_plan', now() FROM", "j->>'active_plan', j->>'plan_month', j->>'plan_week', now() FROM");
q = q.replace(
  "active_plan = COALESCE(EXCLUDED.active_plan, cp.active_plan), updated_at = now();",
  "active_plan = COALESCE(EXCLUDED.active_plan, cp.active_plan), plan_month = COALESCE(EXCLUDED.plan_month, cp.plan_month), plan_week = COALESCE(EXCLUDED.plan_week, cp.plan_week), updated_at = now();"
);
if ((q.match(/plan_week/g) || []).length < 3) throw new Error('upsert-замены не полны');
ups.parameters.query = q;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: ProfileTool — plan_month + plan_week в whitelist + upsert');
