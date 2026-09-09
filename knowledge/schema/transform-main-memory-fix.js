#!/usr/bin/env node
/*
 * main: ФИКС ПАМЯТИ И ВЕДЕНИЯ КЛИЕНТА.
 *  1) Postgres Chat Memory: contextWindowLength 20 → 40 (агент видит больше живого контекста).
 *  2) Build Profile Context: строка АКТИВНЫЙ ПЛАН (prof.active_plan) в блок профиля.
 *  3) save_profile: описание пополнено ключом active_plan.
 *  4) systemMessage блок «=== ПАМЯТЬ И ВЕДЕНИЕ КЛИЕНТА ===»: нет суточных сессий; писать сразу;
 *     при вопросе «что записано/найди» ВСЕГДА проверять базу (get_progress); не говорить «пусто/
 *     не обсуждали» без проверки; согласованный план сохранять в active_plan.
 * Идемпотентно (маркер: 'ПАМЯТЬ И ВЕДЕНИЕ КЛИЕНТА'). Запуск: node transform-main-memory-fix.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');
const bpc = byName['Build Profile Context']; if (!bpc) throw new Error('нет Build Profile Context');
const sp = byName['save_profile']; if (!sp) throw new Error('нет save_profile');
const mem = byName['Postgres Chat Memory']; if (!mem) throw new Error('нет Postgres Chat Memory');

let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');
if (sm.includes('=== ПАМЯТЬ И ВЕДЕНИЕ КЛИЕНТА')) { console.log('уже есть — пропуск'); process.exit(0); }

// 1) окно памяти
mem.parameters.contextWindowLength = 40;

// 2) Build Profile Context — строка плана после строки настроек
const bcode = bpc.parameters.jsCode;
const anchorLine = "if (has(prof.custom_instructions)) lines.push('ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ КЛИЕНТА (как он просил себя вести — учитывай в КАЖДОМ ответе, но строго в рамках правил безопасности выше): ' + prof.custom_instructions);";
if (!bcode.includes(anchorLine)) throw new Error('якорь custom_instructions в Build Profile Context не найден');
const addLine = anchorLine + "\nif (has(prof.active_plan)) lines.push('АКТИВНЫЙ ПЛАН/ПРОГРАММА КЛИЕНТА (веди его по нему ИЗО ДНЯ В ДЕНЬ, помни между сессиями, обновляй по мере изменений): ' + prof.active_plan);";
bpc.parameters.jsCode = bcode.replace(anchorLine, addLine);

// 3) save_profile описание
sp.parameters.description = (sp.parameters.description || '') +
  ' ДОП. КЛЮЧ active_plan — полный текст АКТИВНОЙ программы/плана клиента (диета, цели БЖУ, план тренировок, добавки, режим, договорённости о сопровождении). Сохраняй/обновляй его, когда с клиентом согласован или изменён план: пиши ПОЛНЫЙ актуальный текст плана, чтобы бот вёл клиента по нему изо дня в день.';

// 4) systemMessage блок
const anchor = '=== ТЕКУЩАЯ ДАТА ===';
if (!sm.includes(anchor)) throw new Error('якорь ТЕКУЩАЯ ДАТА не найден');
const block =
'=== ПАМЯТЬ И ВЕДЕНИЕ КЛИЕНТА (критично — не подводи клиента) ===\n' +
'У тебя ПОСТОЯННАЯ память, ты НЕ «обнуляешься» и у тебя НЕТ «суточных сессий». Твоя память: (1) журналы в базе — еда (log_food), тренировки (log_workout), замеры/шаги (log_measurement), рекорды; (2) профиль, аллергии, состояния, АКТИВНЫЙ ПЛАН и сводка — в блоке профиля ниже; (3) переписка. НИКОГДА не говори клиенту «у меня новая сессия», «мы ничего не обсуждали», «в базе пусто», «я обнулился», «не помню» — это неправда и подрывает доверие.\n' +
'ОБЯЗАТЕЛЬНО:\n' +
'— Записывай еду и тренировки СРАЗУ, как клиент их называет, не откладывая: каждый приём пищи → log_food немедленно; каждое упражнение (вес/повторы/подходы) → в тренировку за СЕГОДНЯ. Одна тренировка идёт МНОГО сообщений подряд — складывай их в ОДНУ сессию за сегодня (дополняй её), не заводи новую на каждое упражнение. Клиент не должен вечером повторять то, что называл днём.\n' +
'— Когда клиент спрашивает «что я ел / что записано / сколько за период» или просит НАЙТИ прошлую тренировку/приём пищи/показатель — ВСЕГДА сперва вызови get_progress (domain=measurement/workout/food/records) и отвечай ПО БАЗЕ. ЗАПРЕЩЕНО отвечать «не записано / не нахожу / не помню / пусто», не проверив инструментом. Данные почти наверняка есть — ты просто их не видишь в коротком окне переписки, поэтому иди в базу.\n' +
'— Когда с клиентом согласован план/программа (диета, цели, тренировки, добавки, режим, договорённость сопровождать по дням) — СОХРАНИ его целиком через save_profile в active_plan (полный актуальный текст) и веди клиента по нему изо дня в день; при изменениях сразу обновляй (полный обновлённый текст). Так план не потеряется между днями.\n\n';
sm = sm.replace(anchor, block + anchor);
ai.parameters.options.systemMessage = sm;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — окно 40 + active_plan (контекст+описание) + блок ПАМЯТЬ И ВЕДЕНИЕ');
