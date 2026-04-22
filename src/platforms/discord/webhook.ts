import type { Context } from "hono";
import { LIMITS } from "../../config.ts";
import type { Env } from "../../env.ts";
import { complete } from "../../llm/index.ts";
import { inferProvider } from "../../llm/provider.ts";
import { checkRateLimit } from "../../rate-limit.ts";
import { getApiKey, getBot, getDiscordBotPlatform, updateBotUserId } from "../../repository/bot.ts";
import { getChannelClearedAt, markChannelCleared } from "../../repository/channel.ts";
import { getRecentMessages, saveMessage } from "../../repository/message.ts";
import { getSelfUser, sendChannelMessage } from "./client.ts";
import type { DiscordMessage, DiscordRelayEnvelope } from "./types.ts";
import { verifyRelaySignature } from "./verify.ts";

const CLEAR_REPLY_TEXT = "会話履歴をリセットしました。";

// Discord renders Markdown, so no Markdown restrictions here (LINE has the opposite).
const PLATFORM_DIRECTIVES = [
  "# Discord プラットフォームの制約",
  "- 特に必要が無ければ、ユーザー名やサーバー名を返事に入れないでください。(例: xx さん、こんにちは！... や oo サーバーの皆さんでいかがでしょうか、のようなメッセージは不要)",
].join("\n");

export async function handleDiscordWebhook(
  c: Context<{ Bindings: Env }>,
  botId: string,
): Promise<Response> {
  const env = c.env;
  const rawBody = await c.req.text();
  const signature = c.req.header("x-relay-signature") ?? null;

  const ok = await verifyRelaySignature(env.DISCORD_RELAY_SECRET, rawBody, signature);
  if (!ok) return c.text("invalid signature", 401);

  const platform = await getDiscordBotPlatform(env.DB, botId, env.ENCRYPTION_KEY);
  if (!platform) return c.text("bot not found", 404);

  const envelope = JSON.parse(rawBody) as DiscordRelayEnvelope;
  if (envelope.type !== "MESSAGE_CREATE") return c.text("ok", 200);

  c.executionCtx.waitUntil(
    processMessage(env, botId, platform.botUserId, platform.credentials.botToken, envelope.data),
  );

  return c.text("ok", 200);
}

async function processMessage(
  env: Env,
  botId: string,
  cachedBotUserId: string | null,
  botToken: string,
  message: DiscordMessage,
): Promise<void> {
  let botUserId = cachedBotUserId;
  if (!botUserId) {
    const self = await getSelfUser(botToken);
    botUserId = self.id;
    await updateBotUserId(env.DB, botId, "discord", botUserId);
  }

  // Skip our own messages (bot replies echo back as MESSAGE_CREATE).
  if (message.author.id === botUserId) return;
  // Skip webhooks, interactions, and other non-user bots.
  if (message.author.bot) return;

  const channelId = message.channel_id;
  const isGuild = !!message.guild_id;
  const speakerName = isGuild ? resolveSpeakerName(message) : null;
  const contentForStorage = speakerName ? `${speakerName}: ${message.content}` : message.content;

  await saveMessage(env.DB, {
    botId,
    platform: "discord",
    channelId,
    role: "user",
    userId: message.author.id,
    content: contentForStorage,
  });

  if (!isBotAddressed(message, botUserId)) return;
  if (message.content.length > LIMITS.MAX_USER_INPUT_CHARS) return;

  const allowed = await checkRateLimit(env, "discord", botId, channelId);
  if (!allowed) {
    console.log(`rate limited: bot=${botId} channel=${channelId}`);
    return;
  }

  if (isClearCommand(message, botUserId)) {
    await markChannelCleared(env.DB, botId, "discord", channelId);
    await sendChannelMessage(botToken, channelId, CLEAR_REPLY_TEXT, message.id);
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

  const clearedAt = await getChannelClearedAt(env.DB, botId, "discord", channelId);
  const history = await getRecentMessages(env.DB, botId, "discord", channelId, clearedAt);
  const contextBlock = buildContextBlock(message);
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
    platform: "discord",
    channelId,
    role: "assistant",
    userId: null,
    content: answer,
  });

  await sendChannelMessage(botToken, channelId, answer, message.id);
}

function isBotAddressed(message: DiscordMessage, botUserId: string): boolean {
  if (!message.guild_id) return true; // DM
  return message.mentions.some((u) => u.id === botUserId);
}

function resolveSpeakerName(message: DiscordMessage): string {
  return message.member?.nick || message.author.global_name || message.author.username;
}

function stripMentionsOfBot(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "");
}

function isClearCommand(message: DiscordMessage, botUserId: string): boolean {
  return stripMentionsOfBot(message.content, botUserId).trim().toLowerCase() === "clear";
}

function buildContextBlock(message: DiscordMessage): string {
  const lines: string[] = [
    "# 現在の会話コンテキスト",
    "以下は、あなた (bot) が現在参加している Discord チャンネルの情報です。ユーザーがトークメンバーや自身について質問したときは、この情報をもとに自然に答えてください。",
    "",
  ];
  if (message.guild_id) {
    lines.push("- トーク形態: Discord サーバー内チャンネル");
    const speaker = resolveSpeakerName(message);
    if (speaker) lines.push(`- 発話者の表示名: ${speaker}`);
  } else {
    lines.push("- トーク形態: Discord DM");
    const speaker = message.author.global_name || message.author.username;
    if (speaker) lines.push(`- 相手の表示名: ${speaker}`);
  }
  return lines.join("\n");
}
