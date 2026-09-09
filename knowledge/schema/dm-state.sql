-- Состояние диалога отправки личного сообщения клиенту (/dm в саппорт-боте).
-- Одна строка: команда одна, владелец один.
CREATE TABLE IF NOT EXISTS dm_state (
  k              text PRIMARY KEY,
  stage          text NOT NULL DEFAULT 'idle',   -- idle | awaiting | confirm
  target_user_id bigint,
  target_bot_id  text,
  body           text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dm_state (k, stage) VALUES ('main', 'idle') ON CONFLICT (k) DO NOTHING;
ALTER TABLE dm_state OWNER TO n8n_user;
