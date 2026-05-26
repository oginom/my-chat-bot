import type { CompleteArgs } from "./index.ts";

interface OpenAIResponsesAPI {
  output?: {
    type: string;
    content?: {
      type: string;
      text?: string;
      annotations?: { type: string; url?: string }[];
    }[];
  }[];
}

export async function openaiComplete(args: CompleteArgs): Promise<string> {
  const input = args.history.map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      instructions: args.systemPrompt,
      input,
      tools: [{ type: "web_search" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as OpenAIResponsesAPI;
  const blocks = (data.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text");
  const text = blocks.map((c) => c.text ?? "").join("");
  if (!text) throw new Error("OpenAI returned empty content");
  const urls = Array.from(
    new Set(
      blocks
        .flatMap((c) => c.annotations ?? [])
        .filter((a) => a.type === "url_citation" && a.url)
        .map((a) => a.url!),
    ),
  );
  return urls.length ? `${text}\n\n${urls.join("\n")}` : text;
}
