const AUTH_URL = new URL(import.meta.env.VITE_AUTH_URL || location.origin);
const STORE = "bounce.session";
const events = new EventTarget();
let session = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
  if (saved?.token && saved.expiresAt > Date.now()) session = saved;
} catch {
}
const persist = () => {
  try {
    session ? sessionStorage.setItem(STORE, JSON.stringify(session)) : sessionStorage.removeItem(STORE);
  } catch {
  }
};
const changed = () => events.dispatchEvent(new CustomEvent("change", { detail: session?.user ?? null }));
const profiles =  new Map();
async function loadProfile(slackId) {
  if (profiles.has(slackId)) return profiles.get(slackId);
  let profile = null;
  try {
    const res = await fetch(`https://cachet.dunkirk.sh/users/${encodeURIComponent(slackId)}`, { signal: AbortSignal.timeout(4e3) });
    const data = res.ok ? await res.json() : null;
    if (data && res.status === 200 && typeof data.displayName === "string" && data.displayName) {
      profile = { name: data.displayName, image: /^https:\/\
    }
  } catch {
  }
  if (profile) profiles.set(slackId, profile);
  return profile;
}
export const auth = {
  loadProfile,
  async leaderboard(mode = 1) {
    const board = new URL("/api/leaderboard", AUTH_URL), mine = new URL("/api/leaderboard/me", AUTH_URL);
    board.searchParams.set("mode", mode);
    mine.searchParams.set("mode", mode);
    const [list, me] = await Promise.all([
      fetch(board),
      session ? fetch(mine, { headers: { Authorization: `Bearer ${session.token}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null
    ]);
    if (!list.ok) throw new Error("leaderboard-failed");
    return { ...await list.json(), me: me?.me ?? null };
  },
  events,
  get user() {
    return session?.user ?? null;
  },
  get signedIn() {
    return !!session;
  },
  signIn() {
    return new Promise((resolve, reject) => {
      const url = new URL("/auth/login", AUTH_URL);
      url.searchParams.set("origin", location.origin);
      const popup = window.open(url, "bounce-auth", "width=480,height=720");
      if (!popup) return reject(new Error("popup-blocked"));
      const finish = (fn, value) => {
        clearInterval(watch);
        removeEventListener("message", onMessage);
        fn(value);
      };
      const onMessage = (e) => {
        if (e.origin !== AUTH_URL.origin || e.source !== popup || e.data?.type !== "bounce-auth") return;
        if (e.data.error || typeof e.data.token !== "string") return finish(reject, new Error(e.data.error ?? "auth-failed"));
        session = { token: e.data.token, expiresAt: e.data.expiresAt, user: e.data.user };
        persist();
        changed();
        finish(resolve, session.user);
      };
      addEventListener("message", onMessage);
      const watch = setInterval(() => {
        if (popup.closed) finish(reject, new Error("cancelled"));
      }, 500);
    });
  },
  async signOut() {
    const token = session?.token;
    session = null;
    persist();
    changed();
    if (token) try {
      await fetch(new URL("/auth/logout", AUTH_URL), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch {
    }
  },
  async api(path, init = {}) {
    if (!session) throw new Error("signed-out");
    const res = await fetch(new URL(path, AUTH_URL), { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.token}` } });
    if (res.status === 401) {
      session = null;
      persist();
      changed();
      throw new Error("signed-out");
    }
    return res.json();
  }
};
