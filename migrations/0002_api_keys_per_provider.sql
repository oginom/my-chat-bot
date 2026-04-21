-- Move from single-provider-per-bot to multi-provider key storage.
-- Each bot can now hold API keys for openai/anthropic/gemini simultaneously,
-- with the provider chosen at request time by inferring from bots.model.

ALTER TABLE bots DROP COLUMN provider;
ALTER TABLE bots DROP COLUMN api_key_ciphertext;
ALTER TABLE bots DROP COLUMN api_key_iv;

CREATE TABLE bot_api_keys (
  bot_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, provider),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
