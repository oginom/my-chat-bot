-- Allow 'discord' in addition to 'line' for bot_platforms.platform.
-- SQLite cannot ALTER a CHECK constraint, so the table is recreated.

CREATE TABLE bot_platforms_new (
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('line', 'discord')),
  credentials_ciphertext TEXT NOT NULL,
  credentials_iv TEXT NOT NULL,
  bot_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, platform),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

INSERT INTO bot_platforms_new SELECT * FROM bot_platforms;
DROP TABLE bot_platforms;
ALTER TABLE bot_platforms_new RENAME TO bot_platforms;
