#!/usr/bin/env node
/*
 * Main workflow: инструмент коррекции записей + нить диалога.
 * 1. Новый tool-узел correct_log (toolWorkflow → CorrectLogTool01, клон меты get_progress).
 * 2. systemMessage: блок КОРРЕКЦИЯ ЗАПИСЕЙ (не доел половину → update_food; заменил упражнение →
 *    update_workout; сначала list → id → правка → подтверждение; удаление — только явное).
 * 3. Load Profile: + dialog_thread из dialog_summary; Build Profile Context: блок НИТЬ ДИАЛОГА.
 * 4. Упоминание нити в перечне памяти systemMessage.
 * Идемпотентно (маркер: узел correct_log). Запуск: node transform-main-correct-dialog.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/deploy/main-work2.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);

if (byName['correct_log']) { console.log('уже применено — пропуск'); process.exit(0); }
const gp = byName['get_progress']; if (!gp) throw new Error('нет get_progress (образец)');

// 1. Узел correct_log
const node = {
  parameters: {
    name: 'correct_log',
    description: 'Исправляет или удаляет ОШИБОЧНЫЕ записи журналов клиента (еда, тренировки, замеры). Порядок ВСЕГДА: (1) action=list_food|list_workout|list_measurement с date=ГГГГ-ММ-ДД — получить записи дня с id; (2) action=update_food|update_workout|update_measurement с id и fields (JSON-строка только изменяемых полей: еда — description/kcal/protein_g/fat_g/carb_g/meal_type/eaten_on; строка тренировки — activity_name/reps/weight_kg/distance_m/duration_s/set_no; замер — metric/value/unit/measured_on) ИЛИ action=delete_food|delete_workout|delete_measurement|delete_workout_session с id. Используй, когда клиент поправляет уже записанное: «не доел половину» (пересчитай и обнови вес/ккал записи), «делал не жим штанги, а тренажёр» (обнови activity_name), «вес был 89, не 90», явный дубль. Удаление — только по явному подтверждению клиента.',
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: 'CorrectLogTool01', cachedResultName: 'Инструмент — Коррекция записей' },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        bot_id: "={{ $('Load Config').first().json.bot_id }}",
        user_id: "={{ $('Normalize').first().json.message.from.id }}",
        action: "={{ $fromAI('action', 'list_food | list_workout | list_measurement | update_food | update_workout | update_measurement | delete_food | delete_workout | delete_measurement | delete_workout_session', 'string') }}",
        date: "={{ $fromAI('date', 'дата дня ГГГГ-ММ-ДД (для list_*)', 'string') }}",
        id: "={{ $fromAI('id', 'id записи из list_* (для update_*/delete_*)', 'number') }}",
        fields: "={{ $fromAI('fields', 'JSON-строка с новыми значениями полей (для update_*)', 'string') }}"
      },
      matchingColumns: [],
      schema: [
        { id: 'bot_id', displayName: 'bot_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'action', displayName: 'action', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'date', displayName: 'date', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'id', displayName: 'id', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'number' },
        { id: 'fields', displayName: 'fields', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' }
      ],
      attemptToConvertTypes: false,
      convertFieldsToString: false
    }
  },
  id: 'c2000000-0000-4000-8000-000000000001',
  name: 'correct_log',
  type: gp.type,
  typeVersion: gp.typeVersion,
  position: [gp.position[0] + 200, gp.position[1] + 60]
};
wf.nodes.push(node);
wf.connections['correct_log'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };

// 2. systemMessage
const agent = wf.nodes.find(n => (n.type || '').toLowerCase().includes('agent'));
let sm = agent.parameters.options.systemMessage;
const corrAnchor = 'предложи клиенту обновить план недели (save_profile, ключ plan_week).';
if (!sm.includes(corrAnchor)) throw new Error('якорь для блока коррекции не найден');
if (!sm.includes('КОРРЕКЦИЯ ЗАПИСЕЙ')) {
  sm = sm.replace(corrAnchor, corrAnchor +
    '\n— КОРРЕКЦИЯ ЗАПИСЕЙ (инструмент correct_log). Люди ошибаются и уточняют — это НОРМАЛЬНО: «сказал, что съем всю упаковку, но не доел половину» → пересчитай порцию и ОБНОВИ существующую запись (update_food), не создавай новую; «лавка занята, делал жим в тренажёре, а не штангой» → обнови activity_name строк тренировки (update_workout); «вес был 89.2, а не 90» → update_measurement. Порядок: сначала list_* за нужный день → найди id записи → примени update_*/delete_* → подтверди клиенту, что исправлено. Явный дубль (одно блюдо записано дважды) — удали лишнюю запись, сказав клиенту, что именно удаляешь. НИКОГДА не удаляй записи массово или «на всякий случай»; удаление всей тренировки (delete_workout_session) — только по явной просьбе клиента.');
}
const memAnchor = '(3) переписка.';
if (sm.includes(memAnchor) && !sm.includes('НИТЬ ДИАЛОГА')) {
  sm = sm.replace(memAnchor, '(3) переписка; (4) НИТЬ ДИАЛОГА — сводка того, что обсуждали и о чём договорились в последние дни (в блоке профиля, обновляется автоматически).');
}
agent.parameters.options.systemMessage = sm;

// 3. Load Profile + Build Profile Context
const lp = byName['Load Profile']; if (!lp) throw new Error('нет Load Profile');
if (!lp.parameters.query.includes('dialog_summary')) {
  if (!lp.parameters.query.includes('AS summary;')) throw new Error('якорь Load Profile не найден');
  lp.parameters.query = lp.parameters.query.replace('AS summary;',
    'AS summary, (SELECT ds.summary_text FROM dialog_summary ds WHERE ds.bot_id=$1 AND ds.user_id=$2) AS dialog_thread;');
}
const bpc = byName['Build Profile Context']; if (!bpc) throw new Error('нет Build Profile Context');
let code = bpc.parameters.jsCode;
if (!code.includes('dialogThread')) {
  const a1 = "const summary = (row.summary == null) ? '' : String(row.summary);";
  if (!code.includes(a1)) throw new Error('якорь BPC summary-const не найден');
  code = code.replace(a1, a1 + "\nconst dialogThread = (row.dialog_thread == null) ? '' : String(row.dialog_thread);");
  const a2 = "if (summary && summary.trim()) block = 'ВЫЖИМКА О КЛИЕНТЕ (долговременная память — опирайся на неё, это сжатая история общения):\\n' + summary.trim() + '\\n\\n' + block;";
  if (!code.includes(a2)) throw new Error('якорь BPC выжимка-push не найден');
  code = code.replace(a2, a2 + "\nif (dialogThread && dialogThread.trim()) block = 'НИТЬ ДИАЛОГА ПОСЛЕДНИХ ДНЕЙ (что обсуждали и о чём договорились — помни это, даже если сообщений нет в окне; журналы еды/тренировок смотри через get_progress):\\n' + dialogThread.trim() + '\\n\\n' + block;");
  bpc.parameters.jsCode = code;
}

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: main — correct_log зарегистрирован, КОРРЕКЦИЯ в systemMessage, нить диалога в Load Profile/BPC');
