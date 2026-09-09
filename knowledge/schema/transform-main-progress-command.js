#!/usr/bin/env node
/*
 * main: команда /progress (сводка прогресса с графиками, «через агента») +
 * ретривал рекордов. Правит:
 *  1) systemMessage (AI Agent): get_progress получает domain=records; добавлен блок
 *     «=== КОМАНДА /progress ===» с выбором графиков по виду спорта клиента.
 *  2) get_progress (toolWorkflow): описание пополнено domain=records.
 *  3) Progress Chart (get_progress_chart): описание + $fromAI metric пополнены
 *     метриками volume / 1rm:<упражнение> / cardio / pace.
 * НЕ добавляет отдельную ветку команды — /progress доходит до агента как обычный
 * текст (Switch out5), агент по systemMessage строит сводку.
 * Идемпотентно (маркер: наличие '/progress' в systemMessage).
 * Запуск: node transform-main-progress-command.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/main-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
const ai = byName['AI Agent']; if (!ai) throw new Error('нет AI Agent');
const gp = byName['get_progress']; if (!gp) throw new Error('нет get_progress');
const pc = byName['Progress Chart']; if (!pc) throw new Error('нет Progress Chart');

let sm = ai.parameters.options.systemMessage;
if (typeof sm !== 'string') throw new Error('systemMessage не строка');

if (sm.includes('=== КОМАНДА /progress')) {
  console.log('уже есть блок /progress — пропускаю правку systemMessage');
} else {
  // 1) get_progress: добавить domain=records в описание использования
  const a1 = 'domain=food (калории и БЖУ). Если база вернула';
  const a1r = 'domain=food (калории и БЖУ), domain=records (личные рекорды — лучшие расчётные 1ПМ по упражнениям). Если база вернула';
  if (!sm.includes(a1)) throw new Error('якорь get_progress не найден в systemMessage');
  sm = sm.replace(a1, a1r);

  // 2) вставить блок /progress после блока ТРЕКИНГ ДАННЫХ
  const anchor = 'Записи трекинга подтверждай коротко, без лишних уточнений.';
  if (!sm.includes(anchor)) throw new Error('якорь ТРЕКИНГ не найден в systemMessage');
  const block = '\n\n=== КОМАНДА /progress (сводка прогресса с графиками) ===\n' +
'Когда сообщение клиента — ровно «/progress» (это кнопка меню «Мой прогресс»), это запрос ПОЛНОЙ сводки прогресса. Действуй так:\n' +
'1) Собери цифры инструментом get_progress по нужным доменам: measurement (вес; при цели снижения веса также waist и body_fat), workout (сессии, объём, кардио), food (калории/БЖУ), records (личные рекорды). Отвечай строго по базе; чего нет — так и скажи, не выдумывай.\n' +
'2) Покажи 2–3 ГРАФИКА через get_progress_chart, выбирая показатели по ВИДУ СПОРТА клиента (см. «виды спорта» в профиле) и его цели:\n' +
'   • силовые / бодибилдинг / пауэрлифтинг: metric=volume (силовой объём по неделям), metric=1rm:<упражнение> (1ПМ ключевого движения, напр. 1rm:присед или 1rm:жим лёжа), metric=weight (вес тела); при цели снижения веса добавь body_fat или waist;\n' +
'   • бег / кардио / выносливость: metric=cardio (км в неделю), metric=pace (темп), metric=weight;\n' +
'   • похудение / общая форма: metric=weight, metric=waist, metric=body_fat.\n' +
'   Не заваливай десятком графиков — выбери 2–3 самых осмысленных под его спорт и цель. Если данных для графика мало, инструмент так и ответит и картинка не появится — это нормально, просто отметь в тексте.\n' +
'3) Дай короткую тёплую сводку текстом: отметь тренды и успехи. НЕ пересказывай цифры, которые уже на графиках. Тон бережный, без давления на вес (протокол РПП действует всегда).\n' +
'Если записей почти нет — честно скажи, что данных пока мало, и предложи, что стоит записывать (тренировки, вес, еду), чтобы прогресс было видно. Отвечай на языке клиента.';
  sm = sm.replace(anchor, anchor + block);

  ai.parameters.options.systemMessage = sm;
  console.log('OK: systemMessage — domain=records + блок /progress');
}

// 3) get_progress описание: domain=records
const gpDesc = gp.parameters.description || '';
if (!gpDesc.includes('domain=records')) {
  gp.parameters.description = gpDesc.replace(
    'domain=food — калории и БЖУ за период (сумма и среднее в день).',
    'domain=food — калории и БЖУ за период (сумма и среднее в день); domain=records — личные рекорды клиента (лучшие расчётные 1ПМ по каждому упражнению).'
  );
  if (gp.parameters.description === gpDesc) throw new Error('якорь описания get_progress не найден');
  console.log('OK: описание get_progress — domain=records');
} else { console.log('get_progress уже с records — пропуск'); }

// 4) Progress Chart описание + $fromAI metric
const newChartDesc = 'Отправляет клиенту КАРТИНКУ-график динамики показателя. Метрики: weight (вес), waist (талия), body_fat (% жира), hip (бёдра); volume (силовой объём по неделям), 1rm:<упражнение> (расчётный 1ПМ конкретного движения, напр. 1rm:жим лёжа), cardio (кардио-дистанция км/нед), pace (темп бега мин/км). Вызывай, когда клиент просит показать прогресс/динамику/график, и в сводке по /progress — по показателям, релевантным его виду спорта. График уходит клиенту картинкой — цифры НЕ пересказывай, кратко подтверди по результату. Возвращает response (отправлено / мало данных).';
pc.parameters.description = newChartDesc;
const newMetricAI = "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('metric', 'показатель для графика: weight (вес), waist (талия), body_fat (% жира), hip (бёдра); volume (силовой объём/нед), 1rm:<упражнение> напр. 1rm:присед (1ПМ упражнения), cardio (км/нед), pace (темп бега)', 'string') }}";
pc.parameters.workflowInputs.value.metric = newMetricAI;
console.log('OK: Progress Chart — описание + metric $fromAI пополнены');

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('DONE');
