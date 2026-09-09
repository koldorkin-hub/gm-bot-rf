const rows = $input.all().map(x => x.json).filter(j => j && Object.keys(j).length && j['1'] === undefined && j['?column?'] === undefined);
const p = $('Параметры').first().json;
if (p.error === 'need_date') return [{ json: { response: 'Нужна дата (date=ГГГГ-ММ-ДД) — за какой день показать записи. Вычисли её из «СЕЙЧАС У КЛИЕНТА».' } }];
if (p.error === 'need_id') return [{ json: { response: 'Нужен id записи. Сначала вызови list_food/list_workout/list_measurement за нужную дату, найди id, потом правь/удаляй по нему.' } }];
if (p.error === 'no_fields') return [{ json: { response: 'Не передано ни одного корректного поля для правки (fields — JSON). Для еды: description, kcal, protein_g, fat_g, carb_g, meal_type, eaten_on. Для тренировки: activity_name, reps, weight_kg, distance_m, duration_s, set_no. Для замера: metric, value, unit, measured_on, note.' } }];
if (p.error === 'bad_action') return [{ json: { response: 'Неизвестное действие. Доступно: list_food/list_workout/list_measurement (нужна date), update_food/update_workout/update_measurement (нужны id и fields), delete_food/delete_workout/delete_workout_session/delete_measurement (нужен id).' } }];
if (p.action === 'list_food') {
  if (!rows.length) return [{ json: { response: 'За ' + p.date + ' записей о еде нет.' } }];
  const l = rows.map(r => '#' + r.id + ' ' + (r.meal_type || '') + ' — ' + (r.description || '?') + ' (' + (r.kcal || 0) + ' ккал, Б' + (r.p || 0) + ' Ж' + (r.f || 0) + ' У' + (r.c || 0) + ')').join('\n');
  return [{ json: { response: 'Еда за ' + p.date + ' (id — для правки/удаления):\n' + l + '\nПравь через update_food (id + fields), удаляй delete_food (id). Перед удалением скажи клиенту, что именно удаляешь.' } }];
}
if (p.action === 'list_workout') {
  if (!rows.length || rows.every(r => r.entry_id == null)) return [{ json: { response: 'За ' + p.date + ' тренировок в журнале нет.' } }];
  const sess = rows[0].session_id;
  const l = rows.filter(r => r.entry_id != null).map(r => '#' + r.entry_id + ' ' + (r.activity_name || r.kind) + (r.kind === 'strength' ? ' ' + (r.reps || 0) + ' повт × ' + (r.weight_kg || 0) + ' кг' + (r.set_no ? ' (подход ' + r.set_no + ')' : '') : (r.distance_m ? ' ' + Math.round(r.distance_m) + ' м' : '') + (r.duration_s ? ' ' + Math.round(r.duration_s / 60) + ' мин' : ''))).join('\n');
  return [{ json: { response: 'Тренировка за ' + p.date + ' (session_id ' + sess + '; id строк — для правки/удаления):\n' + l + '\nПравь update_workout (id строки + fields), удаляй строку delete_workout (id), всю сессию целиком — delete_workout_session (session_id, ТОЛЬКО по явной просьбе клиента).' } }];
}
if (p.action === 'list_measurement') {
  if (!rows.length) return [{ json: { response: 'За ' + p.date + ' замеров нет.' } }];
  const l = rows.map(r => '#' + r.id + ' ' + r.metric + ' = ' + r.value + (r.unit ? ' ' + r.unit : '')).join('\n');
  return [{ json: { response: 'Замеры за ' + p.date + ':\n' + l + '\nПравь update_measurement (id + fields), удаляй delete_measurement (id).' } }];
}
const verb = p.action.startsWith('delete') ? 'УДАЛЕНО' : 'ИСПРАВЛЕНО';
if (!rows.length) return [{ json: { response: 'Запись #' + p.id + ' не найдена у этого клиента — ничего не изменено. Проверь id через list_* за нужную дату.' } }];
const r = rows[0];
return [{ json: { response: verb + ': ' + JSON.stringify(r) + '. Подтверди клиенту результат одной фразой. НЕ создавай новую запись вместо исправленной.' } }];
