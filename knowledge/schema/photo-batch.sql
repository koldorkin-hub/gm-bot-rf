-- Фото-пачки («копи до готово»). Состояние накопления в Postgres (не staticData).
-- Строка в photo_batch существует = юзер копит; финализация её удаляет.
-- Владелец n8n_user. Применять от postgres.
CREATE TABLE IF NOT EXISTS photo_batch (
  bot_id       text   NOT NULL REFERENCES clients(bot_id),
  user_id      bigint NOT NULL,
  chat_id      bigint NOT NULL,
  invited      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_file_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
ALTER TABLE photo_batch OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS photo_batch_sweep ON photo_batch (last_file_at);

CREATE TABLE IF NOT EXISTS photo_batch_item (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id   text   NOT NULL,
  user_id  bigint NOT NULL,
  file_id  text   NOT NULL,
  caption  text,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE photo_batch_item OWNER TO n8n_user;
CREATE INDEX IF NOT EXISTS photo_batch_item_lookup ON photo_batch_item (bot_id, user_id, added_at);
