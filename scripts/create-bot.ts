import { encryptString } from "../src/crypto.ts";
import { inferProvider } from "../src/llm/provider.ts";
import type { Platform, Provider } from "../src/types.ts";
import {
  PLATFORMS,
  getMasterKey,
  getTarget,
  prompt,
  promptPlatformCredentials,
  runWranglerSql,
  sqlQuote,
} from "./shared.ts";

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

  const platformsInput = await prompt(
    `\nPlatforms to register (comma-separated from: ${PLATFORMS.join(", ")}): `,
  );
  const selectedPlatforms = platformsInput
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const p of selectedPlatforms) {
    if (!(PLATFORMS as string[]).includes(p)) {
      throw new Error(`unknown platform: ${p}. one of: ${PLATFORMS.join(", ")}`);
    }
  }
  if (selectedPlatforms.length === 0) {
    throw new Error("at least one platform is required");
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  const platformStatements: string[] = [];
  for (const platform of selectedPlatforms as Platform[]) {
    const creds = await promptPlatformCredentials(platform);
    const enc = await encryptString(JSON.stringify(creds), masterKey);
    platformStatements.push(
      `INSERT INTO bot_platforms (bot_id, platform, credentials_ciphertext, credentials_iv, bot_user_id, created_at, updated_at) VALUES (${sqlQuote(id)}, ${sqlQuote(platform)}, ${sqlQuote(enc.ciphertext)}, ${sqlQuote(enc.iv)}, NULL, ${now}, ${now});`,
    );
  }

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
    ...platformStatements,
  ].join("\n");

  runWranglerSql(sql, target);

  console.log(`\nBot created. id=${id}`);
  console.log(`Registered providers: ${Object.keys(keys).join(", ")}`);
  console.log(`Registered platforms: ${selectedPlatforms.join(", ")}`);
  if (selectedPlatforms.includes("line")) {
    console.log(`\nLINE webhook URL:`);
    console.log(`  https://<your-worker>.workers.dev/webhook/line/${id}`);
  }
  if (selectedPlatforms.includes("discord")) {
    console.log(`\nDiscord: the Fly relay will pick up this bot on its next refresh (within ~10 min).`);
    console.log(`Make sure MESSAGE_CONTENT intent is enabled in the Discord Developer Portal.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
