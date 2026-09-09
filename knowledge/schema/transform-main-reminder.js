/**
 * Главный workflow: регистрация инструмента напоминаний + правила.
 *
 * Повод: бот отправлял клиента заводить будильник, потому что инструмента не было.
 * Теперь есть set_reminder, и промпт прямо запрещает отговорки.
 *
 * Время в инструмент передаём как дату+время «по клиенту» или «через N минут»,
 * перевод в UTC делает Postgres. Модель к арифметике времени не подпускаем —
 * сегодняшняя история с датами показала, чем это кончается.
 *
 * Прогон:  node schema/transform-main-reminder.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-main-reminder.js <in.json> <out.json>'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(doc) ? doc[0] : doc;
const byName = (n) => wf.nodes.find((x) => x.name === n);
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };
const swap = (s, from, to) => { if (s.indexOf(from) === -1) fail('не нашёл: ' + from.slice(0, 50)); return s.replace(from, () => to); };

// --- пояс клиента наружу (нужен инструменту) ---
const bpc = byName('Build Profile Context') || fail('нет Build Profile Context');
if (bpc.parameters.jsCode.indexOf('tz: _tz') === -1) {
  bpc.parameters.jsCode = swap(bpc.parameters.jsCode,
    'today_date: _today } }];', 'today_date: _today, tz: _tz } }];');
}

// --- узел инструмента, по образцу существующих ---
const model = byName('log_measurement') || fail('нет log_measurement — не с чего копировать форму');
if (!byName('set_reminder')) {
  wf.nodes.push({
    parameters: {
      name: 'set_reminder',
      description:
        'Ставит, показывает и отменяет НАПОМИНАНИЯ клиенту. Бот умеет напоминать сам — ' +
        'НИКОГДА не предлагай клиенту завести будильник и не проси «напиши мне первым». ' +
        'action=create — поставить: text (что напомнить, коротко и по делу) плюс ЛИБО when_date (ГГГГ-ММ-ДД) и ' +
        'when_time (ЧЧ:ММ по времени клиента), ЛИБО in_minutes (через сколько минут). ' +
        'Дату бери ТОЛЬКО из служебной справки СЕГОДНЯ (там есть сегодня, вчера, завтра и вся неделя) — не вычисляй сам. ' +
        'repeat=daily или weekly — если напоминать регулярно, иначе не передавай. ' +
        'action=list — показать активные напоминания с номерами. ' +
        'action=cancel + id — отменить (номер сначала узнай через list). ' +
        'Напоминание придёт клиенту само в назначенное время.',
      source: 'database',
      workflowId: { __rl: true, mode: 'list', value: 'ReminderTool01', cachedResultName: 'Инструмент — Напоминания' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          bot_id: "={{ $('Load Config').first().json.bot_id }}",
          user_id: "={{ $('Normalize').first().json.message.from.id }}",
          chat_id: "={{ $('Normalize').first().json.message.chat.id }}",
          tz: "={{ $('Build Profile Context').first().json.tz }}",
          action: "={{ $fromAI('action', 'create | list | cancel', 'string') }}",
          text: "={{ $fromAI('text', 'что напомнить, коротко', 'string') }}",
          when_date: "={{ $fromAI('when_date', 'дата ГГГГ-ММ-ДД из справки СЕГОДНЯ', 'string') }}",
          when_time: "={{ $fromAI('when_time', 'время ЧЧ:ММ по часам клиента', 'string') }}",
          in_minutes: "={{ $fromAI('in_minutes', 'через сколько минут, если сказано относительно', 'number') }}",
          repeat: "={{ $fromAI('repeat', 'daily | weekly, иначе пусто', 'string') }}",
          id: "={{ $fromAI('id', 'номер напоминания для отмены', 'number') }}",
        },
        matchingColumns: [],
        schema: ['bot_id', 'tz', 'action', 'text', 'when_date', 'when_time', 'repeat'].map((id) => ({
          id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string',
        })).concat(['user_id', 'chat_id', 'in_minutes', 'id'].map((id) => ({
          id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number',
        }))),
      },
    },
    id: 'm-remind-0000-4000-8000-000000000001',
    name: 'set_reminder',
    type: model.type,
    typeVersion: model.typeVersion,
    position: [model.position[0], model.position[1] + 220],
  });
}

// подключаем инструмент к агенту тем же типом связи, что и остальные
const link = wf.connections['log_measurement'] || fail('нет связи log_measurement — образец не найден');
wf.connections['set_reminder'] = JSON.parse(JSON.stringify(link));

// --- правила ---
const agent = byName('AI Agent') || fail('нет AI Agent');
const MARK = '=== НАПОМИНАНИЯ ===';
if (agent.parameters.options.systemMessage.indexOf(MARK) === -1) {
  agent.parameters.options.systemMessage += '\n\n' + [
    MARK,
    'У тебя ЕСТЬ инструмент set_reminder, и ты умеешь напоминать сам.',
    'ЗАПРЕЩЕНО отвечать «заведи будильник», «поставь себе напоминание в телефоне», «напиши мне первым»',
    'или «я не могу писать первым» — это неправда, ты можешь.',
    'Как ставить:',
    '— «напомни завтра в 7 утра» → when_date = дата ЗАВТРА из справки СЕГОДНЯ, when_time = 07:00.',
    '— «напомни через полчаса» → in_minutes = 30.',
    '— «напоминай каждый день в 9» → when_date/when_time на ближайший раз плюс repeat = daily.',
    '— Дату НИКОГДА не вычисляй сам, бери из справки. Время — по часам клиента, перевод делает система.',
    '— Поставив, подтверди словами: что и когда придёт.',
    '— «какие у меня напоминания» → action=list. «отмени напоминание» → сначала list, потом cancel с номером.',
    'Если клиент называет время, а дату нет — считай, что это ближайшее наступление: сегодня, если время ещё',
    'не прошло, иначе завтра. Дату для обоих случаев бери из справки.',
  ].join('\n');
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(doc) ? [wf] : wf, null, 2), 'utf8');

// --- проверка ---
const w = JSON.parse(fs.readFileSync(OUT, 'utf8'))[0];
const t = w.nodes.find((n) => n.name === 'set_reminder') || fail('инструмент не вставлен');
if (!w.connections['set_reminder']) fail('инструмент не подключён к агенту');
if (JSON.stringify(w.connections['set_reminder']).indexOf('AI Agent') === -1) fail('связь ведёт не к агенту');
if (w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode.indexOf('tz: _tz') === -1) fail('пояс не отдаётся');
new Function(w.nodes.find((n) => n.name === 'Build Profile Context').parameters.jsCode);
if (w.nodes.find((n) => n.name === 'AI Agent').parameters.options.systemMessage.indexOf(MARK) === -1) fail('правила не добавлены');
console.log('OK ->', OUT, '| узлов', w.nodes.length, '| инструментов у агента:',
  Object.keys(w.connections).filter((k) => JSON.stringify(w.connections[k]).indexOf('ai_tool') !== -1).length);
