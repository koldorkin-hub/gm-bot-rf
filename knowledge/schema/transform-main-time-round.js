#!/usr/bin/env node
/*
 * Build Profile Context: «СЕЙЧАС У КЛИЕНТА» с шагом 5 минут (вместо каждой минуты).
 * Нужно для prompt caching: минутная метка в начале системного промпта ломала кэш
 * между сообщениями; шаг 5 мин совпадает с TTL кэша Anthropic.
 * Идемпотентно (маркер: _d5). Запуск: node transform-main-time-round.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/main-w4.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const bpc = wf.nodes.find(n => n.name === 'Build Profile Context');
if (!bpc) throw new Error('нет Build Profile Context');
if (bpc.parameters.jsCode.includes('_d5')) { console.log('уже применено — пропуск'); process.exit(0); }
const anchor = "try { _now = new Date().toLocaleString('sv-SE', { timeZone: _tz }).slice(0,16); } catch (e) { _now = new Date().toISOString().slice(0,16).replace('T',' '); }";
if (!bpc.parameters.jsCode.includes(anchor)) throw new Error('якорь времени в BPC не найден');
bpc.parameters.jsCode = bpc.parameters.jsCode.replace(anchor,
  "const _d5 = new Date(Math.floor(Date.now() / 300000) * 300000);\ntry { _now = _d5.toLocaleString('sv-SE', { timeZone: _tz }).slice(0,16); } catch (e) { _now = _d5.toISOString().slice(0,16).replace('T',' '); }");
fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: BPC — время клиента с шагом 5 минут (под prompt caching)');
