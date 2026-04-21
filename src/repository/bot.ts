import { decryptString } from "../crypto.ts";
import type { Bot, BotPlatform, LinePlatformCredentials, Platform, Provider } from "../types.ts";

interface BotRow {
  id: string;
  name: string;
  model: string;
  system_prompt: string;
}

interface BotPlatformRow {
  bot_id: string;
  platform: Platform;
  credentials_ciphertext: string;
  credentials_iv: string;
  bot_user_id: string | null;
}

interface ApiKeyRow {
  ciphertext: string;
  iv: string;
}

export async function getBot(db: D1Database, botId: string): Promise<Bot | null> {
  const row = await db
    .prepare("SELECT id, name, model, system_prompt FROM bots WHERE id = ?")
    .bind(botId)
    .first<BotRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    systemPrompt: row.system_prompt,
  };
}

export async function getApiKey(
  db: D1Database,
  botId: string,
  provider: Provider,
  masterKey: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT ciphertext, iv FROM bot_api_keys WHERE bot_id = ? AND provider = ?")
    .bind(botId, provider)
    .first<ApiKeyRow>();
  if (!row) return null;
  return decryptString(row.ciphertext, row.iv, masterKey);
}

export async function getBotPlatform(
  db: D1Database,
  botId: string,
  platform: Platform,
  masterKey: string,
): Promise<BotPlatform | null> {
  const row = await db
    .prepare(
      "SELECT bot_id, platform, credentials_ciphertext, credentials_iv, bot_user_id FROM bot_platforms WHERE bot_id = ? AND platform = ?",
    )
    .bind(botId, platform)
    .first<BotPlatformRow>();
  if (!row) return null;
  const credentialsJson = await decryptString(row.credentials_ciphertext, row.credentials_iv, masterKey);
  const credentials = JSON.parse(credentialsJson) as LinePlatformCredentials;
  return {
    botId: row.bot_id,
    platform: row.platform,
    credentials,
    botUserId: row.bot_user_id,
  };
}

export async function updateBotUserId(
  db: D1Database,
  botId: string,
  platform: Platform,
  botUserId: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare("UPDATE bot_platforms SET bot_user_id = ?, updated_at = ? WHERE bot_id = ? AND platform = ?")
    .bind(botUserId, now, botId, platform)
    .run();
}
