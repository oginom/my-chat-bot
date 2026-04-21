import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";

export function getMasterKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    console.error("ENCRYPTION_KEY env var is required (base64, 32 bytes). Generate with: pnpm keygen");
    process.exit(1);
  }
  return key;
}

export function getProjectName(): string {
  const name = process.env.PROJECT_NAME;
  if (!name) {
    console.error("PROJECT_NAME env var is required. Set it in .env (copy from .env.example).");
    process.exit(1);
  }
  return name;
}

export function getTarget(argv: string[]): "local" | "remote" {
  if (argv.includes("--remote")) return "remote";
  return "local";
}

export function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function runWranglerSql(sql: string, target: "local" | "remote"): void {
  const dir = mkdtempSync(join(tmpdir(), "mcb-"));
  const file = join(dir, "stmt.sql");
  try {
    writeFileSync(file, sql);
    const flag = target === "remote" ? "--remote" : "--local";
    const result = spawnSync(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", getProjectName(), flag, `--file=${file}`],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`wrangler exited with status ${result.status}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runWranglerSqlJson(sql: string, target: "local" | "remote"): unknown {
  const flag = target === "remote" ? "--remote" : "--local";
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", getProjectName(), flag, "--json", `--command=${sql}`],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`wrangler exited with status ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
