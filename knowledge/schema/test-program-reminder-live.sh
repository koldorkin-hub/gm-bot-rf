#!/bin/bash
# Живые тесты через настоящий вебхук на ИЗОЛИРОВАННОМ клиенте users:999608. В конце — полная уборка.
cd /root/memory-block/diag || exit 1
U=999608
PG() { sudo -u postgres psql -d n8n_memory "$@"; }
SECRET=$(PG -At -c "select webhook_secret from clients where bot_id='users'" 2>/dev/null | tr -d ' \n')
URL=https://n8n.exlogist.com/webhook/904e1298-08ed-4687-b7f7-3505bfb377b9/trainer/users
MID=9600
PASS=0; FAIL=0
ok()  { echo "  OK   $1"; PASS=$((PASS+1)); }
bad() { echo "  ПЛОХО $1"; FAIL=$((FAIL+1)); }

send() {
  MID=$((MID+1))
  python3 - "$MID" "$1" > /tmp/lt.json <<'PY'
import json, sys
print(json.dumps({"message": {"message_id": int(sys.argv[1]),
  "from": {"id": 999608, "is_bot": False, "first_name": "Тест", "language_code": "ru"},
  "chat": {"id": 999608, "type": "private"}, "date": 1788900000, "text": sys.argv[2]}}, ensure_ascii=False))
PY
  C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" -H "x-telegram-bot-api-secret-token: $SECRET" -H "Content-Type: application/json" -d @/tmp/lt.json)
  echo "  → «$1» (http $C)"
  sleep "$2"
}
last_ai() {
  PG -At -c "select regexp_replace(coalesce(message->>'content',''),'[[:space:]]+',' ','g') from n8n_chat_histories
             where session_id='users:$U' and message->>'type'='ai' and coalesce(message->>'content','') not like 'Calling %'
             order by id desc limit 1" 2>/dev/null
}
active_prog() {
  PG -At -c "select version || '|' || (select string_agg(x, ',') from jsonb_array_elements_text((select d->'exercises' from jsonb_array_elements(days) d where (d->>'day')::int = 2)) x) || '|' || jsonb_array_length(days)
             from training_program where bot_id='users' and user_id=$U and status='active'" 2>/dev/null
}

echo "=== ПОДГОТОВКА ИЗОЛИРОВАННОГО КЛИЕНТА ==="
PG -q 2>/dev/null <<SQL
insert into user_access (bot_id,user_id,access_until,note) values ('users',$U,current_date+1,'тест программы')
  on conflict (bot_id,user_id) do update set access_until=excluded.access_until;
insert into client_profile (bot_id,user_id,language,onboarding_done,onboarding_safety_done,timezone,sex,birth_date,height_cm,current_weight_kg,plan_week)
values ('users',$U,'Russian',true,true,'Europe/Moscow','male','1990-03-10',180,85,'Пн — День 1; Пт — День 2')
on conflict (bot_id,user_id) do update set onboarding_done=true, onboarding_safety_done=true, language='Russian',
  timezone='Europe/Moscow', plan_week='Пн — День 1; Пт — День 2';
select set_training_program('users',$U,'Europe/Moscow','Тестовая программа',
 '[{"day":1,"name":"Грудь","weekday":"Пн","exercises":["Жим штанги лёжа","Баттерфляй (сведение рук в тренажёре)"]},
   {"day":2,"name":"Верх, акцент отстающих","weekday":"Пт","exercises":["Эллипс","Жим Арнольда","Разводка гантелей лёжа","Тяга верхнего блока узким хватом","Молотки","Трицепс на блоке"]}]'::jsonb,
 'исходная');
SQL
echo "  программа до тестов: $(active_prog)"

