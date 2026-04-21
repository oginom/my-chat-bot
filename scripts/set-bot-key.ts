import { encryptString } from "../src/crypto.ts";
import type { Provider } from "../src/types.ts";
import { getMasterKey, getTarget, prompt, runWranglerSql, sqlQuote } from "./shared.ts";

const PROVIDERS: Provider[] = ["openai", "anthropic", "gemini"];

function isProvider(s: string): s is Provider {
  return (PROVIDERS as string[]).includes(s);
}

async function main() {
  const target = getTarget(process.argv);
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const botId = args[0];
  const provider = args[1];

  if (!botId || !provider) {
    console.error("usage: pnpm bot:set-key <bot-id> <openai|anthropic|gemini> [--remote|--local]");
    process.exit(1);
  }
  if (!isProvider(provider)) {
    console.error(`invalid provider: ${provider}. one of: ${PROVIDERS.join(", ")}`);
    process.exit(1);
  }

  const masterKey = getMasterKey();
  const key = await prompt(`${provider} API key for bot ${botId}: `);
  if (!key) {
    console.error("key is required");
    process.exit(1);
  }

  const enc = await encryptString(key, masterKey);
  const now = Date.now();

  // INSERT ... ON CONFLICT (bot_id, provider) DO UPDATE for upsert
  const sql = `INSERT INTO bot_api_keys (bot_id, provider, ciphertext, iv, created_at, updated_at) VALUES (${sqlQuote(botId)}, ${sqlQuote(provider)}, ${sqlQuote(enc.ciphertext)}, ${sqlQuote(enc.iv)}, ${now}, ${now})
    ON CONFLICT (bot_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at;`;

  runWranglerSql(sql, target);
  console.log(`${provider} key set for bot ${botId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
