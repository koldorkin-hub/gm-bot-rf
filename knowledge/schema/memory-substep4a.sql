-- Подэтап 4a: флаг покрытия темы безопасности в онбординге.
-- Идемпотентно. Применять: cat ... | su - postgres -c "psql -d n8n_memory -v ON_ERROR_STOP=1 -f -"
ALTER TABLE client_profile ADD COLUMN IF NOT EXISTS onboarding_safety_done boolean NOT NULL DEFAULT false;
