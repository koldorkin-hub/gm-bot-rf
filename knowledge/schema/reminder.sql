-- Напоминания. Идемпотентно.
-- Повод: бот не умел напоминать вообще и отправлял клиента заводить будильник.
CREATE TABLE IF NOT EXISTS reminder (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id      text NOT NULL,
  user_id     bigint NOT NULL,
  chat_id     bigint,
  fire_at     timestamptz NOT NULL,          -- всегда в UTC, пересчитано из пояса клиента
  text        text NOT NULL,
  repeat_rule text NOT NULL DEFAULT 'none',  -- none | daily | weekly
  status      text NOT NULL DEFAULT 'pending', -- pending | sent | cancelled | failed
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
-- Тикер ходит сюда каждые 5 минут — индекс по сроку и статусу обязателен.
CREATE INDEX IF NOT EXISTS reminder_due ON reminder (fire_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS reminder_owner ON reminder (bot_id, user_id, status);
ALTER TABLE reminder OWNER TO n8n_user;
