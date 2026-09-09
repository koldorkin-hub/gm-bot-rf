-- Разово по решению владельца (12.08.2026): старт активной программы СПБ = 10.08.2026.
-- Идемпотентно.
UPDATE client_profile SET plan_started_on = DATE '2026-08-10'
WHERE bot_id = 'gymak' AND user_id = 255171226
  AND plan_started_on IS DISTINCT FROM DATE '2026-08-10';

-- В тексте active_plan стояло «Старт программы — вторник 12.08» — противоречило бы счётчику дня.
UPDATE client_profile
SET active_plan = replace(active_plan, 'Старт программы — вторник 12.08', 'Старт программы — понедельник 10.08 (день программы считается от 10.08)')
WHERE bot_id = 'gymak' AND user_id = 255171226
  AND active_plan LIKE '%Старт программы — вторник 12.08%';
