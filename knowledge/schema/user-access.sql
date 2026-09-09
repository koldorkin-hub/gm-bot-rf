-- Per-user контроль доступа: кто пущен на какого бота и до какой даты.
-- Строка = доступ разрешён; access_until NULL = бессрочно, дата = до неё (free/оплачено до).
-- Тир остаётся per-bot (clients.bot_type). Владелец таблицы n8n_user.
CREATE TABLE IF NOT EXISTS user_access (
  bot_id       text   NOT NULL REFERENCES clients(bot_id),
  user_id      bigint NOT NULL,
  access_until date,                      -- NULL = бессрочно
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
ALTER TABLE user_access OWNER TO n8n_user;

-- Сид: владелец на своём боте — бессрочно (чтобы гейт его не залочил)
INSERT INTO user_access (bot_id, user_id, access_until, note)
VALUES ('gymak', 255171226, NULL, 'owner')
ON CONFLICT (bot_id, user_id) DO NOTHING;
