-- Хвост research-отчётов: колонка под структуру для пересборки PDF из памяти.
-- Таблица research_report пуста (проверено 31.07.2026) — миграция без легаси.
-- Владелец таблицы уже n8n_user; ADD COLUMN сохраняет владельца.
ALTER TABLE research_report ADD COLUMN IF NOT EXISTS report_json jsonb;
