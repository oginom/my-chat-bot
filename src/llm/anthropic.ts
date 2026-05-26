import type { CompleteArgs } from "./index.ts";

interface AnthropicResponse {
  content: {
    type: string;
    text?: string;
    citations?: { type: string; url?: string }[];
  }[];
}

export async function anthropicComplete(args: CompleteArgs): Promise<string> {
  const messages = args.history.map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: args.model,
      system: args.systemPrompt,
      messages,
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as AnthropicResponse;
  const textBlocks = data.content.filter((c) => c.type === "text");
  const text = textBlocks.map((c) => c.text ?? "").join("");
  if (!text) throw new Error("Anthropic returned empty content");
  const urls = Array.from(
    new Set(
      textBlocks
        .flatMap((c) => c.citations ?? [])
        .filter((cit) => cit.url)
        .map((cit) => cit.url!),
    ),
  );
  return urls.length ? `${text}\n\n${urls.join("\n")}` : text;
}
