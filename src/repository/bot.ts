import { decryptString } from "../crypto.ts";
import type { Bot, BotPlatform, LinePlatformCredentials, Platform, Provider } from "../types.ts";

interface BotRow {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  api_key_ciphertext: string;
  api_key_iv: string;
}

interface BotPlatformRow {
  bot_id: string;
  platform: Platform;
  credentials_ciphertext: string;
  credentials_iv: string;
  bot_user_id: string | null;
}

export async function getBot(db: D1Database, botId: string, masterKey: string): Promise<Bot | null> {
  const row = await db
    .prepare(
      "SELECT id, name, provider, model, system_prompt, api_key_ciphertext, api_key_iv FROM bots WHERE id = ?",
    )
    .bind(botId)
    .first<BotRow>();
  if (!row) return null;
  const apiKey = await decryptString(row.api_key_ciphertext, row.api_key_iv, masterKey);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.system_prompt,
    apiKey,
  };
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
