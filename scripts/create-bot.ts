import { encryptString } from "../src/crypto.ts";
import { inferProvider } from "../src/llm/provider.ts";
import type { Provider } from "../src/types.ts";
import { getMasterKey, getTarget, prompt, runWranglerSql, sqlQuote } from "./shared.ts";

const PROVIDERS: Provider[] = ["openai", "anthropic", "gemini"];

async function main() {
  const target = getTarget(process.argv);
  const masterKey = getMasterKey();

  console.log(`Creating bot in ${target} D1 database.\n`);

  const name = await prompt("Bot name: ");
  const model = await prompt(
    "Default model (e.g. gpt-4o-mini / claude-sonnet-4-6 / gemini-2.5-flash): ",
  );
  const requiredProvider = inferProvider(model);
  const systemPrompt = await prompt("System prompt: ");

  console.log("\nAPI keys (leave blank to skip; add later with `pnpm bot:set-key`):");
  const keys: Partial<Record<Provider, string>> = {};
  for (const p of PROVIDERS) {
    const key = await prompt(`  ${p} API key: `);
    if (key) keys[p] = key;
  }

  if (!keys[requiredProvider]) {
    throw new Error(
      `model "${model}" requires a ${requiredProvider} API key, but you did not provide one.`,
    );
  }

  console.log("\nLINE platform credentials:");
  const channelSecret = await prompt("  Channel secret: ");
  const channelAccessToken = await prompt("  Channel access token: ");

  const id = crypto.randomUUID();
  const now = Date.now();

  const credsEnc = await encryptString(
    JSON.stringify({ channelSecret, channelAccessToken }),
    masterKey,
  );

  const keyStatements: string[] = [];
  for (const [provider, key] of Object.entries(keys) as [Provider, string][]) {
    const enc = await encryptString(key, masterKey);
    keyStatements.push(
      `INSERT INTO bot_api_keys (bot_id, provider, ciphertext, iv, created_at, updated_at) VALUES (${sqlQuote(id)}, ${sqlQuote(provider)}, ${sqlQuote(enc.ciphertext)}, ${sqlQuote(enc.iv)}, ${now}, ${now});`,
    );
  }

  const sql = [
    `INSERT INTO bots (id, name, model, system_prompt, created_at, updated_at) VALUES (${sqlQuote(id)}, ${sqlQuote(name)}, ${sqlQuote(model)}, ${sqlQuote(systemPrompt)}, ${now}, ${now});`,
    ...keyStatements,
    `INSERT INTO bot_platforms (bot_id, platform, credentials_ciphertext, credentials_iv, bot_user_id, created_at, updated_at) VALUES (${sqlQuote(id)}, 'line', ${sqlQuote(credsEnc.ciphertext)}, ${sqlQuote(credsEnc.iv)}, NULL, ${now}, ${now});`,
  ].join("\n");

  runWranglerSql(sql, target);

  console.log(`\nBot created. id=${id}`);
  console.log(`Registered providers: ${Object.keys(keys).join(", ")}`);
  console.log(`Set this webhook URL in LINE Developers Console:`);
  console.log(`  https://<your-worker>.workers.dev/webhook/line/${id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
