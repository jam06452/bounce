export const PROFILE_URL = "https://cachet.dunkirk.sh/users/";
export const MAX_NAME_LENGTH = 100;

export function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  return name || null;
}

export async function fetchDisplayName(slackId, fetchFn = fetch) {
  try {
    const res = await fetchFn(PROFILE_URL + encodeURIComponent(slackId), { signal: AbortSignal.timeout(3e3) });
    if (res.status !== 200) return null;
    return cleanName((await res.json())?.displayName);
  } catch {
    return null;
  }
}

export async function refreshDisplayName(env, userId, slackId, fetchFn = fetch) {
  const name = await fetchDisplayName(slackId, fetchFn);
  if (name) await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, userId).run();
}
