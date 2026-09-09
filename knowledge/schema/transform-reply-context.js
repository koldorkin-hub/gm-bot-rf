/**
 * Ответы на прошлые сообщения (пункты 1 и 3 из разбора 04.09.2026).
 *
 * Факт, с которого всё началось: Telegram ПРИКЛАДЫВАЕТ к сообщению весь процитированный
 * объект — текст, подпись, автора и file_id картинки. Узел Normalize копирует сообщение
 * целиком, то есть данные у нас были всегда. Просто ни одна строка воркфлоу к
 * message.reply_to_message никогда не обращалась (проверено: ноль упоминаний в графе).
 *
 * Что делаем:
 *  1. Цитата попадает в промпт: кто её написал (бот или клиент), когда, что в ней было.
 *     Снимается и та странность, где бот гадал по косвенным признакам, чьё это сообщение.
 *  3. При записи еды сохраняем message_id исходного сообщения. Тогда ответ на старое фото
 *     обеда разрешается ИЗ ЖУРНАЛА («это был творог 200 г, 380 ккал») — без повторного
 *     распознавания и без единого токена зрения.
 *
 * Пункт 2 (перекачивать процитированное фото в зрение) сознательно не делаем — по решению
 * владельца пунктов 1 и 3 достаточно.
 *
 * Прогон:
 *   node schema/transform-reply-context.js food <вход> <выход>   — LogFoodTool000001
 *   node schema/transform-reply-context.js main <вход> <выход>   — главный workflow
 */
const fs = require('fs');

const [, , MODE, IN, OUT] = process.argv;
if (!MODE || !IN || !OUT) { console.error('usage: node transform-reply-context.js <food|main> <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл: ' + from.slice(0, 70)); return s.replace(from, () => to); };

if (MODE === 'food') {
  const trig = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger') || fail('нет триггера');
  const vals = trig.parameters.workflowInputs.values;
  if (!vals.some((v) => v.name === 'src_message_id')) vals.push({ name: 'src_message_id', type: 'number' });
  if (!vals.some((v) => v.name === 'client_today')) vals.push({ name: 'client_today', type: 'string' });

  const prep = byName('Подготовить') || fail('нет узла Подготовить');
  let c = prep.parameters.jsCode;
  // Та же date-мина, что была в тренировках: «сегодня» бралось из серверного UTC,
  // поэтому запись после полуночи по Москве уезжала на вчера.
  c = swap(c,
    "const today = new Date().toISOString().slice(0, 10);",
    [
      "const ct = String(d.client_today || '').trim();",
      "const today = /^\\d{4}-\\d{2}-\\d{2}$/.test(ct) ? ct : new Date().toISOString().slice(0, 10);",
    ].join('\n'));
  c = swap(c,
    'carb_g: num(d.carb_g) } }];',
    'carb_g: num(d.carb_g), src_message_id: num(d.src_message_id) } }];');
  prep.parameters.jsCode = c;

  const ins = byName('Записать еду') || fail('нет узла Записать еду');
  ins.parameters.query = swap(String(ins.parameters.query),
    "carb_g,source) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,'client');",
    "carb_g,source,src_message_id) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,'client',$10);");
  ins.parameters.options.queryReplacement = swap(String(ins.parameters.options.queryReplacement),
    '$json.carb_g] }}', '$json.carb_g, $json.src_message_id] }}');
}

