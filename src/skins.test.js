import test from "node:test";
import assert from "node:assert/strict";
import { SKINS, MILESTONES, RARITIES, reachedMilestones, pickSkin, parseEquipped, rarityOf, DUPLICATE_BONUS, MAX_PENDING_BONUS } from "./skins.js";

test("milestones map to rarities in order", () => {
  assert.deepEqual(MILESTONES.map((m) => m.threshold), [25, 50, 100, 250, 500]);
  assert.deepEqual(RARITIES, ["common", "uncommon", "rare", "epic", "legendary"]);
  assert.equal(rarityOf(100), "rare");
  assert.equal(rarityOf(99), null);
});

test("reachedMilestones", () => {
  assert.deepEqual(reachedMilestones(24), []);
  assert.deepEqual(reachedMilestones(25), [25]);
  assert.deepEqual(reachedMilestones(260), [25, 50, 100, 250]);
});

test("every rarity has a ball and a paddle skin, with unique ids", () => {
  assert.equal(new Set(SKINS.map((s) => s.id)).size, SKINS.length);
  for (const rarity of RARITIES) for (const slot of ["ball", "paddle"]) assert.ok(SKINS.some((s) => s.rarity === rarity && s.slot === slot), `${rarity} ${slot}`);
});

test("pickSkin prefers unowned skins and flags duplicates", () => {
  const pool = SKINS.filter((s) => s.rarity === "epic");
  const owned = new Set(pool.slice(1).map((s) => s.id));
  assert.deepEqual(pickSkin("epic", owned, () => 0.99), { skin: pool[0], duplicate: false });
  const all = new Set(pool.map((s) => s.id));
  assert.equal(pickSkin("epic", all).duplicate, true);
  assert.equal(pickSkin("mythic", all), null);
});

test("parseEquipped drops junk and wrong-slot ids", () => {
  assert.deepEqual(parseEquipped(null), { ball: null, paddle: null });
  assert.deepEqual(parseEquipped("nope"), { ball: null, paddle: null });
  assert.deepEqual(parseEquipped(JSON.stringify({ ball: "ball-ice", paddle: "ball-ice" })), { ball: "ball-ice", paddle: null });
});

test("duplicate bonus covers every rarity and can never reach the first milestone", () => {
  for (const r of RARITIES) assert.ok(Number.isInteger(DUPLICATE_BONUS[r]) && DUPLICATE_BONUS[r] > 0, r);
  assert.ok(MAX_PENDING_BONUS < MILESTONES[0].threshold);
  assert.ok(Math.max(...Object.values(DUPLICATE_BONUS)) <= MAX_PENDING_BONUS);
});
