-- ============================================================================
-- ОТКАТ подэтапа 1 (Фундамент), волна 1. Сносит ТОЛЬКО новые таблицы.
-- Существующие (clients, n8n_chat_histories, research_*, answer_sources) НЕ трогает.
-- Применять при необходимости отката:
--   su - postgres -c "psql -d n8n_memory -f /root/memory-block/memory-wave1-rollback.sql"
-- Порядок — обратный зависимостям FK. CASCADE снимает дочерние (recipe_ingredient и т.п.).
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS workout_entry      CASCADE;
DROP TABLE IF EXISTS workout_session    CASCADE;
DROP TABLE IF EXISTS food_log           CASCADE;
DROP TABLE IF EXISTS recipe_ingredient  CASCADE;
DROP TABLE IF EXISTS recipe             CASCADE;
DROP TABLE IF EXISTS measurement        CASCADE;
DROP TABLE IF EXISTS allergen           CASCADE;
DROP TABLE IF EXISTS food_preference    CASCADE;
DROP TABLE IF EXISTS medication         CASCADE;
DROP TABLE IF EXISTS condition          CASCADE;
DROP TABLE IF EXISTS injury             CASCADE;
DROP TABLE IF EXISTS exclusion          CASCADE;
DROP TABLE IF EXISTS research_report    CASCADE;
DROP TABLE IF EXISTS plan               CASCADE;
DROP TABLE IF EXISTS client_summary     CASCADE;
DROP TABLE IF EXISTS extraction_state   CASCADE;
DROP TABLE IF EXISTS chat_history_archive CASCADE;
DROP TABLE IF EXISTS client_profile     CASCADE;
DROP TABLE IF EXISTS activity_library   CASCADE;
DROP TABLE IF EXISTS freshness_policy   CASCADE;

COMMIT;
