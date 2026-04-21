import type { Context } from "hono";
import { LIMITS } from "../../config.ts";
import type { Env } from "../../env.ts";
import { complete } from "../../llm/index.ts";
import { inferProvider } from "../../llm/provider.ts";
import { checkRateLimit } from "../../rate-limit.ts";
import { getApiKey, getBot, getBotPlatform, updateBotUserId } from "../../repository/bot.ts";
import { getChannelClearedAt, markChannelCleared } from "../../repository/channel.ts";
import { getRecentMessages, saveMessage } from "../../repository/message.ts";
import { getBotInfo, replyMessage } from "./client.ts";
import {
  getBotDisplayName,
  getDmUserProfile,
  getGroupMemberDisplayName,
  getGroupMembers,
  getGroupSummary,
  getRoomMemberDisplayName,
  getRoomMembers,
} from "./profile.ts";
import type { LineEventSource, LineMessageEvent, LineWebhookBody } from "./types.ts";
import { verifyLineSignature } from "./verify.ts";

const CLEAR_REPLY_TEXT = "会話履歴をリセットしました。";

const PLATFORM_DIRECTIVES = [
  "# LINE プラットフォームの制約",
  "- LINE は Markdown をレンダリングしないため、Markdown 記法 (見出し、リスト記号、太字記号、コードブロックなど) は使わず、プレーンテキストで回答してください。",
].join("\n");

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

function textWithoutMentions(event: LineMessageEvent): string {
  const text = event.message.text ?? "";
  const mentionees = event.message.mention?.mentionees ?? [];
  if (mentionees.length === 0) return text;
  const sorted = [...mentionees].sort((a, b) => b.index - a.index);
  let result = text;
  for (const m of sorted) {
    result = result.slice(0, m.index) + result.slice(m.index + m.length);
  }
  return result;
}

function isClearCommand(event: LineMessageEvent): boolean {
  return textWithoutMentions(event).trim().toLowerCase() === "clear";
}

async function buildContextBlock(
  env: Env,
  botId: string,
  accessToken: string,
  source: LineEventSource,
): Promise<string> {
  const lines: string[] = [
    "# 現在の会話コンテキスト",
    "以下は、あなた (bot) が現在参加している LINE トークの情報です。ユーザーがトークメンバーや自身について質問したときは、この情報をもとに自然に答えてください。「個人情報にアクセスできない」などと断る必要はありません (LINE のプロフィール表示名は公開情報です)。",
    "",
  ];

  const botName = await getBotDisplayName(env, botId, accessToken);
  if (botName) lines.push(`- あなた (bot) の名前: ${botName}`);

  if (source.type === "user") {
    const profile = await getDmUserProfile(env, botId, source.userId, accessToken);
    lines.push("- トーク形態: 1:1 DM");
    if (profile.displayName) {
      lines.push(`- 相手の LINE 表示名: ${profile.displayName}`);
    }
  } else if (source.type === "group") {
    const summary = await getGroupSummary(env, botId, source.groupId, accessToken);
    lines.push(`- トーク形態: グループ${summary.name ? ` (グループ名: ${summary.name})` : ""}`);
    const members = await getGroupMembers(env, botId, source.groupId, accessToken);
    const names = members.map((m) => m.displayName).filter((n): n is string => !!n);
    if (names.length > 0) lines.push(`- 参加メンバー (LINE 表示名): ${names.join(", ")}`);
  } else {
    lines.push("- トーク形態: 複数人トーク (LINE ルーム)");
    const members = await getRoomMembers(env, botId, source.roomId, accessToken);
    const names = members.map((m) => m.displayName).filter((n): n is string => !!n);
    if (names.length > 0) lines.push(`- 参加メンバー (LINE 表示名): ${names.join(", ")}`);
  }

  return lines.join("\n");
}

async function resolveSpeakerName(
  env: Env,
  botId: string,
  accessToken: string,
  source: LineEventSource,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  if (source.type === "group") {
    return getGroupMemberDisplayName(env, botId, source.groupId, userId, accessToken);
  }
  if (source.type === "room") {
    return getRoomMemberDisplayName(env, botId, source.roomId, userId, accessToken);
  }
  return null;
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

  // Record every text message (even when bot is not addressed) so the LLM
  // sees the full group conversation when it is eventually mentioned.
  // For group/room, prefix the content with the speaker's display name so
  // the LLM can distinguish multiple participants.
  const speakerName = await resolveSpeakerName(env, botId, accessToken, event.source, userId);
  const contentForStorage = speakerName ? `${speakerName}: ${text}` : text;
  await saveMessage(env.DB, {
    botId,
    platform: "line",
    channelId,
    role: "user",
    userId,
    content: contentForStorage,
  });

  if (!isBotAddressed(event, botUserId)) return;
  if (text.length > LIMITS.MAX_USER_INPUT_CHARS) return;

  const allowed = await checkRateLimit(env, botId, channelId);
  if (!allowed) {
    console.log(`rate limited: bot=${botId} channel=${channelId}`);
    return;
  }

  if (isClearCommand(event)) {
    await markChannelCleared(env.DB, botId, "line", channelId);
    await replyMessage(accessToken, event.replyToken, CLEAR_REPLY_TEXT);
    return;
  }

  const bot = await getBot(env.DB, botId);
  if (!bot) {
    console.error(`bot config missing for ${botId}`);
    return;
  }

  const provider = inferProvider(bot.model);
  const apiKey = await getApiKey(env.DB, botId, provider, env.ENCRYPTION_KEY);
  if (!apiKey) {
    console.error(
      `no ${provider} API key registered for bot ${botId} (model=${bot.model}). Add it with: pnpm bot:set-key ${botId} ${provider}`,
    );
    return;
  }

  const clearedAt = await getChannelClearedAt(env.DB, botId, "line", channelId);

  const [history, contextBlock] = await Promise.all([
    getRecentMessages(env.DB, botId, "line", channelId, clearedAt),
    buildContextBlock(env, botId, accessToken, event.source),
  ]);

  const systemPromptWithContext = `${bot.systemPrompt}\n\n${PLATFORM_DIRECTIVES}\n\n${contextBlock}`;

  const answer = await complete({
    provider,
    model: bot.model,
    apiKey,
    systemPrompt: systemPromptWithContext,
    history,
  });

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
