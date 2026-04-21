import type { Provider } from "../types.ts";

export function inferProvider(model: string): Provider {
  if (
    model.startsWith("gpt") ||
    model.startsWith("chatgpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    return "openai";
  }
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "gemini";
  throw new Error(
    `cannot infer provider from model "${model}". Supported prefixes: gpt-/chatgpt/o1/o3/o4, claude-, gemini-`,
  );
}
