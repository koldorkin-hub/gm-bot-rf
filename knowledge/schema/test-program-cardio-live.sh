#!/bin/bash
# Живые тесты через настоящий вебхук на ИЗОЛИРОВАННОМ клиенте users:999608. Сценарий — ровно тот,
# на котором сломался владелец: программа как у него (v2), а в выжимке и нити диалога лежат
# неверные раскладки. В конце — полная уборка.
cd /root/memory-block/diag || exit 1
U=999608
PG() { sudo -u postgres psql -d n8n_memory "$@"; }
SECRET=$(PG -At -c "select webhook_secret from clients where bot_id='users'" 2>/dev/null | tr -d ' \n')
URL=https://n8n.exlogist.com/webhook/904e1298-08ed-4687-b7f7-3505bfb377b9/trainer/users
MID=9700
PASS=0; FAIL=0
ok()  { echo "  OK   $1"; PASS=$((PASS+1)); }
bad() { echo "  ПЛОХО $1"; FAIL=$((FAIL+1)); }

send() {
  MID=$((MID+1))
  python3 - "$MID" "$1" > /tmp/clt.json <<'PY'
import json, sys
print(json.dumps({"message": {"message_id": int(sys.argv[1]),
  "from": {"id": 999608, "is_bot": False, "first_name": "Тест", "language_code": "ru"},
  "chat": {"id": 999608, "type": "private"}, "date": 1788900000, "text": sys.argv[2]}}, ensure_ascii=False))
PY
  C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" -H "x-telegram-bot-api-secret-token: $SECRET" -H "Content-Type: application/json" -d @/tmp/clt.json)
  echo "  → «$1» (http $C)"
  sleep "$2"
}
last_ai() {
  PG -At -c "select regexp_replace(coalesce(message->>'content',''),'[[:space:]]+',' ','g') from n8n_chat_histories
             where session_id='users:$U' and message->>'type'='ai' and coalesce(message->>'content','') not like 'Calling %'
             order by id desc limit 1" 2>/dev/null
}
day4_check() {
  python3 - "$1" <<'PY'
import sys
r = sys.argv[1]
order = ["Жим Арнольда", "Разводка гантелей лёжа", "Тяга верхнего блока узким хватом", "Молотки", "Трицепс на блоке"]
pos = [r.find(x) for x in order]
print("all" if all(p >= 0 for p in pos) else "missing")
print("order" if all(p >= 0 for p in pos) and pos == sorted(pos) else "broken")
foreign = [x for x in ["Жим штанги", "Баттерфляй", "Скручивания", "Планка", "Подъём ног", "Жим гантелей сидя", "Тяга горизонтального"] if x in r]
print("clean" if not foreign else "foreign:" + ",".join(foreign))
last = max(pos) if all(p >= 0 for p in pos) else -1
el = [i for i in (r.find("Эллипс"), r.find("Велотренаж")) if i >= 0]
print("cardio_ok" if (not el or min(el) > last) else "cardio_inside")
PY
}

echo "=== ПОДГОТОВКА: ПРОГРАММА КАК У ВЛАДЕЛЬЦА + НЕВЕРНЫЕ СВОДКИ ==="
PG -q 2>/dev/null <<SQL
insert into user_access (bot_id,user_id,access_until,note) values ('users',$U,current_date+1,'тест кардио')
  on conflict (bot_id,user_id) do update set access_until=excluded.access_until;
insert into client_profile (bot_id,user_id,language,onboarding_done,onboarding_safety_done,timezone,sex,birth_date,height_cm,current_weight_kg,plan_week)
values ('users',$U,'Russian',true,true,'Europe/Moscow','male','1981-03-10',180,97,'Пн — День 1; Вт — День 2; Чт — День 3; Пт — День 4; Ср/Сб/Вс — отдых, кардио')
on conflict (bot_id,user_id) do update set onboarding_done=true, onboarding_safety_done=true, language='Russian', timezone='Europe/Moscow',
  plan_week='Пн — День 1; Вт — День 2; Чт — День 3; Пт — День 4; Ср/Сб/Вс — отдых, кардио';
