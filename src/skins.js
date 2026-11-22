export const MILESTONES = [
  { threshold: 25, rarity: "common" },
  { threshold: 50, rarity: "uncommon" },
  { threshold: 100, rarity: "rare" },
  { threshold: 250, rarity: "epic" },
  { threshold: 500, rarity: "legendary" }
];
export const RARITIES = MILESTONES.map((m) => m.rarity);
export const DUPLICATE_BONUS = { common: 1, uncommon: 2, rare: 3, epic: 5, legendary: 10 };
export const MAX_PENDING_BONUS = MILESTONES[0].threshold - 1;
export const WELCOME_BOXES = { count: 5, threshold: MILESTONES[0].threshold };
export const DROP_TABLE = {
  common: { common: 1 },
  uncommon: { uncommon: 1 },
  rare: { rare: 1 },
  epic: { epic: 1 },
  legendary: { legendary: 30, epic: 40, rare: 30 }
};
export function rollRarity(boxRarity, random = Math.random) {
  const entries = Object.entries(DROP_TABLE[boxRarity] ?? {});
  if (!entries.length) return boxRarity;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [rarity, w] of entries) if ((r -= w) < 0) return rarity;
  return entries[entries.length - 1][0];
}
export const rarityOf = (threshold) => MILESTONES.find((m) => m.threshold === threshold)?.rarity ?? null;

export const SKINS = [
  { id: "ball-mint", slot: "ball", rarity: "common", name: "Mint", tint: 0xa8ffd0, trail: 0x8cf0c0 },
  { id: "ball-sky", slot: "ball", rarity: "common", name: "Sky", tint: 0x9fd4ff, trail: 0x7cc0ff },
  { id: "paddle-oak", slot: "paddle", rarity: "common", name: "Oak", tint: 0xd9b38c },
  { id: "paddle-moss", slot: "paddle", rarity: "common", name: "Moss", tint: 0xa4c98a },

  { id: "ball-sunset", slot: "ball", rarity: "uncommon", name: "Sunset", tint: 0xffb86b, trail: 0xff8f4d },
  { id: "ball-grape", slot: "ball", rarity: "uncommon", name: "Grape", tint: 0xc79bff, trail: 0xa874ff },
  { id: "paddle-birch", slot: "paddle", rarity: "uncommon", name: "Birch", tint: 0xf2ead8 },
  { id: "paddle-cherry", slot: "paddle", rarity: "uncommon", name: "Cherry", tint: 0xe0806f },

  { id: "ball-ice", slot: "ball", rarity: "rare", name: "Ice", tint: 0xc9f4ff, trail: 0x6ee0ff, glow: 0x6ee0ff },
  { id: "ball-ember", slot: "ball", rarity: "rare", name: "Ember", tint: 0xff9a5c, trail: 0xff4d2e, glow: 0xff4d2e },
  { id: "paddle-midnight", slot: "paddle", rarity: "rare", name: "Midnight", tint: 0x6f7bd9 },
  { id: "paddle-ivy", slot: "paddle", rarity: "rare", name: "Ivy", tint: 0x58c27a },

  { id: "ball-toxic", slot: "ball", rarity: "epic", name: "Toxic", tint: 0xb6ff3c, trail: 0x7cff00, glow: 0x7cff00 },
  { id: "ball-void", slot: "ball", rarity: "epic", name: "Void", tint: 0x8a5cff, trail: 0x4b1fd1, glow: 0x4b1fd1 },
  { id: "paddle-gilded", slot: "paddle", rarity: "epic", name: "Gilded", tint: 0xffd24d },
  { id: "paddle-obsidian", slot: "paddle", rarity: "epic", name: "Obsidian", tint: 0x3b3550 },

  { id: "ball-prism", slot: "ball", rarity: "legendary", name: "Prism", rainbow: true, glow: 0xffffff },
  { id: "ball-supernova", slot: "ball", rarity: "legendary", name: "Supernova", tint: 0xfff4c2, trail: 0xffe066, glow: 0xffe066 },
  { id: "paddle-aurora", slot: "paddle", rarity: "legendary", name: "Aurora", rainbow: true },
  { id: "paddle-starlog", slot: "paddle", rarity: "legendary", name: "Starlog", tint: 0xfff4c2, glow: 0xffe066 }
];
export const skinById = (id) => SKINS.find((s) => s.id === id) ?? null;
export const SLOTS = ["ball", "paddle"];

export function parseEquipped(raw) {
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
  }
  const out = { ball: null, paddle: null };
  for (const slot of SLOTS) {
    const skin = skinById(value?.[slot]);
    if (skin?.slot === slot) out[slot] = skin.id;
  }
  return out;
}

export const reachedMilestones = (rally) => MILESTONES.filter((m) => rally >= m.threshold).map((m) => m.threshold);

export function pickSkin(rarity, owned, random = Math.random) {
  const pool = SKINS.filter((s) => s.rarity === rarity);
  if (!pool.length) return null;
  const fresh = pool.filter((s) => !owned.has(s.id));
  const from = fresh.length ? fresh : pool;
  return { skin: from[Math.min(from.length - 1, Math.floor(random() * from.length))], duplicate: !fresh.length };
}
