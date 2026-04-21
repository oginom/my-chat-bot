import { inferProvider } from "../src/llm/provider.ts";
import { getTarget, runWranglerSql, runWranglerSqlJson, sqlQuote } from "./shared.ts";

interface Result {
  results: { id: string; model: string }[];
}

function parseKv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

async function main() {
  const target = getTarget(process.argv);
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const botId = positional[0];
  const opts = parseKv(process.argv.slice(2));

  if (!botId) {
    console.error("usage: pnpm bot:edit <bot-id> [--model=<model>] [--system-prompt=<text>] [--name=<name>] [--remote|--local]");
    process.exit(1);
  }

  const fields: string[] = [];
  if (opts.model !== undefined) {
    inferProvider(opts.model); // validate model maps to a known provider
    fields.push(`model = ${sqlQuote(opts.model)}`);
  }
  if (opts["system-prompt"] !== undefined) {
    fields.push(`system_prompt = ${sqlQuote(opts["system-prompt"])}`);
  }
  if (opts.name !== undefined) {
    fields.push(`name = ${sqlQuote(opts.name)}`);
  }
  if (fields.length === 0) {
    console.error("no fields to update. pass at least one of --model / --system-prompt / --name");
    process.exit(1);
  }

  fields.push(`updated_at = ${Date.now()}`);
  const sql = `UPDATE bots SET ${fields.join(", ")} WHERE id = ${sqlQuote(botId)};`;
  runWranglerSql(sql, target);

  // Warn if model changed but no key for that provider
  if (opts.model !== undefined) {
    const provider = inferProvider(opts.model);
    const check = runWranglerSqlJson(
      `SELECT COUNT(*) AS c FROM bot_api_keys WHERE bot_id = ${sqlQuote(botId)} AND provider = ${sqlQuote(provider)};`,
      target,
    ) as Result[];
    const count = (check[0]?.results?.[0] as { c?: number } | undefined)?.c ?? 0;
    if (count === 0) {
      console.warn(
        `WARNING: model "${opts.model}" requires ${provider} API key, but none is registered. Add it with: pnpm bot:set-key ${botId} ${provider}`,
      );
    }
  }

  console.log(`updated bot ${botId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
