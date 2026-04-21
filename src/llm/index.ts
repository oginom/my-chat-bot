import type { Message, Provider } from "../types.ts";
import { openaiComplete } from "./openai.ts";
import { anthropicComplete } from "./anthropic.ts";
import { geminiComplete } from "./gemini.ts";

export interface CompleteArgs {
  provider: Provider;
  model: string;
  apiKey: string;
  systemPrompt: string;
  history: Message[];
}

export async function complete(args: CompleteArgs): Promise<string> {
  switch (args.provider) {
    case "openai":
      return openaiComplete(args);
    case "anthropic":
      return anthropicComplete(args);
    case "gemini":
      return geminiComplete(args);
  }
}
