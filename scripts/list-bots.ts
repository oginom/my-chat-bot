import { getTarget, runWranglerSqlJson } from "./shared.ts";

interface Result<T> {
  results: T[];
}

interface BotRow {
  id: string;
  name: string;
  model: string;
  created_at: number;
}

interface KeyRow {
  bot_id: string;
  provider: string;
}

interface PlatformRow {
  bot_id: string;
  platform: string;
}

async function main() {
  const target = getTarget(process.argv);
  const botsOut = runWranglerSqlJson(
    "SELECT id, name, model, created_at FROM bots ORDER BY created_at DESC;",
    target,
  ) as Result<BotRow>[];
  const bots = botsOut[0]?.results ?? [];
  if (bots.length === 0) {
    console.log("(no bots)");
    return;
  }

  const keysOut = runWranglerSqlJson(
    "SELECT bot_id, provider FROM bot_api_keys ORDER BY bot_id, provider;",
    target,
  ) as Result<KeyRow>[];
  const keys = keysOut[0]?.results ?? [];
  const keysByBot = new Map<string, string[]>();
  for (const k of keys) {
    const arr = keysByBot.get(k.bot_id) ?? [];
    arr.push(k.provider);
    keysByBot.set(k.bot_id, arr);
  }

  const platformsOut = runWranglerSqlJson(
    "SELECT bot_id, platform FROM bot_platforms ORDER BY bot_id, platform;",
    target,
  ) as Result<PlatformRow>[];
  const platforms = platformsOut[0]?.results ?? [];
  const platformsByBot = new Map<string, string[]>();
  for (const p of platforms) {
    const arr = platformsByBot.get(p.bot_id) ?? [];
    arr.push(p.platform);
    platformsByBot.set(p.bot_id, arr);
  }

  for (const b of bots) {
    const providers = keysByBot.get(b.id) ?? [];
    const providersStr = providers.length > 0 ? providers.join(",") : "(no keys)";
    const bp = platformsByBot.get(b.id) ?? [];
    const platformsStr = bp.length > 0 ? bp.join(",") : "(none)";
    console.log(
      `${b.id}  ${b.name}  model=${b.model}  keys=[${providersStr}]  platforms=[${platformsStr}]  ${new Date(b.created_at).toISOString()}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
