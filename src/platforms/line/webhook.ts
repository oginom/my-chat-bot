import type { Context } from "hono";
import { LIMITS } from "../../config.ts";
import type { Env } from "../../env.ts";
import { complete } from "../../llm/index.ts";
import { checkRateLimit } from "../../rate-limit.ts";
import { getBot, getBotPlatform, updateBotUserId } from "../../repository/bot.ts";
import { getRecentMessages, saveMessage } from "../../repository/message.ts";
import { getBotInfo, replyMessage } from "./client.ts";
import type { LineEventSource, LineMessageEvent, LineWebhookBody } from "./types.ts";
import { verifyLineSignature } from "./verify.ts";

export async function handleLineWebhook(
  c: Context<{ Bindings: Env }>,
  botId: string,
): Promise<Response> {
  const env = c.env;
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature") ?? null;

  const platform = await getBotPlatform(env.DB, botId, "line", env.ENCRYPTION_KEY);
  if (!platform) return c.text("bot not found", 404);

  const ok = await verifyLineSignature(platform.credentials.channelSecret, rawBody, signature);
  if (!ok) return c.text("invalid signature", 401);

  const body = JSON.parse(rawBody) as LineWebhookBody;

  c.executionCtx.waitUntil(processEvents(env, botId, platform.botUserId, platform.credentials.channelAccessToken, body));

  return c.text("ok", 200);
}

async function processEvents(
  env: Env,
  botId: string,
  cachedBotUserId: string | null,
  accessToken: string,
  body: LineWebhookBody,
): Promise<void> {
  let botUserId = cachedBotUserId;
  if (!botUserId) {
    const info = await getBotInfo(accessToken);
    botUserId = info.userId;
    await updateBotUserId(env.DB, botId, "line", botUserId);
  }

  for (const event of body.events) {
    if (event.type !== "message") continue;
    const msg = event as LineMessageEvent;
    if (msg.message.type !== "text" || !msg.message.text) continue;
    await handleTextMessage(env, botId, botUserId, accessToken, msg);
  }
}

function resolveChannelId(source: LineEventSource): string {
  if (source.type === "user") return source.userId;
  if (source.type === "group") return source.groupId;
  return source.roomId;
}

function isBotAddressed(event: LineMessageEvent, botUserId: string): boolean {
  if (event.source.type === "user") return true;
  const mentionees = event.message.mention?.mentionees ?? [];
  return mentionees.some((m) => m.userId === botUserId);
}

async function handleTextMessage(
  env: Env,
  botId: string,
  botUserId: string,
  accessToken: string,
  event: LineMessageEvent,
): Promise<void> {
  const text = event.message.text ?? "";
  const channelId = resolveChannelId(event.source);
  const userId = event.source.type === "user" ? event.source.userId : (event.source.userId ?? null);

  if (!isBotAddressed(event, botUserId)) return;
  if (text.length > LIMITS.MAX_USER_INPUT_CHARS) return;

  const allowed = await checkRateLimit(env, botId, channelId);
  if (!allowed) {
    console.log(`rate limited: bot=${botId} channel=${channelId}`);
    return;
  }

  const bot = await getBot(env.DB, botId, env.ENCRYPTION_KEY);
  if (!bot) {
    console.error(`bot config missing for ${botId}`);
    return;
  }

  await saveMessage(env.DB, {
    botId,
    platform: "line",
    channelId,
    role: "user",
    userId,
    content: text,
  });

  const history = await getRecentMessages(env.DB, botId, "line", channelId);
  const answer = await complete({ bot, history });

  await saveMessage(env.DB, {
    botId,
    platform: "line",
    channelId,
    role: "assistant",
    userId: null,
    content: answer,
  });

  await replyMessage(accessToken, event.replyToken, answer);
}
