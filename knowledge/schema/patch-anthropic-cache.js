#!/usr/bin/env node
/*
 * ПАТЧ PROMPT CACHING для @langchain/anthropic внутри контейнера n8n.
 * Узел n8n LmChatAnthropic не пробрасывает cache_control (нет в его коде; фиче-реквест открыт,
 * PR n8n#22318 в работе). Библиотека умеет: applyCacheControlToPayload ставит cache-маркер на
 * ПОСЛЕДНИЙ блок сообщений → Anthropic кэширует ВЕСЬ префикс (tools+system+история).
 * Патч делает маркер дефолтным: 2 строки × 2 файла (dist/chat_models.js — ESM, .cjs — то, что
 * реально грузит n8n). Экономика: повторный вход 10% цены, запись +25%, TTL 5 мин.
 *
 * ⚠️ ЖИВЁТ В ФАЙЛАХ КОНТЕЙНЕРА: пересоздание контейнера/апгрейд n8n стирает патч (деградация
 * безопасная — просто снова полная цена). ПОСЛЕ КАЖДОГО АПГРЕЙДА n8n — ПРОГНАТЬ ЗАНОВО:
 *   docker cp patch-anthropic-cache.js n8n-n8n-1:/tmp/ && docker exec -u root n8n-n8n-1 node /tmp/patch-anthropic-cache.js
 *   затем docker kill n8n-n8n-1 && docker start n8n-n8n-1
 * Когда в n8n приедет нативная поддержка (PR #22318) — патч не нужен, включить опцию узла.
 * Идемпотентен. Проверка после рестарта: в execution data свежих вызовов агента появляются
 * cache_read_input_tokens / cache_creation_input_tokens.
 */
const fs = require('fs');
const path = require('path');

const pnpm = '/usr/local/lib/node_modules/n8n/node_modules/.pnpm';
const dir = fs.readdirSync(pnpm).find(d => d.startsWith('@langchain+anthropic@'));
if (!dir) throw new Error('пакет @langchain/anthropic не найден в ' + pnpm);
const dist = path.join(pnpm, dir, 'node_modules/@langchain/anthropic/dist');

const MARKER = '|| { type: "ephemeral" }';
let patched = 0, skipped = 0;
for (const f of ['chat_models.js', 'chat_models.cjs']) {
  const fp = path.join(dist, f);
  let s = fs.readFileSync(fp, 'utf8');
  if (s.includes(MARKER)) { console.log(f + ': уже пропатчен — пропуск'); skipped++; continue; }
  const before = s;
  // стриминговый путь
  s = s.replace(
    /if \(options\.cache_control\) formattedMessages = (require_message_inputs\.)?applyCacheControlToPayload\(formattedMessages, options\.cache_control\);/,
    (m, req) => 'formattedMessages = ' + (req || '') + 'applyCacheControlToPayload(formattedMessages, options.cache_control ' + MARKER + ');'
  );
  // не-стриминговый путь
  s = s.replace(
    /if \(cacheControl\) formattedMessages = (require_message_inputs\.)?applyCacheControlToPayload\(formattedMessages, cacheControl\);/,
    (m, req) => 'formattedMessages = ' + (req || '') + 'applyCacheControlToPayload(formattedMessages, cacheControl ' + MARKER + ');'
  );
  const hits = (s.match(new RegExp(MARKER.replace(/[|{}]/g, '\\$&'), 'g')) || []).length;
  if (hits !== 2 || s === before) throw new Error(f + ': ожидались 2 замены, получилось ' + hits + ' — файл изменился, патч НЕ применён');
  fs.writeFileSync(fp + '.pre-cache-patch', before);
  fs.writeFileSync(fp, s);
  console.log(f + ': пропатчен (2 точки), бэкап ' + f + '.pre-cache-patch');
  patched++;
}
console.log('ИТОГ: пропатчено файлов ' + patched + ', уже были ' + skipped + '. Нужен рестарт n8n.');
