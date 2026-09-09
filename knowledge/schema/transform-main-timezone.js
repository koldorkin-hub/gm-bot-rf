#!/usr/bin/env node
/*
 * main: ЧАСОВОЙ ПОЯС КЛИЕНТА как источник «сейчас».
 * Было: ТЕКУЩАЯ ДАТА = $now (серверный/GENERIC_TIMEZONE), без времени → бот путал вчера/сегодня
 * и для клиентов в других поясах дата неверна.
 * Стало: Build Profile Context детерминированно считает дату+время+день недели в ПОЯСЕ КЛИЕНТА
 * (prof.timezone, default Europe/Moscow) через toLocaleString(timeZone) и кладёт строку
 * «СЕЙЧАС У КЛИЕНТА …» ПЕРВОЙ в блок профиля; systemMessage ТЕКУЩАЯ ДАТА отсылает к ней.
 * Идемпотентно (маркер: 'СЕЙЧАС У КЛИЕНТА'). Запуск: node transform-main-timezone.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');
const bpc = byName['Build Profile Context']; if (!bpc) throw new Error('нет Build Profile Context');

let bcode = bpc.parameters.jsCode;
if (bcode.includes('СЕЙЧАС У КЛИЕНТА')) { console.log('уже есть — пропуск'); process.exit(0); }

const anchor = "if (has(prof.active_plan)) lines.push('АКТИВНЫЙ ПЛАН/ПРОГРАММА КЛИЕНТА (веди его по нему ИЗО ДНЯ В ДЕНЬ, помни между сессиями, обновляй по мере изменений): ' + prof.active_plan);";
if (!bcode.includes(anchor)) throw new Error('якорь active_plan в Build Profile Context не найден');
const add = anchor + "\n" + [
  "const _tz = (prof.timezone && String(prof.timezone).trim()) || 'Europe/Moscow';",
  "let _now = '';",
  "try { _now = new Date().toLocaleString('sv-SE', { timeZone: _tz }).slice(0,16); } catch (e) { _now = new Date().toISOString().slice(0,16).replace('T',' '); }",
  "let _wd = '';",
  "try { _wd = new Date().toLocaleDateString('ru-RU', { timeZone: _tz, weekday: 'long' }); } catch (e) {}",
  "lines.unshift('СЕЙЧАС У КЛИЕНТА: ' + _now + (_wd ? ' (' + _wd + ')' : '') + ', часовой пояс ' + _tz + '. ЭТО и есть «сейчас/сегодня» — все даты и слова вчера/сегодня/завтра, трекинг, сроки и возраст считай ОТ ЭТОГО времени клиента, не от серверного.');"
].join("\n");
bpc.parameters.jsCode = bcode.replace(anchor, add);

// systemMessage: ТЕКУЩАЯ ДАТА → отсыл к клиентскому «сейчас»
let sm = ai.parameters.options.systemMessage;
const old = "Сегодня: {{ $now.toFormat('yyyy-MM-dd') }} ({{ $now.toFormat('cccc') }}). Используй именно эту дату для трекинга, расчёта возраста и сроков. Никогда не выдумывай даты.";
if (!sm.includes(old)) throw new Error('якорь ТЕКУЩАЯ ДАТА не найден');
const neu = "Авторитетное «сейчас» — строка «СЕЙЧАС У КЛИЕНТА» в блоке профиля ниже (дата, время и часовой пояс КЛИЕНТА). Используй ИМЕННО ЕЁ как текущие дату и время: для трекинга (eaten_on/performed_on/measured_on по умолчанию = эта дата клиента), для слов «вчера/сегодня/завтра», для расчёта возраста и сроков. НЕ бери серверное/иное время и не выдумывай даты.";
sm = sm.replace(old, neu);

// анти-дубль: не записывать одно и то же повторно
const aDup = 'Клиент не должен вечером повторять то, что называл днём.';
if (sm.includes(aDup) && !sm.includes('одно блюдо/подход логируется ОДИН раз')) {
  sm = sm.replace(aDup, aDup + ' НЕ записывай одно и то же повторно: одно блюдо/подход логируется ОДИН раз. Когда клиент просит пересмотреть или подвести итог съеденного/сделанного за день — ЧИТАЙ из базы через get_progress, НЕ создавай записи заново (иначе цифры задваиваются).');
}
ai.parameters.options.systemMessage = sm;

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — «сейчас» в поясе клиента (Build Profile Context + ТЕКУЩАЯ ДАТА)');
