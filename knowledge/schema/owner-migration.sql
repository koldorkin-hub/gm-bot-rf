-- ============================================================================
-- МИГРАЦИЯ ВЛАДЕЛЬЦА (gymak:255171226) — перенос личных данных из промпта в таблицы.
-- Источник: текущий clients.system_prompt (авторитетные данные владельца).
-- Инвентаризация 31.07.2026: реальных данных нет, кроме 26 чат-сообщений и
-- частичного тест-профиля. Сносить нечего ценного (research_report пуст).
-- Атомарно. Применять от postgres:  psql -d n8n_memory -v ON_ERROR_STOP=1 -f owner-migration.sql
-- ЗАМЕЧАНИЕ: Load Profile инжектит у condition только name → запрет держим в name.
-- ============================================================================
BEGIN;

-- ── 0. Чистка: чат (тест) + перезапись профиля/здоровья начисто ──
DELETE FROM n8n_chat_histories WHERE session_id = 'gymak:255171226';
DELETE FROM exclusion       WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM condition       WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM injury          WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM medication      WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM allergen        WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM food_preference WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM measurement     WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM client_summary  WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM extraction_state WHERE bot_id='gymak' AND user_id=255171226;
DELETE FROM client_profile  WHERE bot_id='gymak' AND user_id=255171226;

-- ── 1. Профиль (чистые данные из промпта; тест-мусор перезатёрт) ──
INSERT INTO client_profile (
  bot_id, user_id, display_name, birth_date, sex, height_cm, timezone, units,
  main_goal, goal_targets, disciplines, experience_level, equipment,
  days_per_week, session_minutes, diet_type, current_weight_kg, current_weight_on,
  onboarding_done, onboarding_safety_done, updated_at
) VALUES (
  'gymak', 255171226, 'Андрей', DATE '1984-08-14', 'male', 180, 'Europe/Moscow', 'metric',
  'Снижение веса до 100 кг и видимый пресс (жиросжигание, рельеф)',
  '{"target_weight_kg":100,"visible_abs":true}'::jsonb,
  '[{"discipline":"фитнес/силовые тренировки","goal":"жиросжигание и рельеф","priority":1},{"discipline":"эндуро мотоцикл","goal":"кардио/актив","priority":2},{"discipline":"страйкбол","goal":"актив, ~1 раз в месяц","priority":3}]'::jsonb,
  'опытный (~20 лет стажа, хорошая мышечная база)',
  '["полностью оснащённый зал","хаммеры","свободные веса","блочные тренажёры","тренажёры для ног"]'::jsonb,
  2, 90, 'смешанное (мясо, крупы, яйца, творог); калории не считает, готов начать',
  106, current_date,
  true, true, now()
);

-- ── 2. Баз. измерение веса (истории не было — ставим точку отсчёта) ──
INSERT INTO measurement (bot_id, user_id, measured_on, metric, value, unit, source, note)
VALUES ('gymak', 255171226, current_date, 'weight', 106, 'kg', 'client', 'перенос из профиля при миграции');

-- ── 3. Состояние: сердце (пульсовой лимит держим в name — инжектится) ──
INSERT INTO condition (bot_id, user_id, name, since, active, confirmed, note)
VALUES ('gymak', 255171226,
  'Сердце: РЧА (радиочастотная абляция), май 2025. Ограничение: пульс не выше 150 уд/мин на пике нагрузки.',
  DATE '2025-05-01', true, true,
  'Контролировать интенсивность кардио/эндуро по пульсу, пик ≤150.');

-- ── 4. Состояние: эндопротез ТБС + связанные исключения (перечень запрета в name) ──
WITH endo AS (
  INSERT INTO condition (bot_id, user_id, name, since, active, confirmed, note)
  VALUES ('gymak', 255171226,
    'Правый тазобедренный сустав: тотальное эндопротезирование (боковой доступ), ~2024. ЗАПРЕЩЕНЫ: сведения ног в тренажёре, глубокое приседание с осевой нагрузкой, приведение бедра, скрестный шаг, ротации бедра.',
    DATE '2024-01-01', true, true,
    'Постоянное ограничение. Ноги планировать только из разрешённых паттернов; перед планом — check_activities.')
  RETURNING id
)
INSERT INTO exclusion (bot_id, user_id, scope, value, source_type, source_ref, confirmed, active, note)
SELECT 'gymak', 255171226, v.scope, v.value, 'condition', endo.id, true, true, 'эндопротез правого ТБС'
FROM endo, (VALUES
  ('activity','сведение ног в тренажёре'),
  ('activity','приведение бедра'),
  ('activity','глубокое приседание с осевой нагрузкой'),
  ('activity','скрестный шаг'),
  ('activity','ротация бедра'),
  ('load_tag','rotational')
) AS v(scope, value);