insert into training_program (bot_id,user_id,version,status,title,days,cardio,started_on,note)
select 'users',$U,1,'active',title,days,cardio,current_date,'копия программы владельца для теста'
  from training_program where bot_id='gymak' and user_id=255171226 and status='active';
insert into client_summary (bot_id,user_id,summary_text,updated_at) values ('users',$U,
 'Недельный цикл: День 1 — Спина + Бицепс + Пресс; День 2 — Грудь + Плечи + Трицепс + Пресс; День 3 — Ноги + Пресс; День 4 — Верх (акцент отстающих) + Пресс. Кардио эллипс 60 мин + велотренажёр 30 мин.', now())
 on conflict (bot_id,user_id) do update set summary_text=excluded.summary_text;
insert into dialog_summary (bot_id,user_id,summary_text,last_message_id,updated_at) values ('users',$U,
 '[2026-09-11] День 4 — ВЕРХ (акцент отстающих) + ПРЕСС по плану (Жим штанги, Баттерфляй, Разводка гантелей, Жим гантелей сидя, Молотки, Трицепс на блоке, Скручивания, Подъём ног на наклонной, Планка).', 0, now())
 on conflict (bot_id,user_id) do update set summary_text=excluded.summary_text;
SQL
echo "  программа теста: $(PG -At -c "select 'дней ' || jsonb_array_length(days) || ', кардио ' || jsonb_array_length(cardio) from training_program where bot_id='users' and user_id=$U and status='active'" 2>/dev/null)"

echo
echo "=== Т1. «РАСПИШИ ДЕНЬ 4» ПРИ НЕВЕРНЫХ СВОДКАХ — ТОЛЬКО ПРОГРАММА ==="
send "Распиши мне тренировку на День 4" 70
R=$(last_ai); echo "  ответ: ${R:0:420}"
day4_check "$R" > /tmp/c1.out
grep -q "^all$" /tmp/c1.out && ok "все 5 упражнений Дня 4 на месте" || bad "не все упражнения Дня 4"
grep -q "^order$" /tmp/c1.out && ok "порядок как в программе" || bad "порядок не совпадает"
grep -q "^clean$" /tmp/c1.out && ok "ни пресса, ни упражнений других дней из сводок" || bad "подмешано: $(grep foreign /tmp/c1.out)"
grep -q "^cardio_ok$" /tmp/c1.out && ok "кардио не вставлено в силовой день" || bad "кардио внутри раскладки"

echo
echo "=== Т2. «НЕПРАВИЛЬНО!» — СНАЧАЛА СВЕРКА С ПРОГРАММОЙ ==="
send "Неправильно!" 60
GET=$(PG -At -c "select count(*) from n8n_chat_histories where session_id='users:$U' and message->>'type'='tool' and message->>'content' like '%Действующая программа, версия%'" 2>/dev/null)
[ "${GET:-0}" -ge 1 ] && ok "бот прочитал программу (training_program get)" || bad "бот не сверился с программой"
R=$(last_ai); echo "  ответ: ${R:0:300}"
day4_check "$R" > /tmp/c2.out
if grep -q "^all$" /tmp/c2.out; then
  grep -q "^clean$" /tmp/c2.out && grep -q "^cardio_ok$" /tmp/c2.out && ok "повторная раскладка — ровно программа" || bad "повторная раскладка с примесью: $(grep -E 'foreign|cardio_inside' /tmp/c2.out)"
else
  echo "  (раскладку заново не выдал — проверяю только отсутствие примеси)"
  grep -q "^clean$" /tmp/c2.out && ok "в ответе нет чужих упражнений" || bad "в ответе чужие упражнения: $(grep foreign /tmp/c2.out)"
fi

