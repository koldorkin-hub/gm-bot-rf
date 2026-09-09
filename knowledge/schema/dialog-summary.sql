-- Скользящая сводка диалога (нить последних дней переписки сверх окна памяти агента).
-- Обновляется воркфлоу DialogSummary01 каждые 30 мин по водяному знаку last_message_id.
-- Идемпотентно.
CREATE TABLE IF NOT EXISTS dialog_summary (
  bot_id          text NOT NULL REFERENCES clients(bot_id),
  user_id         bigint NOT NULL,
  summary_text    text,
  last_message_id bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
ALTER TABLE dialog_summary OWNER TO n8n_user;
