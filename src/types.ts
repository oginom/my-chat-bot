export type Provider = "openai" | "anthropic" | "gemini";
export type Platform = "line" | "discord";
export type Role = "user" | "assistant";

export interface Bot {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
}

export interface LinePlatformCredentials {
  channelSecret: string;
  channelAccessToken: string;
}

export interface DiscordPlatformCredentials {
  botToken: string;
}

export type PlatformCredentials =
  | { platform: "line"; credentials: LinePlatformCredentials }
  | { platform: "discord"; credentials: DiscordPlatformCredentials };

export interface BotPlatform<P extends Platform = Platform> {
  botId: string;
  platform: P;
  credentials: P extends "line"
    ? LinePlatformCredentials
    : P extends "discord"
      ? DiscordPlatformCredentials
      : never;
  botUserId: string | null;
}

export interface Message {
  role: Role;
  userId: string | null;
  content: string;
  createdAt: number;
}
