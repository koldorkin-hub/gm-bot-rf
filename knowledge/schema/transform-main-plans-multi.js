#!/usr/bin/env node
/*
 * main: раздельные горизонты плана (active_plan / plan_month / plan_week).
 *  1) Build Profile Context: инжект plan_month, plan_week отдельными строками.
 *  2) save_profile: описание пополнено ключами plan_month, plan_week.
 *  3) systemMessage: правило про три независимых горизонта (не перезаписывают друг друга;
 *     обновляешь один — трогаешь только его; смена плана = перезапись поля целиком).
 * Идемпотентно (маркер: 'plan_week'). Запуск: node transform-main-plans-multi.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');
const bpc = byName['Build Profile Context']; if (!bpc) throw new Error('нет Build Profile Context');
const sp = byName['save_profile']; if (!sp) throw new Error('нет save_profile');

let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');
if (sm.includes('plan_week')) { console.log('уже есть — пропуск'); process.exit(0); }

// 1) Build Profile Context — строки месяц/неделя после active_plan
const bcode = bpc.parameters.jsCode;
const anchorLine = "if (has(prof.active_plan)) lines.push('АКТИВНЫЙ ПЛАН/ПРОГРАММА КЛИЕНТА (веди его по нему ИЗО ДНЯ В ДЕНЬ, помни между сессиями, обновляй по мере изменений): ' + prof.active_plan);";
if (!bcode.includes(anchorLine)) throw new Error('якорь active_plan в Build Profile Context не найден');
const addLine = anchorLine
  + "\nif (has(prof.plan_month)) lines.push('ПЛАН НА МЕСЯЦ/ЦИКЛ: ' + prof.plan_month);"
  + "\nif (has(prof.plan_week)) lines.push('ПЛАН НА НЕДЕЛЮ: ' + prof.plan_week);";
bpc.parameters.jsCode = bcode.replace(anchorLine, addLine);

// 2) save_profile описание
sp.parameters.description = (sp.parameters.description || '') +
  ' Планы хранятся в ТРЁХ раздельных ключах (НЕ перезаписывают друг друга): active_plan (общий/долгосрочный), plan_month (месяц/цикл), plan_week (неделя). Обновляя один горизонт — передавай ТОЛЬКО его ключ с ПОЛНЫМ текстом этого поля; сохранение перезаписывает именно это поле (замена старого на новый), остальные не трогаются.';

// 3) systemMessage — правило трёх горизонтов вместо одиночного active_plan
const old = "Когда с клиентом согласован план/программа (диета, цели, тренировки, добавки, режим, договорённость сопровождать по дням) — СОХРАНИ его целиком через save_profile в active_plan (полный актуальный текст) и веди клиента по нему изо дня в день; при изменениях сразу обновляй (полный обновлённый текст). Так план не потеряется между днями.";
if (!sm.includes(old)) throw new Error('якорь active_plan в systemMessage не найден');
const neu = "Планы клиента хранятся в ТРЁХ ОТДЕЛЬНЫХ полях (через save_profile) — они НЕ перезаписывают друг друга: active_plan (ОБЩИЙ/долгосрочный: цель периода, этапы), plan_month (план на текущий месяц/цикл), plan_week (план на текущую неделю). Когда согласовали план на каком-то горизонте — сохрани его в СВОЁ поле, полным текстом ЭТОГО поля. Обновляешь недельный план — сохраняешь ТОЛЬКО plan_week (месячный и общий при этом не трогаются, останутся как были). Клиент передумал или хочет другой план — просто сохрани НОВЫЙ полный текст в нужное поле: оно ПЕРЕЗАПИШЕТСЯ (старый план заменится новым). ВАЖНО: поля профиля (планы, настройки) при сохранении ПЕРЕЗАПИСЫВАЮТСЯ — ты МОЖЕШЬ заменить план на новый (в отличие от журналов еды/тренировок, где отдельные записи ты удалять не умеешь). Всегда сохраняй ПОЛНЫЙ текст поля, а не кусок. Веди клиента по этим планам изо дня в день, помни их между сессиями.";
sm = sm.replace(old, neu);
ai.parameters.options.systemMessage = sm;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — три горизонта плана (active_plan/plan_month/plan_week) + правило');
