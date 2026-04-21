import type { CompleteArgs } from "./index.ts";

interface OpenAIResponse {
  choices: { message: { content: string } }[];
}

export async function openaiComplete(args: CompleteArgs): Promise<string> {
  const messages = [
    { role: "system", content: args.systemPrompt },
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({ model: args.model, messages }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as OpenAIResponse;
  const content = data.choices[0]?.message.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}