echo
echo "=== Т1. РАСКЛАДКА ДНЯ БЕРЁТСЯ ИЗ ПРОГРАММЫ, В ЕЁ ПОРЯДКЕ ==="
send "Распиши мне тренировку на День 2" 60
R=$(last_ai)
echo "  ответ: ${R:0:320}"
python3 - "$R" > /tmp/t1.out <<'PY'
import sys
r = sys.argv[1]
order = ["Эллипс", "Жим Арнольда", "Разводка гантелей лёжа", "Тяга верхнего блока узким хватом", "Молотки", "Трицепс на блоке"]
pos = [r.find(x) for x in order]
print("all" if all(p >= 0 for p in pos) else "missing")
print("order" if all(p >= 0 for p in pos) and pos == sorted(pos) else "broken")
print("clean" if ("Жим штанги лёжа" not in r and "Баттерфляй" not in r) else "foreign")
PY
grep -q "^all$" /tmp/t1.out && ok "все упражнения дня 2 из программы на месте" || bad "в раскладке не все упражнения программы"
grep -q "^order$" /tmp/t1.out && ok "порядок как в программе" || bad "порядок не совпадает с программой"
grep -q "^clean$" /tmp/t1.out && ok "чужих упражнений (из дня 1) не подмешано" || bad "подмешаны упражнения другого дня"

echo
echo "=== Т2. ЗАМЕНА НАСОВСЕМ — НОВАЯ ВЕРСИЯ, СТАРАЯ СНЯТА ==="
send "Замени в программе насовсем: в Дне 2 вместо Молотков теперь Сгибание рук с гантелями" 70
P=$(active_prog)
echo "  программа после: $P"
V=$(echo "$P" | cut -d'|' -f1); EX=$(echo "$P" | cut -d'|' -f2); ND=$(echo "$P" | cut -d'|' -f3)
[ "$V" = "2" ] && ok "действует версия 2" || bad "действующая версия не 2 (получено: $V)"
echo "$EX" | grep -q "Сгибание рук с гантелями" && ! echo "$EX" | grep -q "Молотки" && ok "в дне 2 замена сделана" || bad "замена в дне 2 не сделана"
[ "$ND" = "2" ] && ok "оба дня сохранились" || bad "потеряны дни (дней: $ND)"
RET=$(PG -At -c "select count(*) from training_program where bot_id='users' and user_id=$U and status='retired' and version=1" 2>/dev/null)
[ "$RET" = "1" ] && ok "версия 1 снята" || bad "версия 1 не снята"
ACT=$(PG -At -c "select count(*) from training_program where bot_id='users' and user_id=$U and status='active'" 2>/dev/null)
[ "$ACT" = "1" ] && ok "действующая ровно одна" || bad "действующих: $ACT"
echo "  ответ клиенту: $(last_ai | cut -c1-260)"

echo
echo "=== Т3. РАЗОВАЯ ПЕРЕСТАНОВКА В ЗАЛЕ ПРОГРАММУ НЕ МЕНЯЕТ ==="
send "Сегодня тренажёр для жима Арнольда занят, начну с тяги узким хватом" 50
V3=$(active_prog | cut -d'|' -f1)
[ "$V3" = "2" ] && ok "версия осталась 2 — программа не тронута" || bad "программа изменилась от разовой перестановки (версия $V3)"

echo
echo "=== Т4. НАПОМИНАНИЕ О ВЗВЕШИВАНИИ СВЯЗАНО С ЗАМЕРОМ ==="
send "Напомни мне через 30 минут взвеситься" 45
DW=$(PG -At -c "select id || '|' || done_when from reminder where user_id=$U and status='pending' and text ~* 'взвес' order by id desc limit 1" 2>/dev/null)
echo "  напоминание: $DW"
RID=$(echo "$DW" | cut -d'|' -f1)
[ "$(echo "$DW" | cut -d'|' -f2)" = "measurement:weight" ] && ok "связь measurement:weight поставлена" || bad "связь не поставлена"

echo
echo "=== Т5. НАПОМИНАНИЕ ОБ УКОЛЕ НЕ СВЯЗЫВАЕТСЯ НИКОГДА ==="
send "Напомни завтра в 10:00 сделать укол витамина B12" 45
MW=$(PG -At -c "select done_when from reminder where user_id=$U and status='pending' and text ~* 'укол|витамин' order by id desc limit 1" 2>/dev/null)
echo "  связь у укола: [$MW]"
[ "$MW" = "none" ] && ok "укол без связи — придёт всегда" || bad "у укола появилась связь: $MW"

