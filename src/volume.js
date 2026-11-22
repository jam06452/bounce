const KEY = "bounce.volume";
export const volume = { music: 1, sfx: 1 };
export const volumeEvents = new EventTarget();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
  for (const k of Object.keys(volume)) if (Number.isFinite(saved?.[k])) volume[k] = Math.min(1, Math.max(0, saved[k]));
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
