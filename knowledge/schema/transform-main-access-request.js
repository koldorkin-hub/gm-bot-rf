#!/usr/bin/env node
/*
 * main: (1) переделка «Нет доступа» в ЗАЯВКУ НА ДОСТУП с авто-выдачей в период.
 *   Пущен?[нет доступа] → 'Заявка: обработать' (PG: регистрирует access_request; если бот
 *   bot_type='client' И current_date<=promo_until → авто-выдаёт user_access до grant_until)
 *   → 'Заявка: текст' (Code: текст по auto_granted/is_new) → 'Заявка: ответ' (sendMessage юзеру).
 *   На trusted/owner авто-выдачи НЕТ (только регистрация заявки) — безопасность (там граница снята).
 *   'Нет доступа' осиротеет (безвреден).
 * (2) systemMessage: блок «ТВОИ ВОЗМОЖНОСТИ» — чтобы бот правильно отвечал «а ты можешь…».
 * Идемпотентно (маркер: узел 'Заявка: обработать'). Запуск: node transform-main-access-request.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const C = wf.connections;
const push = byName['Пущен?']; if (!push) throw new Error('нет Пущен?');
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');

if (!byName['Заявка: обработать']) {
  const px = byName['Нет доступа'] ? byName['Нет доступа'].position[0] : 780;
  const py = byName['Нет доступа'] ? byName['Нет доступа'].position[1] : 60;
  const sql = "WITH cfg AS (SELECT (SELECT value FROM app_config WHERE key='access_promo_until')::date AS promo_until, (SELECT value FROM app_config WHERE key='access_grant_until')::date AS grant_until), "
    + "req AS (INSERT INTO access_request (bot_id,user_id,display_name,status) VALUES ($1,$2,$3,'pending') ON CONFLICT (bot_id,user_id) DO NOTHING RETURNING user_id), "
    + "grn AS (INSERT INTO user_access (bot_id,user_id,access_until,note,updated_at) SELECT $1,$2,(SELECT grant_until FROM cfg),'авто-доступ (заявка фокус-группы)',now() WHERE (SELECT bot_type FROM clients WHERE bot_id=$1)='client' AND current_date <= (SELECT promo_until FROM cfg) ON CONFLICT (bot_id,user_id) DO UPDATE SET access_until=EXCLUDED.access_until, note=EXCLUDED.note, updated_at=now() RETURNING user_id) "
    + "SELECT ((SELECT count(*) FROM req)>0) AS is_new, ((SELECT count(*) FROM grn)>0) AS auto_granted, (SELECT to_char(grant_until,'DD.MM.YYYY') FROM cfg) AS grant_until;";
  wf.nodes.push({ parameters: { operation: 'executeQuery', query: sql, options: { queryReplacement: "={{ [ $('Load Config').first().json.bot_id, $('Normalize').first().json.message.from.id, (($('Normalize').first().json.message.from.first_name || '') + ($('Normalize').first().json.message.from.username ? ' @'+$('Normalize').first().json.message.from.username : '')) ] }}" } },
    id: 'req-process', name: 'Заявка: обработать', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [px, py], alwaysOutputData: true, credentials: { postgres: { id: 'LXIg26xUOtUdy7DJ', name: 'Postgres account' } } });

  wf.nodes.push({ parameters: { jsCode: [
    "const r = $json || {};",
    "const g = r.grant_until || '';",
    "let text;",
    "if (r.auto_granted) { text = '👋 Привет! Доступ открыт до ' + g + ' — добро пожаловать в ИИ-Тренер!\\n\\nНапиши мне ещё раз (или сразу расскажи о своей цели) — и начнём. 💪'; }",
    "else if (r.is_new) { text = '✅ Заявка на доступ отправлена. Обычно открываю доступ в течение дня — загляни чуть позже и просто напиши мне.'; }",
    "else { text = '⏳ Твоя заявка уже у меня — скоро открою доступ. Загляни чуть позже.'; }",
    "return [{ json: { text } }];"
  ].join("\n") }, id: 'req-text', name: 'Заявка: текст', type: 'n8n-nodes-base.code', typeVersion: 2, position: [px + 220, py] });

  wf.nodes.push({ parameters: { method: 'POST', url: "=https://api.telegram.org/bot{{ $('Load Config').first().json.bot_token }}/sendMessage", sendBody: true,
    bodyParameters: { parameters: [ { name: 'chat_id', value: "={{ $('Normalize').first().json.message.chat.id }}" }, { name: 'text', value: "={{ $json.text }}" } ] }, options: { timeout: 20000 } },
    id: 'req-reply', name: 'Заявка: ответ', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [px + 440, py], onError: 'continueRegularOutput' });

  // rewire Пущен?[1] → Заявка: обработать
  C['Пущен?'].main[1] = [ { node: 'Заявка: обработать', type: 'main', index: 0 } ];
  C['Заявка: обработать'] = { main: [ [ { node: 'Заявка: текст', type: 'main', index: 0 } ] ] };
  C['Заявка: текст'] = { main: [ [ { node: 'Заявка: ответ', type: 'main', index: 0 } ] ] };
  console.log('OK: Пущен?[нет] → Заявка (регистрация + авто-выдача client/в окне)');
} else { console.log('Заявка: обработать уже есть — пропуск'); }

// capabilities block
let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');
if (!sm.includes('=== ТВОИ ВОЗМОЖНОСТИ')) {
  const anchor = '=== ТЕКУЩАЯ ДАТА ===';
  if (!sm.includes(anchor)) throw new Error('якорь ТЕКУЩАЯ ДАТА не найден');
  const block = '=== ТВОИ ВОЗМОЖНОСТИ (отвечай о них уверенно и точно) ===\n' +
'Если клиент спрашивает, что ты умеешь или можешь ли ты что-то конкретное — отвечай ДА по этому списку (это твои реальные функции), не преуменьшай:\n' +
'— принимаю текст, голосовые (расшифровываю), фото и документы;\n' +
'— читаю документы: Word (.docx), PDF (в т.ч. сканы), TXT, а также фото анализов и программ — распознаю и заношу показатели в память;\n' +
'— оцениваю телосложение и форму по фото тела (фитнес-оценка, не медицинская);\n' +
'— составляю тренировки под цель, уровень и оборудование; проверяю упражнения на твои травмы и ограничения;\n' +
'— считаю калории и БЖУ (по справочнику), подбираю рецепты, проверяю блюда на аллергены;\n' +
'— веду дневник тренировок, еды, веса и замеров; фиксирую личные рекорды;\n' +
'— строю графики прогресса (вес, сила, объём, кардио) — команда /progress;\n' +
'— делаю доказательные разборы по теме с PDF-отчётом — команда /research;\n' +
'— ищу актуальную информацию в интернете; помню твой профиль и историю между днями;\n' +
'— общаюсь на твоём языке (/language), есть тихий режим (/quiet) и поддержка (/support).\n' +
'Отвечая на «а ты можешь…», сверяйся с этим списком и говори правдиво. Чего действительно не делаешь — не заменяешь врача (диагнозы и лечение — к специалисту); об этом говори мягко.\n\n';
  sm = sm.replace(anchor, block + anchor);
  ai.parameters.options.systemMessage = sm;
  console.log('OK: systemMessage — блок ТВОИ ВОЗМОЖНОСТИ');
} else { console.log('systemMessage уже с возможностями — пропуск'); }

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('DONE');
