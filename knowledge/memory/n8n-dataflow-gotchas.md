---
name: n8n-dataflow-gotchas
description: Грабли потока данных в n8n — что реально приходит в $input, потеря бинарника, запрет require в Code, Gotenberg
metadata: 
  node_type: memory
  type: reference
  originSessionId: 52640038-09b4-432e-9afb-c8158670a305
  modified: 2026-08-02T10:31:29.323Z
---

Собрано 20-21.07.2026 на подчинённых workflow ([[n8n-websearch-tool]], [[n8n-research-mode]]).

**1. Узел между триггером и Code читает НЕ то, что кажется.** В подчинённом workflow цепочка была `Триггер → Postgres(параметры) → Инициализация`, и `Инициализация` брала входы вызова из `$input` — то есть из строки конфига, где их нет. `query` работал только потому, что имел фолбэк на триггер, и это маскировало баг: `bot_id`/`session_id` месяцами уходили пустыми, запись источников молча падала на FK (`onError: continueRegularOutput` глушил), а флаг режима не доезжал. Правило: входы вызова читать явно из `$('When Executed by Another Workflow')`, из `$input` — только то, что отдал непосредственно предыдущий узел.

**2. Межузловые ссылки только `.first()`, не `.item`.** В голосовой ветке пары item рвутся на скачивании бинарника и Code-узле.

**3. HTTP-узел теряет бинарник, полученный с предыдущего шага.** Цепочка «результат с PDF → sendMessage → sendDocument» падает на `binary file 'pdf' not found`: узел sendMessage отдаёт ответ Telegram и заменяет им item вместе с бинарником. Лечится Code-узлом между ними, который возвращает `{ json, binary }`, взяв бинарник у узла-источника (тот выполняется один раз, ссылка однозначна).

**4. Песочница Code-узла запрещает ЛЮБОЙ `require`** — и внешние модули, и встроенные (`zlib` тоже). Разбирать PDF внутри Code нельзя; для извлечения текста есть штатный узел `Extract from File` (операция `pdf`) с `keepSource: 'both'` — он сохраняет и json, и бинарник. **Бинарники хранятся в filesystem-режиме: `binary.<k>.data` — это СТАБ (строка вида `filesystem-v…`, ~13 символов), а НЕ base64.** Признак промаха: взял `bd.data`, а там короткая строка «filesystem-v…» → в API/Anthropic уходит мусор. Реальные байты — только `await this.helpers.getBinaryDataBuffer(itemIndex, 'data')` (по `binary.<k>.id`); в Code с `$input.all()` itemIndex = i. Фолбэк на `Buffer.from(bd.data,'base64')` — только для memory-режима. Картинки в AI Agent можно передавать объектом `bd` как есть — узел резолвит по `bd.id` сам. Внешние HTTP-вызовы из Code можно: `this.helpers.httpRequest` / `httpRequestWithAuthentication` (проверено на пачках документов 02.08.2026).

**5. Gotenberg требует, чтобы файл назывался ровно `index.html`.** Иначе `Invalid form data: form file 'index.html' is required`. Имя задаётся в `fileName` бинарного поля, а не в имени параметра формы.

**6. Postgres-узел (executeQuery) ЗАМЕНЯЕТ item результатом SELECT — исходные поля (`message` и т.п.) исчезают.** Если после такого узла несколько веток сходятся в общий узел (напр. AI Agent), КАЖДАЯ ветка обязана восстановить нужные поля сама. Реальный баг (01.08.2026): интейк-узел `Research: интейк?` (SELECT `stage/topic`) срезал `message`; текстовая ветка восстанавливала `message.text` узлом `Текст: разбор` из `Normalize`, а голосовая шла в AI Agent напрямую → промпт пустой → langchain-агент падает с **«No prompt specified»** (в n8n это уходит в error-ветку узла Agent, `executionStatus` самого узла при этом `success`, `error:null` — смотреть надо `data.main[1]`, а не `.error`). Лечится симметричным узлом-восстановителем на каждой ветке (`Голос: разбор` — `message` из `Normalize` + текст из расшифровки `Edit Fields`). Урок деплоя: перепроводка роутинга ломает ветки по-разному; синтетический ТЕКСТ-прогон голосовой регресс не ловит — тестировать каждую входную модальность (текст И голос). См. [[n8n-research-intake]].

Смежные грабли: [[n8n-alerting-gotchas]], [[n8n-deploy-gotchas]], [[n8n-postgres-gotchas]].
