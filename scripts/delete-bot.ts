import { getTarget, prompt, runWranglerSql, sqlQuote } from "./shared.ts";

async function main() {
  const target = getTarget(process.argv);
  const id = await prompt("Bot id to delete: ");
  if (!id) throw new Error("id required");
  const confirm = await prompt(`Delete ${id} from ${target}? (yes/no): `);
  if (confirm !== "yes") {
    console.log("aborted");
    return;
  }
  const sql = [
    `DELETE FROM messages WHERE bot_id = ${sqlQuote(id)};`,
    `DELETE FROM bot_platforms WHERE bot_id = ${sqlQuote(id)};`,
    `DELETE FROM bots WHERE id = ${sqlQuote(id)};`,
  ].join("\n");
  runWranglerSql(sql, target);
  console.log("deleted");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