echo
echo "=== Т3. СИЛОВАЯ И КАРДИО ОДНИМ СООБЩЕНИЕМ — ДВЕ ОТДЕЛЬНЫЕ ТРЕНИРОВКИ ==="
send "Сделал жим Арнольда 3 подхода по 10 с гантелями 16 кг, а потом эллипс 60 минут" 60
S=$(PG -At -c "select string_agg(s.session_type || '[' || (select string_agg(distinct e.activity_name, ',') from workout_entry e where e.session_id=s.id) || ']', ' ; ' order by s.id) from workout_session s where s.user_id=$U and s.performed_on=(now() at time zone 'Europe/Moscow')::date" 2>/dev/null)
echo "  сессии за сегодня: $S"
MIX=$(PG -At -c "select count(*) from workout_session s join workout_entry e on e.session_id=s.id where s.user_id=$U and s.session_type is distinct from 'cardio' and (e.kind='cardio' or e.activity_name ~* 'эллипс|велотрен')" 2>/dev/null)
[ "${MIX:-1}" = "0" ] && ok "в силовой нет кардио" || bad "кардио внутри силовой ($MIX строк)"
CAR=$(PG -At -c "select count(*) from workout_session s join workout_entry e on e.session_id=s.id where s.user_id=$U and s.session_type='cardio' and e.activity_name ~* 'эллипс'" 2>/dev/null)
[ "${CAR:-0}" -ge 1 ] && ok "эллипс — в отдельной кардио-тренировке" || bad "эллипс не записан отдельной кардио-тренировкой"
STR=$(PG -At -c "select count(*) from workout_session s join workout_entry e on e.session_id=s.id where s.user_id=$U and s.session_type is distinct from 'cardio' and e.activity_name ~* 'арнольд'" 2>/dev/null)
[ "${STR:-0}" -ge 1 ] && ok "жим Арнольда — в силовой" || bad "жим Арнольда не записан в силовую"

echo
echo "=== Т4. ПОПЫТКА ВПИСАТЬ ЭЛЛИПС В СИЛОВОЙ ДЕНЬ — БАЗА ЭТОГО НЕ ДОПУСКАЕТ ==="
send "Добавь насовсем в начало Дня 4 эллипс на 20 минут как разминку" 70
V=$(PG -At -c "select version || '|' || (days::text ~* 'эллипс|велотренаж')::text || '|' || jsonb_array_length(days) || '|' || jsonb_array_length(cardio) from training_program where bot_id='users' and user_id=$U and status='active'" 2>/dev/null)
echo "  программа после: версия|кардио в днях|дней|видов кардио = $V"
[ "$(echo "$V" | cut -d'|' -f2)" = "false" ] && ok "в силовых днях кардио нет" || bad "кардио попало в силовой день"
[ "$(echo "$V" | cut -d'|' -f3)" = "4" ] && ok "все 4 дня на месте" || bad "потеряны дни"
echo "  ответ клиенту: $(last_ai | cut -c1-280)"

echo
echo "=== ОШИБКИ ЗА ВРЕМЯ ТЕСТОВ ==="
ERR=$(PG -At -c "select count(*) from ops_error where at > now() - interval '15 minutes'" 2>/dev/null)
[ "${ERR:-0}" = "0" ] && ok "журнал сбоёв пуст" || { bad "в журнале сбоёв $ERR записей"; PG -At -c "select node_name||': '||left(message,160) from ops_error where at > now() - interval '15 minutes' order by at desc limit 5" 2>/dev/null | sed 's/^/    /'; }

echo
echo "=== УБОРКА ==="
PG -q 2>/dev/null <<SQL
delete from workout_entry where session_id in (select id from workout_session where user_id=$U);
delete from workout_session where user_id=$U;
delete from food_log where user_id=$U;
delete from measurement where user_id=$U;
delete from reminder where user_id=$U;
delete from training_program where user_id=$U;
delete from client_summary where user_id=$U;
delete from dialog_summary where user_id=$U;
delete from extraction_state where user_id=$U;
delete from usage_event where user_id=$U;
delete from client_profile where user_id=$U;
delete from user_access where user_id=$U;
delete from n8n_chat_histories where session_id like '%:$U';
SQL
echo "  осталось: $(PG -At -c "select (select count(*) from workout_session where user_id=$U)+(select count(*) from training_program where user_id=$U)+(select count(*) from client_summary where user_id=$U)+(select count(*) from dialog_summary where user_id=$U)+(select count(*) from client_profile where user_id=$U)+(select count(*) from n8n_chat_histories where session_id like '%:$U')" 2>/dev/null) строк"
echo
echo "ИТОГ: пройдено $PASS, провалено $FAIL"
