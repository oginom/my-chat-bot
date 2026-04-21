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

  for (const b of bots) {
    const providers = keysByBot.get(b.id) ?? [];
    const providersStr = providers.length > 0 ? providers.join(",") : "(no keys)";
    console.log(
      `${b.id}  ${b.name}  model=${b.model}  keys=[${providersStr}]  ${new Date(b.created_at).toISOString()}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
