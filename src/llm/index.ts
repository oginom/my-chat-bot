import type { Bot, Message } from "../types.ts";
import { openaiComplete } from "./openai.ts";
import { anthropicComplete } from "./anthropic.ts";
import { geminiComplete } from "./gemini.ts";

export interface CompleteArgs {
  bot: Bot;
  history: Message[];
}

export async function complete({ bot, history }: CompleteArgs): Promise<string> {
  switch (bot.provider) {
    case "openai":
      return openaiComplete(bot, history);
    case "anthropic":
      return anthropicComplete(bot, history);
    case "gemini":
      return geminiComplete(bot, history);
  }
}
