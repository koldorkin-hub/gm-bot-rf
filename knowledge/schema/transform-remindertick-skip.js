/**
 * Тикер напоминаний (ReminderTick01): не присылать напоминание, если дело уже сделано.
 *
 * Сценарий владельца (11.09.2026): бот поставил «взвеситься в 10:00», человек взвесился
 * сам в 8 утра и записал — а в 10 всё равно пришло напоминание.
 *
 * 1. «Напоминания: выборка» сначала закрывает напоминания с done_when, дело по которым
 *    клиент уже сделал в тот же день по своему часовому поясу, — статус skipped_done,
 *    ничего не отправляется, в историю диалога не пишется. Сверка — по дате самой записи
 *    (measured_on / eaten_on / performed_on), а не по моменту ввода: «вчера был 83»,
 *    записанное сегодня, сегодняшнее напоминание не закрывает.
 * 2. Пропуск НЕ обрывает серию: следующий повтор ставится так же, как после отправки.
 *    Прежний код ставил повтор только при успешной отправке — без этой правки
 *    еженедельное напоминание умерло бы после первого же пропуска.
 * 3. «Напоминания: закрыть» теперь переносит done_when в следующий повтор. Иначе связь
 *    терялась бы после первой обычной отправки.
 *
 * Лекарства сюда не попадают: для них инструмент всегда ставит done_when = 'none'.
 * Тренировка закрывает только тренировку ТОГО ЖЕ вида — решение владельца.
 *
 * Прогон:  node transform-remindertick-skip.js <вход.json> <выход.json>
 */
const fs = require('fs');

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node transform-remindertick-skip.js <in.json> <out.json>'); process.exit(1); }
const fail = (m) => { console.error('ОШИБКА: ' + m); process.exit(1); };

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = (n) => wf.nodes.find((x) => x.name === n) || fail('нет узла ' + n);
const swap = (s, from, to, what) => {
  const k = s.split(from).length - 1;
  if (k !== 1) fail(what + ': шаблон встречается ' + k + ' раз, ожидался один — править руками');
  return s.replace(from, () => to);
};

const NEW_SELECT = String.raw`-- Сначала закрываем напоминания, дело по которым клиент уже сделал сам в тот же день.
-- Лекарства сюда не попадают: для них done_when всегда 'none'.
WITH due AS (
  SELECT r.id, r.bot_id, r.user_id, r.done_when,
         (r.fire_at AT TIME ZONE COALESCE(NULLIF(cp.timezone, ''), 'Europe/Moscow'))::date AS target_day
    FROM reminder r
    LEFT JOIN client_profile cp ON cp.bot_id = r.bot_id AND cp.user_id = r.user_id
   WHERE r.status = 'pending' AND r.fire_at <= now() AND r.done_when <> 'none'
),
done AS (
  SELECT d.id FROM due d
   WHERE (d.done_when LIKE 'measurement:%' AND EXISTS (
            SELECT 1 FROM measurement m
             WHERE m.bot_id = d.bot_id AND m.user_id = d.user_id AND m.measured_on = d.target_day
               AND lower(m.metric) = ANY (CASE split_part(d.done_when, ':', 2)
                     WHEN 'weight'       THEN ARRAY['weight', 'вес']
                     WHEN 'waist'        THEN ARRAY['waist', 'талия']
                     WHEN 'hip'          THEN ARRAY['hip', 'бёдра', 'бедра']
                     WHEN 'body_fat_pct' THEN ARRAY['body_fat_pct', 'body_fat', 'жир']
                     ELSE ARRAY[split_part(d.done_when, ':', 2)] END)))
      OR (d.done_when LIKE 'food:%' AND EXISTS (
            SELECT 1 FROM food_log f
             WHERE f.bot_id = d.bot_id AND f.user_id = d.user_id AND f.eaten_on = d.target_day
               AND f.meal_type = split_part(d.done_when, ':', 2)))
      OR (d.done_when LIKE 'workout:%' AND EXISTS (
            SELECT 1 FROM workout_session w
             WHERE w.bot_id = d.bot_id AND w.user_id = d.user_id AND w.performed_on = d.target_day
               AND w.session_type = split_part(d.done_when, ':', 2)))
),
skipped AS (
  UPDATE reminder r SET status = 'skipped_done', sent_at = now()
    FROM done WHERE r.id = done.id AND r.status = 'pending'
  RETURNING r.id, r.bot_id, r.user_id, r.chat_id, r.fire_at, r.text, r.repeat_rule, r.done_when
),
-- Пропуск не обрывает серию: следующий повтор ставим так же, как после отправки.
nxt AS (
  INSERT INTO reminder (bot_id, user_id, chat_id, fire_at, text, repeat_rule, done_when)
  SELECT bot_id, user_id, chat_id,
         CASE repeat_rule WHEN 'daily' THEN fire_at + interval '1 day' ELSE fire_at + interval '7 days' END,
         text, repeat_rule, done_when
    FROM skipped WHERE repeat_rule IN ('daily', 'weekly')
)
SELECT r.id, r.bot_id, r.user_id, COALESCE(r.chat_id, r.user_id) AS chat_id, r.text,
       r.repeat_rule, c.bot_token
  FROM reminder r JOIN clients c ON c.bot_id = r.bot_id
 WHERE r.status = 'pending' AND r.fire_at <= now()
   AND r.id NOT IN (SELECT id FROM skipped)
 ORDER BY r.fire_at
 LIMIT 50;`;

