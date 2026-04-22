import { encryptString } from "../src/crypto.ts";
import {
  PLATFORMS,
  getMasterKey,
  getTarget,
  isPlatform,
  promptPlatformCredentials,
  runWranglerSql,
  sqlQuote,
} from "./shared.ts";

async function main() {
  const target = getTarget(process.argv);
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const botId = args[0];
  const platform = args[1];

  if (!botId || !platform) {
    console.error(
      "usage: pnpm bot:add-platform <bot-id> <line|discord> [--remote|--local]",
    );
    process.exit(1);
  }
  if (!isPlatform(platform)) {
    console.error(`invalid platform: ${platform}. one of: ${PLATFORMS.join(", ")}`);
    process.exit(1);
  }

  const masterKey = getMasterKey();
  const creds = await promptPlatformCredentials(platform);
  const enc = await encryptString(JSON.stringify(creds), masterKey);
  const now = Date.now();

  // Upsert. On credential change we reset bot_user_id so it's re-fetched.
  const sql = `INSERT INTO bot_platforms (bot_id, platform, credentials_ciphertext, credentials_iv, bot_user_id, created_at, updated_at)
    VALUES (${sqlQuote(botId)}, ${sqlQuote(platform)}, ${sqlQuote(enc.ciphertext)}, ${sqlQuote(enc.iv)}, NULL, ${now}, ${now})
    ON CONFLICT (bot_id, platform) DO UPDATE SET
      credentials_ciphertext = excluded.credentials_ciphertext,
      credentials_iv = excluded.credentials_iv,
      bot_user_id = NULL,
      updated_at = excluded.updated_at;`;

  runWranglerSql(sql, target);
  console.log(`${platform} platform set for bot ${botId}`);
  if (platform === "line") {
    console.log(`LINE webhook URL: https://<your-worker>.workers.dev/webhook/line/${botId}`);
  }
  if (platform === "discord") {
    console.log(`The Fly relay will pick up this bot on its next refresh (within ~10 min).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
