import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchDisplayName } from "../worker/src/names.js";

const USAGE = "Usage: node scripts/backfill-names.mjs [--remote] [--dry]\n  Fills users.display_name for accounts that have none. Default is the local database.";
const args = process.argv.slice(2);
const remote = args.includes("--remote"), dry = args.includes("--dry");
if (args.some((a) => !["--remote", "--dry"].includes(a))) {
  console.error(USAGE);
  process.exit(1);
}

const target = remote ? "--remote" : "--local";
const run = (extra) => execFileSync("npx", ["wrangler", "d1", "execute", "bounce", target, ...extra], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const rows = JSON.parse(run(["--json", "--command", "SELECT id, slack_id FROM users WHERE display_name IS NULL AND slack_id IS NOT NULL"]).replace(/^[^[]*/, ""))[0].results;
console.log(`${remote ? "REMOTE" : "local"}: ${rows.length} user(s) without a display name`);

const updates = [];
for (const { id, slack_id } of rows) {
  const name = await fetchDisplayName(slack_id);
  console.log(`  ${slack_id} -> ${name ?? "(none found)"}`);
  if (name) updates.push(`UPDATE users SET display_name = '${name.replaceAll("'", "''")}' WHERE id = ${Number(id)} AND display_name IS NULL;`);
  await new Promise((r) => setTimeout(r, 150));
}

if (dry || !updates.length) {
  console.log(dry ? "Dry run, nothing written." : "Nothing to write.");
  process.exit(0);
}
const file = join(mkdtempSync(join(tmpdir(), "names-")), "names.sql");
writeFileSync(file, updates.join("\n"));
run(["--file", file]);
console.log(`Saved ${updates.length} name(s).`);
