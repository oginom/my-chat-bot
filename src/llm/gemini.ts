import type { CompleteArgs } from "./index.ts";

interface GeminiResponse {
  candidates?: {
    content: { parts: { text?: string }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string } }[];
    };
  }[];
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
      tools: [{ google_search: {} }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const candidate = data.candidates?.[0];
  const text = candidate?.content.parts.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned empty content");
  const urls = Array.from(
    new Set(
      (candidate?.groundingMetadata?.groundingChunks ?? [])
        .map((ch) => ch.web?.uri)
        .filter((u): u is string => !!u),
    ),
  );
  return urls.length ? `${text}\n\n${urls.join("\n")}` : text;
}
