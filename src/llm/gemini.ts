import type { CompleteArgs } from "./index.ts";

interface GeminiResponse {
  candidates?: { content: { parts: { text?: string }[] } }[];
}

export async function geminiComplete(args: CompleteArgs): Promise<string> {
  const contents = args.history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.systemPrompt }] },
      contents,
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content.parts.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}
