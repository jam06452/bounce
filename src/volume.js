const KEY = "bounce.volume";
export const CHANNELS = [
  { key: "music", label: "Music" },
  { key: "bounce", label: "Bounce" },
  { key: "woosh", label: "Woosh" },
  { key: "reveal", label: "Reveal chimes" },
  { key: "case", label: "Case opening" },
  { key: "gold", label: "Legendary (GOLD)" },
  { key: "nein", label: "Near miss (NEIN)" }
];
export const volume = Object.fromEntries(CHANNELS.map((c) => [c.key, 1]));
export const volumeEvents = new EventTarget();
// While a box is opening, only the case-opening sounds play; game effects are silenced.
export const caseOpen = { active: false };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
  for (const k of Object.keys(volume)) if (Number.isFinite(saved?.[k])) volume[k] = Math.min(1, Math.max(0, saved[k]));
  // Older builds saved one "sfx" slider; carry it over to the effect channels that don't have their own value yet.
  if (Number.isFinite(saved?.sfx)) for (const k of ["bounce", "woosh", "reveal", "case", "gold", "nein"]) if (!Number.isFinite(saved?.[k])) volume[k] = Math.min(1, Math.max(0, saved.sfx));
} catch {
}
export function setVolume(kind, value) {
  if (!(kind in volume)) return;
  volume[kind] = Math.min(1, Math.max(0, Number(value) || 0));
  try {
    localStorage.setItem(KEY, JSON.stringify(volume));
  } catch {
  }
  volumeEvents.dispatchEvent(new Event("change"));
}
