#!/usr/bin/env node
/*
 * LogWorkoutTool001: узел «Сессия» ВСЕГДА делал INSERT новой сессии → одна тренировка,
 * записанная многими вызовами log_workout (упражнение за упражнением), дробилась на N сессий.
 * Фикс: НАЙТИ-ИЛИ-СОЗДАТЬ сессию за сегодня — если сессия за (bot,user,performed_on) уже есть,
 * переиспользовать её id; иначе создать. Строки дополняют одну сессию.
 * Идемпотентно (маркер: 'existing AS'). Запуск: node transform-logworkout-session-reuse.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/lw-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const s = byName['Сессия']; if (!s) throw new Error('нет узла Сессия');
if ((s.parameters.query || '').includes('existing AS')) { console.log('уже есть — пропуск'); process.exit(0); }

s.parameters.query =
"WITH existing AS (SELECT id FROM workout_session WHERE bot_id=$1 AND user_id=$2 AND performed_on=$3::date ORDER BY id DESC LIMIT 1), "
+ "ins AS (INSERT INTO workout_session (bot_id,user_id,performed_on,session_type,duration_min,note,source) SELECT $1,$2,$3::date,$4,$5,$6,'client' WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id) "
+ "SELECT COALESCE((SELECT id FROM existing),(SELECT id FROM ins)) AS id;";

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: LogWorkoutTool — Сессия теперь найти-или-создать за сегодня (без дробления)');