echo
echo "=== Т6. ВТОРОЕ НАПОМИНАНИЕ НА ТО ЖЕ ВРЕМЯ — БОТ ПРЕДУПРЕЖДЁН ==="
send "И ещё напомни завтра в 10:00 выпить стакан воды" 45
WARN=$(PG -At -c "select count(*) from n8n_chat_histories where session_id='users:$U' and message->>'type'='tool' and message->>'content' like '%ВНИМАНИЕ: на это же время%'" 2>/dev/null)
[ "${WARN:-0}" -ge 1 ] && ok "инструмент показал боту соседнее напоминание" || bad "предупреждения о соседе не было"

echo
echo "=== Т7. ВЗВЕСИЛСЯ ЗАРАНЕЕ — НАПОМИНАНИЕ НЕ ПРИХОДИТ (через настоящий тикер) ==="
send "Вес 84.3" 45
MV=$(PG -At -c "select count(*) from measurement where user_id=$U and lower(metric) in ('weight','вес') and measured_on=(now() at time zone 'Europe/Moscow')::date" 2>/dev/null)
[ "${MV:-0}" -ge 1 ] && ok "вес за сегодня записан" || bad "вес не записан"
if [ -n "$RID" ]; then
  PG -q -c "update reminder set fire_at = now() - interval '1 minute' where id = $RID" 2>/dev/null
  echo "  срок напоминания #$RID сдвинут в прошлое, жду тикер (до 7 минут)..."
  ST=""
  for i in $(seq 1 14); do
    ST=$(PG -At -c "select status from reminder where id = $RID" 2>/dev/null)
    [ "$ST" != "pending" ] && break
    sleep 30
  done
  echo "  статус: $ST"
  [ "$ST" = "skipped_done" ] && ok "тикер пропустил напоминание — дело уже сделано" || bad "тикер не пропустил (статус $ST)"
  SENT=$(PG -At -c "select count(*) from n8n_chat_histories where session_id='users:$U' and message->>'content' like '⏰ Напоминание%взвес%'" 2>/dev/null)
  [ "${SENT:-0}" = "0" ] && ok "в диалог напоминание не ушло" || bad "напоминание всё же записано в диалог"
else
  bad "нет id напоминания для проверки тикера"
fi

echo
echo "=== ОШИБКИ ЗА ВРЕМЯ ТЕСТОВ ==="
ERR=$(PG -At -c "select count(*) from ops_error where at > now() - interval '20 minutes'" 2>/dev/null)
[ "${ERR:-0}" = "0" ] && ok "журнал сбоёв пуст" || { bad "в журнале сбоёв $ERR записей"; PG -At -c "select node_name||': '||left(message,160) from ops_error where at > now() - interval '20 minutes' order by at desc limit 5" 2>/dev/null | sed 's/^/    /'; }

echo
echo "=== УБОРКА ТЕСТОВОГО КЛИЕНТА ==="
PG -q 2>/dev/null <<SQL
delete from workout_entry where session_id in (select id from workout_session where user_id=$U);
delete from workout_session where user_id=$U;
delete from food_log where user_id=$U;
delete from measurement where user_id=$U;
delete from reminder where user_id=$U;
delete from training_program where user_id=$U;
delete from usage_event where user_id=$U;
delete from client_profile where user_id=$U;
delete from user_access where user_id=$U;
delete from n8n_chat_histories where session_id like '%:$U';
SQL
echo "  осталось: $(PG -At -c "select (select count(*) from reminder where user_id=$U)+(select count(*) from training_program where user_id=$U)+(select count(*) from client_profile where user_id=$U)+(select count(*) from n8n_chat_histories where session_id like '%:$U')" 2>/dev/null) строк"

echo
echo "ИТОГ: пройдено $PASS, провалено $FAIL"
