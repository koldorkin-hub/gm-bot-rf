#!/usr/bin/env bash
# Проверка состава РФ-сервера ФАКТАМИ, а не кодами возврата.
#
#   ./check.sh              — все проверки
#   ./check.sh --llm-only   — только эндпоинт модели (после смены площадки или модели)
#
# Каждая проверка смотрит на результат: строки в базе, распознанный текст, вернувшийся
# вызов инструмента. «Контейнер запустился» ничего не значит.
set -uo pipefail

LLM_URL="${LLM_URL:-http://127.0.0.1:8000/v1}"
LLM_KEY="${LLM_KEY:-none}"
LLM_MODEL="${LLM_MODEL:-}"
ONLY_LLM=0
[[ "${1:-}" == "--llm-only" ]] && ONLY_LLM=1

pass=0; fail=0
ok()   { echo "  ✔ $1"; pass=$((pass+1)); }
bad()  { echo "  ✘ $1"; fail=$((fail+1)); }
head() { echo; echo "$1"; }

http() { curl -s -m "${3:-20}" -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

if [[ $ONLY_LLM == 0 ]]; then

head "1. Postgres: схема на месте и роли разделены"
Q() { docker compose exec -T postgres psql -qtAX -U "${PG_USER:-gm_app}" -d "${PG_DB:-gm_memory}" -c "$1" 2>/dev/null; }
tables=$(Q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
sens=$(Q "SELECT count(*) FROM information_schema.tables WHERE table_schema='sens'")
foods=$(Q "SELECT count(*) FROM food_reference")
[[ "${tables:-0}" -ge 30 ]] && ok "таблиц в public: $tables" || bad "таблиц в public: ${tables:-нет ответа} (ждали ≥30) — прогнать schema/02-apply-core.sh"
[[ "${sens:-0}" -ge 7 ]]    && ok "таблиц в контуре здоровья sens: $sens" || bad "контур здоровья не создан — прогнать schema/04-sensitive-contour.sql"
[[ "${foods:-0}" -ge 150 ]] && ok "справочник БЖУ: $foods продуктов" || bad "справочник БЖУ пуст (${foods:-нет ответа})"
# Ветка отказа: белый список показателей обязан ОТКАЗЫВАТЬ, а не пропускать.
guard=$(Q "INSERT INTO measurement (bot_id,user_id,measured_on,metric,value,unit,source) VALUES ('__check__',1,CURRENT_DATE,'glucose',6.8,'ммоль/л','test') RETURNING 1" 2>&1)
if [[ -z "$guard" ]]; then ok "чувствительный показатель в открытый контур не пускается"
else bad "ограждение белого списка НЕ работает: глюкоза записалась в открытый контур"; Q "DELETE FROM measurement WHERE bot_id='__check__'" >/dev/null; fi

head "2. n8n"
code=$(http "http://127.0.0.1:5678/healthz")
[[ "$code" == "200" ]] && ok "healthz отвечает 200" || bad "healthz вернул $code"
tz=$(docker compose exec -T n8n printenv GENERIC_TIMEZONE 2>/dev/null | tr -d '\r')
[[ "$tz" == "Europe/Moscow" ]] && ok "часовой пояс расписаний: $tz" || bad "GENERIC_TIMEZONE=$tz — расписания уедут"
cr=$(docker compose exec -T n8n printenv NODE_FUNCTION_ALLOW_BUILTIN 2>/dev/null | tr -d '\r')
[[ "$cr" == *crypto* ]] && ok "модуль шифрования доступен Code-узлам" || bad "NODE_FUNCTION_ALLOW_BUILTIN=$cr — шифрование полей не заработает"
ex=$(docker compose exec -T n8n printenv EXECUTIONS_DATA_SAVE_ON_SUCCESS 2>/dev/null | tr -d '\r')
[[ "$ex" == "none" ]] && ok "успешные исполнения не сохраняют данные узлов" || bad "EXECUTIONS_DATA_SAVE_ON_SUCCESS=$ex — в базе осядут фото и анализы"

head "3. Распознавание речи"
say="$(mktemp -u).wav"
if command -v ffmpeg >/dev/null; then
  # Тишина не даёт текста, поэтому проверяем только приём файла и формат ответа.
  ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 -c:a pcm_f32le "$say" -y >/dev/null 2>&1
  resp=$(curl -s -m 60 -F "file=@$say" -F "model=${ASR_MODEL:-gigaam-v3-e2e-rnnt}" \
              http://127.0.0.1:8081/v1/audio/transcriptions 2>/dev/null)
  rm -f "$say"
  echo "$resp" | grep -q '"text"' && ok "эндпоинт принимает файл и отвечает полем text" \
    || bad "ответ без поля text: $(echo "$resp" | head -c 120)"
else
  bad "нет ffmpeg — проверить распознавание нечем (нужен и для конвертации OGG из Telegram)"
fi
echo "  · настоящую проверку качества делать живым голосовым: тишина текста не даёт"

head "4. Чтение документов (главное — кириллица)"
pdf="$(mktemp -u).pdf"
if command -v gs >/dev/null || command -v libreoffice >/dev/null; then :; fi
# PDF с русским текстом собираем Gotenberg-ом из HTML — заодно проверяем и его.
html='<html><meta charset="utf-8"><body><h1>Анализ крови</h1><p>Ферритин 15 нг/мл, ТТГ 5.8</p></body></html>'
echo "$html" > /tmp/check.html
curl -s -m 60 -F "files=@/tmp/check.html" http://127.0.0.1:8083/forms/chromium/convert/html -o "$pdf" 2>/dev/null
if [[ -s "$pdf" ]]; then
  ok "Gotenberg собрал PDF из HTML"
  out=$(curl -s -m 120 -F "files=@$pdf" http://127.0.0.1:8082/v1/convert/file 2>/dev/null)
  if echo "$out" | grep -q "Ферритин"; then ok "Docling вернул русский текст"
  else bad "Docling не вернул кириллицу — включить OCR rus (issue #3433): $(echo "$out" | head -c 160)"; fi
else
  bad "Gotenberg не отдал PDF — проверить сервис"
fi
rm -f "$pdf" /tmp/check.html

head "5. Чтение веб-страниц"
code=$(http "http://127.0.0.1:8084/health")
[[ "$code" == "200" ]] && ok "Crawl4AI отвечает" || bad "Crawl4AI вернул $code"

fi

head "6. Эндпоинт модели: вызов инструмента"
models=$(curl -s -m 20 -H "Authorization: Bearer $LLM_KEY" "$LLM_URL/models" 2>/dev/null)
if echo "$models" | grep -q '"id"'; then
  ok "модели отдаются: $(echo "$models" | grep -o '"id":"[^"]*"' | head -3 | cut -d'"' -f4 | tr '\n' ' ')"
  [[ -z "$LLM_MODEL" ]] && LLM_MODEL=$(echo "$models" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  # Главная проверка для открытой модели: возвращается ли СТРУКТУРНЫЙ вызов инструмента,
  # а не текст с описанием вызова. Именно здесь чаще всего ломаются парсеры tool calling.
  body=$(cat <<JSON
{"model":"$LLM_MODEL","max_tokens":256,"stream":false,
 "messages":[{"role":"system","content":"Ты фитнес-бот. Для записи еды всегда вызывай инструмент log_food."},
             {"role":"user","content":"Запиши: гречка 150 грамм, 165 ккал"}],
 "tools":[{"type":"function","function":{"name":"log_food","description":"Записывает приём пищи",
   "parameters":{"type":"object","properties":{"description":{"type":"string"},"kcal":{"type":"number"}},
   "required":["description"]}}}]}
JSON
)
  resp=$(curl -s -m 120 -H "Content-Type: application/json" -H "Authorization: Bearer $LLM_KEY" \
              -d "$body" "$LLM_URL/chat/completions" 2>/dev/null)
  if echo "$resp" | grep -q '"tool_calls"'; then
    ok "модель вернула структурный вызов log_food"
    echo "$resp" | grep -q '"kcal"' && ok "числовой аргумент передан" \
      || bad "в аргументах нет kcal — проверить схемы и валидацию"
  else
    bad "вызова инструмента нет. Ответ моделью текстом: $(echo "$resp" | head -c 200)"
  fi
else
  bad "$LLM_URL/models не отвечает моделями: $(echo "$models" | head -c 160)"
fi

echo
echo "Итог: пройдено $pass, провалено $fail"
[[ $fail -eq 0 ]] || echo "Пока есть провалы — бота не включать."
exit $(( fail > 0 ))