// ---- 1) выборка ----
const sel = byName('Напоминания: выборка');
if (sel.parameters.query.includes('skipped_done')) {
  console.log('~ выборка уже правлена');
} else {
  if (!sel.parameters.query.includes("WHERE r.status = 'pending' AND r.fire_at <= now()")) fail('выборка не той версии — править руками');
  sel.parameters.query = NEW_SELECT;
}

// ---- 2) закрыть: переносить done_when в следующий повтор ----
const cls = byName('Напоминания: закрыть');
let q = cls.parameters.query;
if (q.includes('repeat_rule, done_when')) {
  console.log('~ закрытие уже правлено');
} else {
  q = swap(q, 'RETURNING bot_id, user_id, chat_id, text, repeat_rule, fire_at',
              'RETURNING bot_id, user_id, chat_id, text, repeat_rule, fire_at, done_when', 'закрыть/RETURNING');
  q = swap(q, 'INSERT INTO reminder (bot_id, user_id, chat_id, fire_at, text, repeat_rule)',
              'INSERT INTO reminder (bot_id, user_id, chat_id, fire_at, text, repeat_rule, done_when)', 'закрыть/INSERT');
  q = swap(q, 'text, repeat_rule\n    FROM done WHERE $3',
              'text, repeat_rule, done_when\n    FROM done WHERE $3', 'закрыть/SELECT');
  cls.parameters.query = q;
}

fs.writeFileSync(OUT, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2), 'utf8');

// ---- проверка ----
const back = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const w = Array.isArray(back) ? back[0] : back;
const s2 = w.nodes.find((n) => n.name === 'Напоминания: выборка').parameters.query;
const c2 = w.nodes.find((n) => n.name === 'Напоминания: закрыть').parameters.query;
let total = 0; const bad = [];
const check = (name, cond) => { total++; if (!cond) { bad.push(name); console.log('  ПЛОХО: ' + name); } };

check('выборка: пропуск со статусом skipped_done', /status = 'skipped_done'/.test(s2));
check('выборка: пропущенные не уходят на отправку', /r\.id NOT IN \(SELECT id FROM skipped\)/.test(s2));
check('выборка: у пропущенных ставится следующий повтор', /INSERT INTO reminder[\s\S]*FROM skipped WHERE repeat_rule IN/.test(s2));
check('выборка: сверка по дате записи, а не по моменту ввода', /measured_on = d\.target_day/.test(s2) && /eaten_on = d\.target_day/.test(s2) && /performed_on = d\.target_day/.test(s2));
check('выборка: день считается в поясе клиента', /AT TIME ZONE COALESCE\(NULLIF\(cp\.timezone/.test(s2));
check('выборка: тренировка — только тот же вид', /w\.session_type = split_part\(d\.done_when, ':', 2\)/.test(s2));
check('выборка: без связи в пропуск не попадает', /r\.done_when <> 'none'/.test(s2));
check('выборка: столбцы для отправки прежние', /SELECT r\.id, r\.bot_id, r\.user_id, COALESCE\(r\.chat_id, r\.user_id\) AS chat_id, r\.text,\s+r\.repeat_rule, c\.bot_token/.test(s2));
check('выборка: вес — и «weight», и «вес»', /ARRAY\['weight', 'вес'\]/.test(s2));
check('закрыть: связь переходит в следующий повтор', /RETURNING[^;]*done_when/.test(c2) && /INSERT INTO reminder \([^)]*done_when\)/.test(c2) && /text, repeat_rule, done_when\s+FROM done/.test(c2));
check('закрыть: остальное не тронуто', /CASE WHEN \$3 THEN 'sent' ELSE 'failed' END/.test(c2) && /INSERT INTO n8n_chat_histories/.test(c2));
check('узлы и связи на месте', w.nodes.length === wf.nodes.length && JSON.stringify(w.connections) === JSON.stringify(wf.connections));

if (bad.length) fail('провалено ' + bad.length + ' из ' + total + ' проверок');
console.log('OK ->', OUT, '| проверок пройдено:', total, '(SQL проверяется отдельно, живым прогоном в транзакции)');
