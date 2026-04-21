import type { Bot, Message } from "../types.ts";

interface OpenAIResponse {
  choices: { message: { content: string } }[];
}

export async function openaiComplete(bot: Bot, history: Message[]): Promise<string> {
  const messages = [
    { role: "system", content: bot.systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bot.apiKey}`,
    },
    body: JSON.stringify({ model: bot.model, messages }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as OpenAIResponse;
  const content = data.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}