if (MODE === 'main') {
  // --- инструмент log_food получает id сообщения и дату клиента ---
  const tool = byName('log_food') || fail('нет узла log_food');
  const wi = tool.parameters.workflowInputs;
  wi.value.src_message_id = "={{ $('Normalize').first().json.message.message_id }}";
  wi.value.client_today = "={{ $('Build Profile Context').first().json.today_date }}";
  wi.schema = wi.schema || [];
  [['src_message_id', 'number'], ['client_today', 'string']].forEach(([id, type]) => {
    if (!wi.schema.some((s) => s.id === id)) {
      wi.schema.push({ id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type });
    }
  });

  // --- Load Profile: достаём, что записано по процитированному сообщению ---
  const lp = byName('Load Profile') || fail('нет узла Load Profile');
  lp.parameters.query = swap(String(lp.parameters.query),
    'AS today_workout;',
    [
      'AS today_workout,',
      " (SELECT json_agg(json_build_object('d', description, 'k', kcal, 'on', eaten_on) ORDER BY id)",
      '    FROM food_log',
      "   WHERE bot_id=$1 AND user_id=$2 AND src_message_id = NULLIF($3,'')::bigint) AS reply_food;",
    ].join('\n'));
  lp.parameters.options.queryReplacement = swap(String(lp.parameters.options.queryReplacement),
    "$('Normalize').first().json.message.from.id] }}",
    "$('Normalize').first().json.message.from.id, String($('Normalize').first().json.message.reply_to_message?.message_id || '')] }}");

  // --- Build Profile Context: блок с цитатой ---
  const bpc = byName('Build Profile Context') || fail('нет Build Profile Context');
  const MARK = 'КЛИЕНТ ОТВЕЧАЕТ НА КОНКРЕТНОЕ СООБЩЕНИЕ';
  if (bpc.parameters.jsCode.indexOf(MARK) === -1) {
    const code = [
      '',
      '// --- Цитата: клиент ответил на конкретное сообщение ---',
      '// Telegram кладёт процитированный объект прямо в апдейт, включая автора и подпись.',
      'const _rt = msg && msg.reply_to_message;',
      'if (_rt) {',
      '  const _RL = [];',
      "  const _who = (_rt.from && _rt.from.is_bot) ? 'ТВОЁ собственное прошлое сообщение' : 'прошлое сообщение самого клиента';",
      "  let _when = '';",
      "  try { _when = new Date(Number(_rt.date) * 1000).toLocaleString('ru-RU', { timeZone: _tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { _when = ''; }",
      "  const _body = String(_rt.text || _rt.caption || '').replace(/\\s+/g, ' ').trim().slice(0, 700);",
      "  const _kind = _rt.photo ? 'фотография' : (_rt.document ? 'документ' : (_rt.voice ? 'голосовое' : ''));",
      "  _RL.push('" + MARK + " — это и есть контекст его реплики, отвечай с учётом цитаты, а не как на новый вопрос.');",
      "  _RL.push('Цитата — это ' + _who + (_when ? ', отправлено ' + _when : '') + '.' + (_kind ? ' Тип: ' + _kind + '.' : ''));",
      "  if (_body) _RL.push('Содержимое цитаты: ' + _body);",
      '  const _rf = asObj(row.reply_food) || [];',
      '  if (_rf.length) {',
      "    _RL.push('По этому сообщению в дневнике еды УЖЕ записано: ' + _rf.map(x => String(x.d || '') + (x.k ? ' — ' + x.k + ' ккал' : '') + ' (' + String(x.on || '').slice(0, 10) + ')').join('; ') + '.');",
      "    _RL.push('Если клиент говорит «съел то же самое» — бери эти цифры из журнала, распознавать заново нечего.');",
      "  } else if (_rt.photo) {",
      "    _RL.push('Само изображение тебе сейчас НЕ передано, и в дневнике по нему записи нет. Если для ответа нужно увидеть фото — попроси прислать его заново, не выдумывай содержимое.');",
      '  }',
      "  block = _RL.join('\\n') + '\\n\\n' + block;",
      '}',
      '',
    ].join('\n');
    bpc.parameters.jsCode = swap(bpc.parameters.jsCode,
      "const lang = (prof.language && String(prof.language).trim())",
      code + "const lang = (prof.language && String(prof.language).trim())");
  }
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
// Компилируем ТОЛЬКО те узлы, которые правили: в чужих (например «Финал: собрать»)
// встречается await на верхнем уровне — для n8n это законно, для new Function нет.
const TOUCHED = MODE === 'food' ? ['Подготовить'] : ['Build Profile Context'];
TOUCHED.forEach((nm) => {
  const n = w.nodes.find((x) => x.name === nm);
  if (!n) fail('нет узла ' + nm);
  try { new Function(n.parameters.jsCode); } catch (e) { fail('код не компилируется в ' + nm + ' — ' + e.message); }
});
if (MODE === 'food') {
  if (String(w.nodes.find((n) => n.name === 'Записать еду').parameters.query).indexOf('src_message_id') === -1) fail('колонка не пишется');
  if (w.nodes.find((n) => n.name === 'Подготовить').parameters.jsCode.indexOf('client_today') === -1) fail('дата клиента не принимается');
}
if (MODE === 'main') {
  if (String(w.nodes.find((n) => n.name === 'Load Profile').parameters.query).indexOf('reply_food') === -1) fail('выборка по цитате не добавлена');
  if (w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode.indexOf('reply_to_message') === -1) fail('блок цитаты не вставлен');
  if (!w.nodes.find((n) => n.name === 'log_food').parameters.workflowInputs.value.src_message_id) fail('id сообщения не передаётся');
}
console.log('OK ->', OUT, '| режим', MODE);
