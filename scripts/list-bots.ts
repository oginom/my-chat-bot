import { getTarget, runWranglerSqlJson } from "./shared.ts";

interface Result {
  results: {
    id: string;
    name: string;
    provider: string;
    model: string;
    created_at: number;
  }[];
}

async function main() {
  const target = getTarget(process.argv);
  const out = runWranglerSqlJson(
    "SELECT id, name, provider, model, created_at FROM bots ORDER BY created_at DESC;",
    target,
  ) as Result[];
  const rows = out[0]?.results ?? [];
  if (rows.length === 0) {
    console.log("(no bots)");
    return;
  }
  for (const r of rows) {
    console.log(`${r.id}  ${r.name}  [${r.provider}:${r.model}]  ${new Date(r.created_at).toISOString()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
