-- Bot configuration: LLM provider + system prompt + API key
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Platform credentials (LINE channel secret, access token, etc.)
CREATE TABLE bot_platforms (
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('line')),
  credentials_ciphertext TEXT NOT NULL,
  credentials_iv TEXT NOT NULL,
  bot_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, platform),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

-- Chat history (per channel). Retention: unlimited.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  user_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_channel
  ON messages (bot_id, platform, channel_id, created_at DESC);
