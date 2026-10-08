-- D1 schema for conversation memory
CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT     NOT NULL,
  role       TEXT     NOT NULL CHECK(role IN ('user', 'assistant')),
  content    TEXT     NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_time ON conversations(user_id, created_at);
