import { spawnSync } from "node:child_process";
import { getProjectName } from "./shared.ts";

const [action, ...rest] = process.argv.slice(2);
const name = getProjectName();

function run(args: string[]): never {
  const r = spawnSync("pnpm", ["exec", "wrangler", ...args], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

switch (action) {
  case "create":
    run(["d1", "create", name]);
    break;
  case "migrate":
    run(["d1", "migrations", "apply", name, ...rest]);
    break;
  default:
    console.error(`usage: d1.ts create | migrate [--local|--remote]`);
    process.exit(1);
}
