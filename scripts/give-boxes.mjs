import { execFileSync } from "node:child_process";
import { MILESTONES } from "../src/skins.js";

const USAGE = `Usage: node scripts/give-boxes.mjs [--remote] [--dry] [--rarity common|uncommon|rare|epic|legendary] [--count N] (--all | SLACK_ID...)
  Default is the local database; pass --remote for production.`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args.splice(i, 1).length ? true : null;
};
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const remote = flag("--remote"), dry = flag("--dry"), all = flag("--all");
const rarity = option("--rarity", "common"), count = Number(option("--count", "1"));
const ids = args;
const milestone = MILESTONES.find((m) => m.rarity === rarity);
if (!milestone || !Number.isInteger(count) || count < 1 || count > 100 || (!all && !ids.length) || (all && ids.length) || !ids.every((id) => /^[A-Z0-9]{3,32}$/.test(id))) {
  console.error(USAGE);
  process.exit(1);
}

const who = all ? "1 = 1" : `u.slack_id IN (${ids.map((id) => `'${id}'`).join(", ")})`;
const sql = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count}) INSERT INTO box_awards (user_id, threshold, awarded_at) SELECT u.id, ${milestone.threshold}, strftime('%s','now') * 1000 FROM users u, n WHERE ${who}`;
const wrangler = ["wrangler", "d1", "execute", "bounce", remote ? "--remote" : "--local", "--command", sql];

console.log(`${remote ? "REMOTE" : "local"}: ${count} ${rarity} box(es) each for ${all ? "ALL users" : ids.join(", ")}`);
if (dry) {
  console.log(sql);
  process.exit(0);
}
execFileSync("npx", wrangler, { stdio: "inherit" });
