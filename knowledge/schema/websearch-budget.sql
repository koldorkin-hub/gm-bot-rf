-- Бюджет вызовов веб-поиска в пределах ОДНОГО сообщения клиента. Идемпотентно.
-- Повод (03.09.2026): на вопросе по фарме агент уходил в петлю веб-поисков,
-- исполнение висело 30 минут и умирало по таймауту молча.
CREATE TABLE IF NOT EXISTS websearch_budget (
  bot_id     text NOT NULL,
  session_id text NOT NULL,
  msg_key    text NOT NULL,
  n          integer NOT NULL DEFAULT 0,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, session_id, msg_key)
);
CREATE INDEX IF NOT EXISTS websearch_budget_at ON websearch_budget (at);
ALTER TABLE websearch_budget OWNER TO n8n_user;

-- Флаг «агент сейчас думает» — чтобы отвечать на повторные сообщения
-- и чтобы сторож мог поймать зависшее исполнение и написать клиенту.
CREATE TABLE IF NOT EXISTS agent_busy (
  bot_id     text NOT NULL,
  user_id    bigint NOT NULL,
  chat_id    bigint,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
CREATE INDEX IF NOT EXISTS agent_busy_started ON agent_busy (started_at);
ALTER TABLE agent_busy OWNER TO n8n_user;
