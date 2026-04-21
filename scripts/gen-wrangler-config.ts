import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEMPLATE_PATH = resolve(process.cwd(), "wrangler.toml.template");
const OUTPUT_PATH = resolve(process.cwd(), "wrangler.toml");

const REQUIRED_VARS = ["PROJECT_NAME", "CF_D1_DATABASE_ID", "CF_KV_PROFILE_CACHE_ID"] as const;

function render(template: string): string {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(
        `env var ${name} is not set. Copy .env.example to .env and fill it in, or export the variable.`,
      );
    }
    return value;
  });
}

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill it in, or export the variables in your shell.");
  process.exit(1);
}

const template = readFileSync(TEMPLATE_PATH, "utf-8");
const rendered = render(template);
writeFileSync(OUTPUT_PATH, rendered);
console.log(`wrote ${OUTPUT_PATH}`);
