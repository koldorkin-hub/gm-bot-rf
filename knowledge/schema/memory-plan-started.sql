-- Дата старта активной программы клиента: детерминированный счёт «день N, неделя M»
-- (Build Profile Context считает от неё, агент номер дня не выдумывает).
-- Идемпотентно.
ALTER TABLE client_profile ADD COLUMN IF NOT EXISTS plan_started_on date;
