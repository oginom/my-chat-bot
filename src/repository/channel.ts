import type { Platform } from "../types.ts";

export async function markChannelCleared(
  db: D1Database,
  botId: string,
  platform: Platform,
  channelId: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO channel_state (bot_id, platform, channel_id, cleared_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (bot_id, platform, channel_id) DO UPDATE SET cleared_at = excluded.cleared_at`,
    )
    .bind(botId, platform, channelId, now)
    .run();
}

export async function getChannelClearedAt(
  db: D1Database,
  botId: string,
  platform: Platform,
  channelId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT cleared_at FROM channel_state WHERE bot_id = ? AND platform = ? AND channel_id = ?")
    .bind(botId, platform, channelId)
    .first<{ cleared_at: number }>();
  return row?.cleared_at ?? 0;
}
