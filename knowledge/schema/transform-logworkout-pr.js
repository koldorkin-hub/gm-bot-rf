#!/usr/bin/env node
/*
 * ВОЛНА-2 памяти: детекция личных рекордов (PR) при записи тренировки.
 * Врезает узел "Рекорды" после "Записать строки": считает расчётный 1ПМ (Epley:
 * weight*(1+reps/30)) по силовым упражнениям ЭТОЙ сессии, сравнивает с ПРЕДЫДУЩИМ
 * максимумом клиента по упражнению; если побит — пишет в personal_record и отдаёт
 * готовую фразу-поздравление (pr_text). "Ответ агенту" её дописывает.
 * Первый раз упражнение (нет истории) рекордом НЕ считается (нечего бить).
 * Идемпотентно (маркер узла 'Рекорды'). Запуск: node transform-logworkout-pr.js <path>
 */
const fs = require('fs');
const p = process.argv[2] || '/tmp/lw-work.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const wf = Array.isArray(raw) ? raw[0] : raw;
const byName = {}; wf.nodes.forEach(n => byName[n.name] = n);
if (byName['Рекорды']) { console.log('уже есть — пропускаю'); fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2)); process.exit(0); }
if (!byName['Записать строки']) throw new Error('нет Записать строки');
if (!byName['Ответ агенту']) throw new Error('нет Ответ агенту');

const prQuery =
"WITH this_session AS (" +
" SELECT e.activity_name, max(e.weight_kg*(1+e.reps/30.0)) AS sess_1rm" +
" FROM workout_entry e WHERE e.session_id=$4 AND e.kind='strength' AND e.weight_kg IS NOT NULL AND e.reps IS NOT NULL AND e.reps>0 AND e.activity_name IS NOT NULL AND e.weight_kg>0" +
" GROUP BY e.activity_name)," +
"prev_best AS (" +
" SELECT e.activity_name, max(e.weight_kg*(1+e.reps/30.0)) AS prev_1rm" +
" FROM workout_entry e JOIN workout_session s ON e.session_id=s.id" +
" WHERE s.bot_id=$1 AND s.user_id=$2 AND s.id<>$4 AND e.kind='strength' AND e.weight_kg IS NOT NULL AND e.reps>0" +
" GROUP BY e.activity_name)," +
"new_prs AS (" +
" SELECT t.activity_name, round(t.sess_1rm::numeric,1) AS one_rm" +
" FROM this_session t JOIN prev_best p ON p.activity_name=t.activity_name" +
" WHERE t.sess_1rm > p.prev_1rm + 0.01)," +
"ins AS (" +
" INSERT INTO personal_record (bot_id,user_id,exercise,metric,value,unit,achieved_on)" +
" SELECT $1,$2,activity_name,'est_1rm',one_rm,'кг',$3::date FROM new_prs" +
" RETURNING exercise, value)" +
"SELECT CASE WHEN count(*)=0 THEN '' ELSE ' 🎉 НОВЫЙ ЛИЧНЫЙ РЕКОРД (расчётный 1ПМ): ' || string_agg(exercise||' ~'||value||' кг', ', ') || '. Обязательно тепло поздравь клиента с этим!' END AS pr_text FROM ins;";

const n = JSON.parse(JSON.stringify(byName['Записать строки']));
n.name = 'Рекорды'; n.id = 'pr-node-0001';
n.position = [ (byName['Записать строки'].position ? byName['Записать строки'].position[0] : 0) + 200, (byName['Записать строки'].position ? byName['Записать строки'].position[1] : 0) ];
n.onError = 'continueRegularOutput';
n.parameters = { operation: 'executeQuery', query: prQuery, options: { queryReplacement: "={{ [ $('Подготовить').first().json.bot_id, $('Подготовить').first().json.user_id, $('Подготовить').first().json.performed_on, $('Сессия').first().json.id ] }}" } };
wf.nodes.push(n);

// rewire: Записать строки[0] был → Ответ агенту ; станет → Рекорды → Ответ агенту
const C = wf.connections;
C['Записать строки'].main[0] = [ { node: 'Рекорды', type: 'main', index: 0 } ];
C['Рекорды'] = { main: [ [ { node: 'Ответ агенту', type: 'main', index: 0 } ] ] };

// Ответ агенту: дописать pr_text
const asg = byName['Ответ агенту'].parameters.assignments.assignments[0];
asg.value = "={{ 'Записал тренировку от ' + $('Подготовить').first().json.performed_on + ': упражнений ' + $('Строки').first().json.n_exercises + ', строк-подходов ' + $('Строки').first().json.n_rows + '.' + ($('Рекорды').first().json.pr_text || '') }}";

fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? [wf] : wf, null, 2));
console.log('OK: узел Рекорды добавлен (детекция PR по 1ПМ), Ответ агенту дописывает поздравление');
