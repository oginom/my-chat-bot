-- Per-channel meta state. Currently only records the "context cleared at"
-- timestamp; messages before this timestamp are ignored when building
-- the history sent to the LLM. The messages table itself is untouched.

CREATE TABLE channel_state (
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  cleared_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, platform, channel_id),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