-- Пульсовой лимит — тоже в список исключений (scope=other, информативно, инжектится) --
INSERT INTO exclusion (bot_id, user_id, scope, value, source_type, confirmed, active, note)
VALUES ('gymak', 255171226, 'other', 'Пульс на пике не выше 150 уд/мин (после РЧА)', 'condition', true, true, 'кардиолимит');

-- ── 5. Препараты. Текущий протокол — active; арсенал — active=false ──
INSERT INTO medication (bot_id, user_id, name, dose, schedule, reason, active, confirmed, note) VALUES
 ('gymak',255171226,'Тестостерон — Сустанон 250','250 мг/нед','еженедельно; планирует переход на 2 инъекции/нед','ТЗТ / курс', true, true, NULL),
 ('gymak',255171226,'Анастрозол (ингибитор ароматазы)','1 таб/нед','еженедельно; планирует переход на Летрозол','контроль эстрадиола', true, true, NULL),
 ('gymak',255171226,'Туринабол',NULL,NULL,'в арсенале', false, true, 'в арсенале, не в текущем курсе'),
 ('gymak',255171226,'Станозолол',NULL,NULL,'в арсенале', false, true, 'в арсенале, не в текущем курсе'),
 ('gymak',255171226,'Мастерон',NULL,NULL,'в арсенале', false, true, 'в арсенале, не в текущем курсе');

-- ── 6. Выжимка (client_summary) — мягкий контекст, инжектится каждое сообщение ──
INSERT INTO client_summary (bot_id, user_id, summary_text, covers_through, updated_at)
VALUES ('gymak', 255171226,
  'Владелец системы (режим владельца — доступны все функции, включая фармакологические протоколы). Опытный атлет, ~20 лет стажа, хорошая мышечная база. Тренируется в зале 2 раза/нед FullBody по ~1.5 ч (зал полностью оснащён), плюс эндуро-мотокросс (высокая кардионагрузка) и страйкбол ~1 раз/мес. Целевые группы: ягодицы, квадрицепсы, бицепс бедра, грудь, плечи, руки, верх и середина спины. Цель: снижение веса до 100 кг и видимый пресс. Образ жизни: сидячая работа, высокий стресс, сон 7–8 ч. Питание: утро — яйца+овощи+хлеб; день — мясо + гарнир (картофель/макароны/гречка); вечер — творог, бутерброды с мясом; калории раньше не считал, готов начать; алкоголь 1–2 раза/нед (~3 банки пива), готов сократить. Добавки: мультивитамины, Омега-3, CoQ10, витамин D, L-цитруллин и L-карнитин перед тренировкой. Фарм-арсенал (не обязательно в текущем курсе): Туринабол, Станозолол, Мастерон. Интерес к тирзепатиду и ретатрутиду. Мед-ограничения — сердце (РЧА, пульс ≤150) и эндопротез правого ТБС (перечень запрещённых движений в карте здоровья).',
  now(), now());

COMMIT;

-- Контроль
SELECT 'profile' k, display_name||' / '||main_goal||' / '||current_weight_kg||'кг' v FROM client_profile WHERE bot_id='gymak' AND user_id=255171226
UNION ALL SELECT 'conditions', string_agg(left(name,40),' | ') FROM condition WHERE bot_id='gymak' AND user_id=255171226
UNION ALL SELECT 'exclusions', string_agg(scope||':'||value,' | ') FROM exclusion WHERE bot_id='gymak' AND user_id=255171226
UNION ALL SELECT 'medications(active)', string_agg(name,' | ') FROM medication WHERE bot_id='gymak' AND user_id=255171226 AND active
UNION ALL SELECT 'medications(arsenal)', string_agg(name,' | ') FROM medication WHERE bot_id='gymak' AND user_id=255171226 AND NOT active
UNION ALL SELECT 'summary_len', length(summary_text)::text FROM client_summary WHERE bot_id='gymak' AND user_id=255171226;
