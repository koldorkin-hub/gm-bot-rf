#!/usr/bin/env node
/*
 * ProfileTool00001 (save_profile): добавляет поле custom_instructions (персональные
 * настройки поведения бота) в whitelist «Проверить и собрать» и в upsert «Апсерт профиля».
 * Идемпотентно (маркер: 'custom_instructions'). Запуск: node transform-profiletool-custom.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/pt-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const collect = byName['Проверить и собрать']; if (!collect) throw new Error('нет Проверить и собрать');
const ups = byName['Апсерт профиля']; if (!ups) throw new Error('нет Апсерт профиля');
if ((collect.parameters.jsCode || '').includes('custom_instructions')) { console.log('уже есть — пропуск'); process.exit(0); }

// 1) whitelist
collect.parameters.jsCode = collect.parameters.jsCode.replace(
  "'onboarding_safety_done'];",
  "'onboarding_safety_done','custom_instructions'];"
);
if (!collect.parameters.jsCode.includes("'custom_instructions']")) throw new Error('WL-якорь не найден');

// 2) upsert: INSERT-колонка, SELECT, ON CONFLICT SET
let q = ups.parameters.query;
q = q.replace('onboarding_safety_done, updated_at) SELECT', 'onboarding_safety_done, custom_instructions, updated_at) SELECT');
q = q.replace("COALESCE((j->>'onboarding_safety_done')::boolean,false), now() FROM", "COALESCE((j->>'onboarding_safety_done')::boolean,false), j->>'custom_instructions', now() FROM");
q = q.replace(
  "COALESCE((($3::jsonb)->>'onboarding_safety_done')::boolean,false), updated_at = now();",
  "COALESCE((($3::jsonb)->>'onboarding_safety_done')::boolean,false), custom_instructions = COALESCE(EXCLUDED.custom_instructions, cp.custom_instructions), updated_at = now();"
);
if ((q.match(/custom_instructions/g) || []).length < 3) throw new Error('upsert-замены не полны');
ups.parameters.query = q;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: ProfileTool — custom_instructions в whitelist + upsert');
