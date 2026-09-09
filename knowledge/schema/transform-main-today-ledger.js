#!/usr/bin/env node
/*
 * Main: «СЕГОДНЯ УЖЕ В ЖУРНАЛЕ» — детерминированная выписка ТЕКУЩЕГО дня (еда с ккал/белком
 * + итоги, упражнения тренировки) в промпт КАЖДОГО сообщения. Лечит «потерял творог»:
 * бот не ведёт итог дня «в уме» по окну переписки, а видит дневник из базы.
 * 1. Load Profile: + today_food / today_workout (день в поясе КЛИЕНТА из client_profile.timezone).
 * 2. Build Profile Context: рендер блока над нитью диалога + итоги, посчитанные кодом.
 * 3. systemMessage: правило «что в блоке — уже учтено: не логируй повторно, не предлагай добрать этим».
 * Идемпотентно (маркер: today_food). Запуск: node transform-main-today-ledger.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/main-w3.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

const lp = byName['Load Profile']; if (!lp) throw new Error('нет Load Profile');
if (lp.parameters.query.includes('today_food')) { console.log('уже применено — пропуск'); process.exit(0); }
const lpAnchor = 'AS dialog_thread;';
if (!lp.parameters.query.includes(lpAnchor)) throw new Error('якорь Load Profile не найден');
lp.parameters.query = lp.parameters.query.replace(lpAnchor,
  "AS dialog_thread, (SELECT json_agg(json_build_object('m', f.meal_type, 't', left(f.description,60), 'k', round(f.kcal), 'p', round(f.protein_g), 'f', round(f.fat_g), 'c', round(f.carb_g)) ORDER BY f.id) FROM food_log f WHERE f.bot_id=$1 AND f.user_id=$2 AND f.eaten_on = (now() AT TIME ZONE COALESCE(NULLIF((SELECT cp2.timezone FROM client_profile cp2 WHERE cp2.bot_id=$1 AND cp2.user_id=$2),''),'Europe/Moscow'))::date) AS today_food, (SELECT json_agg(json_build_object('ex', x.ex, 'n', x.n)) FROM (SELECT we.activity_name AS ex, count(*) AS n FROM workout_entry we JOIN workout_session ws ON we.session_id=ws.id WHERE ws.bot_id=$1 AND ws.user_id=$2 AND ws.performed_on = (now() AT TIME ZONE COALESCE(NULLIF((SELECT cp3.timezone FROM client_profile cp3 WHERE cp3.bot_id=$1 AND cp3.user_id=$2),''),'Europe/Moscow'))::date GROUP BY we.activity_name ORDER BY min(we.id)) x) AS today_workout;");

const bpc = byName['Build Profile Context']; if (!bpc) throw new Error('нет Build Profile Context');
let code = bpc.parameters.jsCode;
const a1 = "const dialogThread = (row.dialog_thread == null) ? '' : String(row.dialog_thread);";
if (!code.includes(a1)) throw new Error('якорь BPC dialogThread не найден');
code = code.replace(a1, a1 + "\nconst todayFood = asObj(row.today_food) || [];\nconst todayWorkout = asObj(row.today_workout) || [];");

const a2 = "if (dialogThread && dialogThread.trim()) block = 'НИТЬ ДИАЛОГА ПОСЛЕДНИХ ДНЕЙ (что обсуждали и о чём договорились — помни это, даже если сообщений нет в окне; журналы еды/тренировок смотри через get_progress):\\n' + dialogThread.trim() + '\\n\\n' + block;";
if (!code.includes(a2)) throw new Error('якорь BPC нить-push не найден');
code = code.replace(a2, a2 + `
if (todayFood.length || todayWorkout.length) {
  const L = [];
  if (todayFood.length) {
    let tk = 0, tp = 0, tf = 0, tc = 0;
    const items = todayFood.map(x => { tk += Number(x.k) || 0; tp += Number(x.p) || 0; tf += Number(x.f) || 0; tc += Number(x.c) || 0; return (x.m ? x.m + ' — ' : '') + (x.t || '?') + ' (' + (x.k || 0) + ' ккал, Б' + (x.p || 0) + ')'; });
    L.push('Еда: ' + items.join('; ') + '. ИТОГО СЕГОДНЯ: ' + Math.round(tk) + ' ккал, Б' + Math.round(tp) + ' Ж' + Math.round(tf) + ' У' + Math.round(tc) + '.');
  }
  if (todayWorkout.length) L.push('Тренировка: ' + todayWorkout.map(x => (x.ex || '?') + ' (' + (x.n || 0) + ' подх.)').join('; ') + '.');
  block = 'СЕГОДНЯ УЖЕ В ЖУРНАЛЕ (выписка из БАЗЫ на текущий момент — это истина; всё перечисленное УЖЕ УЧТЕНО в итогах дня — НЕ логируй повторно и НЕ предлагай клиенту «добрать норму» тем, что здесь уже есть, включая записанный заранее ужин):\\n' + L.join('\\n') + '\\n\\n' + block;
}`);
bpc.parameters.jsCode = code;

const agent = wf.nodes.find(n => (n.type || '').toLowerCase().includes('agent'));
let sm = agent.parameters.options.systemMessage;
const smAnchor = 'Когда клиент просит пересмотреть или подвести итог съеденного/сделанного за день — ЧИТАЙ из базы через get_progress, НЕ создавай записи заново (иначе цифры задваиваются).';
if (!sm.includes(smAnchor)) throw new Error('якорь systemMessage анти-дубль не найден');
if (!sm.includes('СЕГОДНЯ УЖЕ В ЖУРНАЛЕ')) {
  sm = sm.replace(smAnchor, smAnchor + ' Блок «СЕГОДНЯ УЖЕ В ЖУРНАЛЕ» в профиле — живой дневник текущего дня из базы, он пересчитывается ПЕРЕД КАЖДЫМ твоим ответом: итоги дня и советы «что добрать до нормы» строй ТОЛЬКО от него, а не от своей арифметики по переписке. Всё, что в нём перечислено (включая записанный заранее ужин), уже сидит в итогах — предлагать это «добавить» или «этим закрыть остаток» НЕЛЬЗЯ; добрать можно только тем, чего в блоке нет.');
}
agent.parameters.options.systemMessage = sm;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — выписка дня в каждом промпте (Load Profile + BPC + systemMessage)');
