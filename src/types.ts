export type Provider = "openai" | "anthropic" | "gemini";
export type Platform = "line";
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

export interface BotPlatform {
  botId: string;
  platform: Platform;
  credentials: LinePlatformCredentials;
  botUserId: string | null;
}

export interface Message {
  role: Role;
  userId: string | null;
  content: string;
  createdAt: number;
}
