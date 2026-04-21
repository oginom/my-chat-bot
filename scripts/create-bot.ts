import { encryptString } from "../src/crypto.ts";
import { getMasterKey, getTarget, prompt, runWranglerSql, sqlQuote } from "./shared.ts";

async function main() {
  const target = getTarget(process.argv);
  const masterKey = getMasterKey();

  console.log(`Creating bot in ${target} D1 database.\n`);

  const name = await prompt("Bot name: ");
  const provider = (await prompt("Provider (openai | anthropic | gemini): ")).toLowerCase();
  if (!["openai", "anthropic", "gemini"].includes(provider)) {
    throw new Error(`invalid provider: ${provider}`);
  }
  const model = await prompt("Model (e.g. gpt-4o-mini / claude-sonnet-4-6 / gemini-2.5-flash): ");
  const systemPrompt = await prompt("System prompt: ");
  const apiKey = await prompt(`${provider} API key: `);

  console.log("\nLINE platform credentials:");
  const channelSecret = await prompt("  Channel secret: ");
  const channelAccessToken = await prompt("  Channel access token: ");

  const id = crypto.randomUUID();
  const now = Date.now();

  const apiEnc = await encryptString(apiKey, masterKey);
  const credsEnc = await encryptString(
    JSON.stringify({ channelSecret, channelAccessToken }),
    masterKey,
  );

  const sql = [
    `INSERT INTO bots (id, name, provider, model, system_prompt, api_key_ciphertext, api_key_iv, created_at, updated_at) VALUES (${sqlQuote(id)}, ${sqlQuote(name)}, ${sqlQuote(provider)}, ${sqlQuote(model)}, ${sqlQuote(systemPrompt)}, ${sqlQuote(apiEnc.ciphertext)}, ${sqlQuote(apiEnc.iv)}, ${now}, ${now});`,
    `INSERT INTO bot_platforms (bot_id, platform, credentials_ciphertext, credentials_iv, bot_user_id, created_at, updated_at) VALUES (${sqlQuote(id)}, 'line', ${sqlQuote(credsEnc.ciphertext)}, ${sqlQuote(credsEnc.iv)}, NULL, ${now}, ${now});`,
  ].join("\n");

  runWranglerSql(sql, target);

  console.log(`\nBot created. id=${id}`);
  console.log(`Set this webhook URL in LINE Developers Console:`);
  console.log(`  https://<your-worker>.workers.dev/webhook/line/${id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
