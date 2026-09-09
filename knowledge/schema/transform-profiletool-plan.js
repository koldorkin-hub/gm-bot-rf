#!/usr/bin/env node
/*
 * ProfileTool00001 (save_profile): добавляет active_plan (активная программа/план клиента)
 * в whitelist + upsert. Мирроринг custom_instructions. Идемпотентно (маркер: active_plan).
 * Запуск: node transform-profiletool-plan.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/pt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const collect = byName['Проверить и собрать']; if (!collect) throw new Error('нет Проверить и собрать');
const ups = byName['Апсерт профиля']; if (!ups) throw new Error('нет Апсерт профиля');
if ((collect.parameters.jsCode || '').includes('active_plan')) { console.log('уже есть — пропуск'); process.exit(0); }

collect.parameters.jsCode = collect.parameters.jsCode.replace(
  "'custom_instructions'];", "'custom_instructions','active_plan'];");
if (!collect.parameters.jsCode.includes("'active_plan']")) throw new Error('WL-якорь не найден');

let q = ups.parameters.query;
q = q.replace('custom_instructions, updated_at) SELECT', 'custom_instructions, active_plan, updated_at) SELECT');
q = q.replace("j->>'custom_instructions', now() FROM", "j->>'custom_instructions', j->>'active_plan', now() FROM");
q = q.replace(
  "custom_instructions = COALESCE(EXCLUDED.custom_instructions, cp.custom_instructions), updated_at = now();",
  "custom_instructions = COALESCE(EXCLUDED.custom_instructions, cp.custom_instructions), active_plan = COALESCE(EXCLUDED.active_plan, cp.active_plan), updated_at = now();"
);
if ((q.match(/active_plan/g) || []).length < 3) throw new Error('upsert-замены не полны');
ups.parameters.query = q;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: ProfileTool — active_plan в whitelist + upsert');
