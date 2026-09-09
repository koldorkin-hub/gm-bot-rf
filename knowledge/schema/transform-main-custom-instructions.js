#!/usr/bin/env node
/*
 * main: персональные настройки поведения (custom_instructions).
 *  1) Build Profile Context: строка с настройками клиента в блок профиля агента.
 *  2) save_profile (toolWorkflow): описание пополнено ключом custom_instructions.
 *  3) systemMessage: блок «=== ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ ===» (распознать/сохранить/учитывать,
 *     подчинение безопасности).
 * Идемпотентно (маркер: 'ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ'). Запуск: node transform-main-custom-instructions.js <path>
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
if (sm.includes('=== ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ')) { console.log('уже есть — пропуск'); process.exit(0); }

// 1) Build Profile Context — строка настроек после блока АКТИВНЫЕ ОГРАНИЧЕНИЯ
const bcode = bpc.parameters.jsCode;
const anchorLine = "if (exclusions.length) lines.push('АКТИВНЫЕ ОГРАНИЧЕНИЯ (не рекомендовать эти нагрузки/активности): ' + exclusions.map(e => e.scope + ':' + e.value + (e.source ? ' [' + e.source + ']' : '')).join('; '));";
if (!bcode.includes(anchorLine)) throw new Error('якорь exclusions в Build Profile Context не найден');
const addLine = anchorLine + "\nif (has(prof.custom_instructions)) lines.push('ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ КЛИЕНТА (как он просил себя вести — учитывай в КАЖДОМ ответе, но строго в рамках правил безопасности выше): ' + prof.custom_instructions);";
bpc.parameters.jsCode = bcode.replace(anchorLine, addLine);

// 2) save_profile описание
sp.parameters.description = (sp.parameters.description || '') +
  ' ДОП. КЛЮЧ custom_instructions — свободный текст персональных пожеланий клиента о ТВОЁМ поведении (тон/стиль, длина ответов, форма обращения, эмодзи, уровень детализации). Сохраняй сюда устойчивые просьбы вида «веди себя так-то»/«запомни, что…». При обновлении впиши ПОЛНЫЙ обновлённый текст, слив с текущими настройками из профиля (не затирай прежние пожелания).';

// 3) systemMessage блок
const anchor = '=== ТЕКУЩАЯ ДАТА ===';
if (!sm.includes(anchor)) throw new Error('якорь ТЕКУЩАЯ ДАТА не найден');
const block =
'=== ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ КЛИЕНТА (кастомизация поведения) ===\n' +
'Клиент может настроить, КАК ты себя ведёшь — свободной фразой («запомни, что…», «всегда отвечай кратко», «зови меня …», «без эмодзи», «объясняй подробнее»). Типовые оси: тон/стиль, длина ответов, форма обращения, эмодзи, уровень детализации, манера изложения.\n' +
'Когда клиент выражает УСТОЙЧИВОЕ пожелание о твоём поведении:\n' +
'— сохрани его через save_profile в ключ custom_instructions. Пиши ПОЛНЫЙ обновлённый текст: возьми текущие «ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ» из профиля ниже и аккуратно слей с новым (обнови/убери конфликтующее, остальное сохрани);\n' +
'— коротко подтверди клиенту, что запомнил.\n' +
'Сохранённые настройки (в блоке профиля ниже) ты УЧИТЫВАЕШЬ в каждом ответе. На вопрос «как меня настроить / какие у меня настройки» — перечисли текущие и подскажи оси. На «сбрось настройки» — сохрани короткое «особых пожеланий нет».\n' +
'ВАЖНО: персональные настройки — это про СТИЛЬ и удобство; они НЕ отменяют и не ослабляют правила безопасности (граница компетенции, фарма/дозы, красные флаги/РПП/суицид, аллергены, устойчивость). Если пожелание противоречит этим правилам — вежливо не сохраняй именно эту часть, остальное учти.\n\n';
sm = sm.replace(anchor, block + anchor);
ai.parameters.options.systemMessage = sm;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — custom_instructions (контекст профиля + описание save_profile + systemMessage-блок)');
