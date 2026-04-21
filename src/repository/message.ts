import { LIMITS } from "../config.ts";
import type { Message, Platform, Role } from "../types.ts";

interface MessageRow {
  role: Role;
  user_id: string | null;
  content: string;
  created_at: number;
}

export async function saveMessage(
  db: D1Database,
  params: {
    botId: string;
    platform: Platform;
    channelId: string;
    role: Role;
    userId: string | null;
    content: string;
  },
): Promise<void> {
  const truncated = params.content.slice(0, LIMITS.MAX_STORED_CONTENT_CHARS);
  await db
    .prepare(
      "INSERT INTO messages (bot_id, platform, channel_id, role, user_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(params.botId, params.platform, params.channelId, params.role, params.userId, truncated, Date.now())
    .run();
}

export async function getRecentMessages(
  db: D1Database,
  botId: string,
  platform: Platform,
  channelId: string,
  limit = LIMITS.HISTORY_MESSAGES,
): Promise<Message[]> {
  const { results } = await db
    .prepare(
      "SELECT role, user_id, content, created_at FROM messages WHERE bot_id = ? AND platform = ? AND channel_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(botId, platform, channelId, limit)
    .all<MessageRow>();
  return results
    .map((r) => ({
      role: r.role,
      userId: r.user_id,
      content: r.content,
      createdAt: r.created_at,
    }))
    .reverse();
}
