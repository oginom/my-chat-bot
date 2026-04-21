import type { Bot, Message } from "../types.ts";

interface AnthropicResponse {
  content: { type: string; text?: string }[];
}

export async function anthropicComplete(bot: Bot, history: Message[]): Promise<string> {
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": bot.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: bot.model,
      system: bot.systemPrompt,
      messages,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as AnthropicResponse;
  const text = data.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned empty content");
  return text;
}
