---
name: progress-charts-retrieval
description: "Команда /progress (сводка+графики по видам спорта), ретривал рекордов, метрики графиков get_progress_chart"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3499e7e7-2449-4d53-93e0-6f915c17c294
  modified: 2026-08-05T17:00:04.320Z
---

Построено 05.08.2026 (чат 6). Владелец хотел кнопку «Мой прогресс», дающую текст И графики по показателям в зависимости от вида спорта; ретривал рекордов; owner-боту тоже меню. Всё проверено вживую (на изолированном тест-клиенте `users:255171226`, после теста вычищено).

**Ретривал рекордов** — в `QueryTool00001` (инструмент `get_progress`) добавлен **domain=`records`** → `personal_record` (лучший по каждому упражнению: `max(value)`, дедуп, сорт по дате). Обслуживает и свободный текст «покажи мои рекорды», и кнопку. Метрика рекорда `est_1rm` (расч. 1ПМ Epley, пишет `LogWorkoutTool001`/узел «Рекорды»). Домены get_progress: measurement/workout/food/**records**. Исходник `schema/transform-querytool-records.js`.

**Графики по видам спорта** — `ProgressChart01` (инструмент `get_progress_chart`) расширен. Узел «Метрика» строит SQL (query+params+label+unit) по типу метрики, «Данные» переведён на generic `{{ $json.query }}` / `{{ $json.params }}` (HTML/PNG/Gotenberg/sendPhoto не тронуты — читают `points` + label/unit из «Метрика»). Метрики:
- `weight`/`waist`/`body_fat`/`hip` — из `measurement` (как было, вложенный массив вариантов метрик в params);
- `volume` — силовой объём Σ(reps×weight) по неделям (`date_trunc('week')`, `workout_entry` kind=strength);
- `1rm:<упражнение>` — расч. 1ПМ Epley `max(weight*(1+reps/30))` по датам, `lower(activity_name) LIKE lower('%'||ex||'%')`;
- `cardio` — км/нед (`sum(distance_m)/1000` по неделям, kind=cardio);
- `pace` — темп мин/км (`avg(pace_s_per_km)/60` по датам).
Все SQL валидированы в psql. Исходник `schema/transform-progresschart-sports.js`.

**Кнопка /progress — «через агента», БЕЗ отдельной ветки.** `/progress` доходит до агента как обычный текст (Switch out5 → интейк? [stage none] → обычный → агент). В systemMessage блок `=== КОМАНДА /progress ===`: агент собирает get_progress (measurement/workout/food/records) + вызывает get_progress_chart по релевантным `disciplines` метрикам. **Гарантия хотя бы одного графика на КАЖДУЮ основную дисциплину** (мультиспорт: силовые→объём/1ПМ, бег→км/темп, +вес), лимит 3–4. Профиль (вкл. `disciplines` с целями) агент видит через `Build Profile Context` («виды спорта: …»). Prompt агента = `message.text` → голый «/progress» доходит. Исходники `schema/transform-main-progress-command.js`, `-progress-per-discipline.js`.

**Меню Telegram** (`setMyCommands`): **@GymAK_AI_Bot (owner) = `research`+`progress`** (раньше меню не было); @TRD_Gymbot и @USER_GYMBOT = `about/research/progress/language/quiet/support`. Имена команд НЕ локализуются, описания — русские. Команды и их обработчики: `/about//support//quiet` — статика до языкового гейта (`Пущен?`→about?→support?→quiet?→Язык:чек); `/research` — Switch out0; `/progress` — обычный текст (систем-промпт).

Грабли/решения: домен records дедуп `max(value)` per exercise; graphics param-binding для measurement идентичен прежнему (regression-free); Markdown-таблицы Telegram не рендерит (сырые `|`) — владелец оставил как есть; изменения ProgressChart/QueryTool (подчинённые) требуют рестарт n8n (см. [[n8n-deploy-gotchas]] грабля 8). Связано: [[proactive-retention]] (недельная сводка — те же данные), [[memory-data-schema]], [[n8n-bot-workflow]].
