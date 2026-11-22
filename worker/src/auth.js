import * as oauth from "oauth4webapi";
import { rarityOf, pickSkin, parseEquipped, skinById, SLOTS, DUPLICATE_BONUS, MAX_PENDING_BONUS, WELCOME_BOXES } from "../../src/skins.js";
const ISSUER = new URL("https://auth.hackclub.com");
const SCOPE = "openid slack_id";
const SESSION_TTL_MS = 24 * 60 * 60 * 1e3;
const ATTEMPT_TTL_MS = 10 * 60 * 1e3;
let metadata;
const authServer = () => metadata ??= oauth.discoveryRequest(ISSUER).then((res) => oauth.processDiscoveryResponse(ISSUER, res)).catch((err) => {
  metadata = void 0;
  throw err;
});
const allowedOrigins = (env) => (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256hex = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
const inline = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
function cors(request, env, response) {
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.append("Vary", "Origin");
  }
  return response;
}
const json = (request, env, body, status = 200) => cors(request, env, Response.json(body, { status, headers: { "Cache-Control": "no-store" } }));
const handoff = (origin, payload, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><title>Signing in</title><p>You can close this window.</p>
<script>try{window.opener&&window.opener.postMessage(${inline({ type: "bounce-auth", ...payload })},${inline(origin)})}catch(e){}window.close()<\/script>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
);
function client(env) {
  return [{ client_id: env.HCA_CLIENT_ID }, oauth.ClientSecretPost(env.HCA_CLIENT_SECRET)];
}
async function login(request, env, url) {
  if (!env.HCA_CLIENT_ID || !env.HCA_CLIENT_SECRET) return new Response("Auth is not configured", { status: 500 });
  const origin = url.searchParams.get("origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return new Response("Forbidden origin", { status: 403 });
  const as = await authServer();
  const state = oauth.generateRandomState(), nonce = oauth.generateRandomNonce();
  const verifier = oauth.generateRandomCodeVerifier();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_attempts WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO auth_attempts (state, verifier, nonce, origin, expires_at) VALUES (?, ?, ?, ?, ?)").bind(state, verifier, nonce, origin, now + ATTEMPT_TTL_MS)
  ]);
  const target = new URL(as.authorization_endpoint);
  target.searchParams.set("client_id", env.HCA_CLIENT_ID);
  target.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", SCOPE);
  target.searchParams.set("state", state);
  target.searchParams.set("nonce", nonce);
  if (env.HCA_PKCE !== "off") {
    target.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(verifier));
    target.searchParams.set("code_challenge_method", "S256");
  }
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}
async function callback(request, env, url) {
  const state = url.searchParams.get("state");
  if (!state) return new Response("Missing state", { status: 400 });
  const attempt = await env.DB.prepare("DELETE FROM auth_attempts WHERE state = ? AND expires_at > ? RETURNING verifier, nonce, origin").bind(state, Date.now()).first();
  if (!attempt) return new Response("Sign-in expired or invalid. Close this window and try again.", { status: 400 });
  try {
    const as = await authServer();
    const [cl, clientAuth] = client(env);
    const params = oauth.validateAuthResponse(as, cl, url, state);
    const res = await oauth.authorizationCodeGrantRequest(
      as,
      cl,
      clientAuth,
      params,
      `${url.origin}/auth/callback`,
      env.HCA_PKCE === "off" ? oauth.nopkce : attempt.verifier
    );
    const tokens = await oauth.processAuthorizationCodeResponse(as, cl, res, { expectedNonce: attempt.nonce, requireIdToken: true });
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    let slackId = claims.slack_id;
    if (typeof slackId !== "string") {
      const info = await oauth.processUserInfoResponse(as, cl, claims.sub, await oauth.userInfoRequest(as, cl, tokens.access_token));
      slackId = info.slack_id;
    }
    if (typeof slackId !== "string" || !slackId || slackId.length > 64) return handoff(attempt.origin, { error: "no-slack-id" });
    const now = Date.now();
    const user = await env.DB.prepare(
      "INSERT INTO users (sub, slack_id, created_at, welcomed) VALUES (?, ?, ?, 0) ON CONFLICT(sub) DO UPDATE SET slack_id = excluded.slack_id RETURNING id, slack_id"
    ).bind(claims.sub, slackId, now).first();
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const copies = Array.from({ length: WELCOME_BOXES.count }, (_, i) => `SELECT ${i + 1}`).join(" UNION ALL ");
    const [welcome] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO box_awards (user_id, threshold, awarded_at) SELECT u.id, ?2, ?3 FROM users u, (${copies}) WHERE u.id = ?1 AND u.welcomed = 0`).bind(user.id, WELCOME_BOXES.threshold, now),
      env.DB.prepare("UPDATE users SET welcomed = 1 WHERE id = ? AND welcomed = 0").bind(user.id),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256hex(token), user.id, now + SESSION_TTL_MS)
    ]);
    return handoff(attempt.origin, { token, expiresAt: now + SESSION_TTL_MS, user: { slackId: user.slack_id }, welcome: welcome.meta?.changes ?? 0 });
  } catch (err) {
    console.error("auth callback failed", err?.name, err?.message);
    return handoff(attempt.origin, { error: "auth-failed" });
  }
}
export async function authenticate(request, env) {
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get("Authorization") ?? "");
  if (!match) return null;
  const tokenHash = await sha256hex(match[1]);
  const user = await env.DB.prepare(
    "SELECT u.id, u.slack_id, u.equipped, u.pending_bonus FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(tokenHash, Date.now()).first();
  return user ? { ...user, tokenHash } : null;
}
const HISTORY_SIZE = 10;
async function me(request, env) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const [boxes, skins, scores, history] = await env.DB.batch([
    env.DB.prepare("SELECT id, threshold FROM box_awards WHERE user_id = ? AND opened_at IS NULL ORDER BY threshold, id").bind(user.id),
    env.DB.prepare("SELECT skin_id, seen FROM inventory WHERE user_id = ? ORDER BY acquired_at").bind(user.id),
    env.DB.prepare("SELECT mode, best_rally FROM scores WHERE user_id = ?").bind(user.id),
    env.DB.prepare("SELECT threshold, skin_id, duplicate, opened_at FROM box_awards WHERE user_id = ? AND opened_at IS NOT NULL ORDER BY opened_at DESC, id DESC LIMIT ?").bind(user.id, HISTORY_SIZE)
  ]);
  const known = skins.results.filter((r) => skinById(r.skin_id));
  const owned = known.map((r) => r.skin_id);
  const equipped = parseEquipped(user.equipped);
  for (const slot of SLOTS) if (!owned.includes(equipped[slot])) equipped[slot] = null;
  return json(request, env, {
    slackId: user.slack_id,
    equipped,
    bests: Object.fromEntries(scores.results.map((r) => [r.mode, r.best_rally])),
    boxes: boxes.results.map((r) => ({ id: r.id, threshold: r.threshold, rarity: rarityOf(r.threshold) })),
    skins: owned,
    fresh: known.filter((r) => !r.seen).map((r) => r.skin_id),
    bonus: Math.min(MAX_PENDING_BONUS, user.pending_bonus ?? 0),
    history: history.results.filter((r) => skinById(r.skin_id)).map((r) => ({ rarity: rarityOf(r.threshold), skin: r.skin_id, duplicate: !!r.duplicate, at: r.opened_at }))
  });
}
async function openBox(request, env) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (!Number.isInteger(id)) return json(request, env, { error: "bad-box" }, 400);
  const box = await env.DB.prepare("SELECT threshold FROM box_awards WHERE id = ? AND user_id = ? AND opened_at IS NULL").bind(id, user.id).first();
  if (!box) return json(request, env, { error: "no-such-box" }, 404);
  const threshold = box.threshold, rarity = rarityOf(threshold);
  const { results } = await env.DB.prepare("SELECT skin_id FROM inventory WHERE user_id = ?").bind(user.id).all();
  const pick = pickSkin(rarity, new Set(results.map((r) => r.skin_id)));
  const now = Date.now();
  const [claimed] = await env.DB.batch([
    env.DB.prepare("UPDATE box_awards SET opened_at = ?, skin_id = ?, duplicate = ? WHERE id = ? AND user_id = ? AND opened_at IS NULL RETURNING id").bind(now, pick.skin.id, pick.duplicate ? 1 : 0, id, user.id),
    env.DB.prepare(
      "INSERT OR IGNORE INTO inventory (user_id, skin_id, acquired_at, seen) SELECT ?1, ?2, ?3, 0 WHERE EXISTS (SELECT 1 FROM box_awards WHERE id = ?4 AND user_id = ?1 AND skin_id = ?2 AND opened_at = ?3)"
    ).bind(user.id, pick.skin.id, now, id),
    env.DB.prepare(
      "UPDATE users SET pending_bonus = MIN(?1, pending_bonus + ?2) WHERE id = ?3 AND ?2 > 0 AND EXISTS (SELECT 1 FROM box_awards WHERE id = ?4 AND user_id = ?3 AND opened_at = ?5)"
    ).bind(MAX_PENDING_BONUS, pick.duplicate ? DUPLICATE_BONUS[rarity] ?? 0 : 0, user.id, id, now)
  ]);
  if (!claimed.results.length) return json(request, env, { error: "no-such-box" }, 404);
  return json(request, env, { id, threshold, rarity, skin: pick.skin.id, duplicate: pick.duplicate, bonus: pick.duplicate ? DUPLICATE_BONUS[rarity] ?? 0 : 0 });
}
async function earnBox(request, env) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const threshold = body?.threshold, rarity = rarityOf(threshold);
  if (!rarity) return json(request, env, { error: "bad-box" }, 400);
  const now = Date.now(), last = await env.DB.prepare("SELECT MAX(awarded_at) AS at FROM box_awards WHERE user_id = ? AND threshold = ?").bind(user.id, threshold).first();
  if (last?.at && now - last.at < MIN_EARN_GAP_MS) return json(request, env, { error: "too-fast" }, 429);
  if (Number.isInteger(body.upgrade)) {
    const up = await env.DB.prepare("UPDATE box_awards SET threshold = ?1, awarded_at = ?2 WHERE id = ?3 AND user_id = ?4 AND opened_at IS NULL AND threshold < ?1 RETURNING id").bind(threshold, now, body.upgrade, user.id).first();
    if (up) return json(request, env, { box: { id: up.id, threshold, rarity }, upgraded: true });
  }
  const { meta } = await env.DB.prepare("INSERT INTO box_awards (user_id, threshold, awarded_at) VALUES (?, ?, ?)").bind(user.id, threshold, now).run();
  return json(request, env, { box: { id: meta.last_row_id, threshold, rarity } });
}
async function claimBonus(request, env) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const n = Math.min(MAX_PENDING_BONUS, user.pending_bonus ?? 0);
  if (n <= 0) return json(request, env, { bonus: 0 });
  const won = await env.DB.prepare("UPDATE users SET pending_bonus = pending_bonus - ?1 WHERE id = ?2 AND pending_bonus >= ?1 RETURNING id").bind(n, user.id).first();
  return json(request, env, { bonus: won ? n : 0 });
}
async function markSeen(request, env) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  await env.DB.prepare("UPDATE inventory SET seen = 1 WHERE user_id = ? AND seen = 0").bind(user.id).run();
  return json(request, env, { ok: true });
}
async function equip(request, env) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const slot = body?.slot, id = body?.skin ?? null;
  if (!SLOTS.includes(slot) || id !== null && skinById(id)?.slot !== slot) return json(request, env, { error: "bad-skin" }, 400);
  if (id !== null) {
    const has = await env.DB.prepare("SELECT 1 AS ok FROM inventory WHERE user_id = ? AND skin_id = ?").bind(user.id, id).first();
    if (!has) return json(request, env, { error: "not-owned" }, 403);
  }
  const equipped = { ...parseEquipped(user.equipped), [slot]: id };
  await env.DB.prepare("UPDATE users SET equipped = ? WHERE id = ?").bind(JSON.stringify(equipped), user.id).run();
  return json(request, env, { equipped });
}
const MAX_RALLY = 9999;
const MIN_EARN_GAP_MS = 10 * 1e3;
const MODES = [1, 2, 4];
const BOARD_SIZE = 10;
const SLACK_ID = /^[A-Z0-9]{3,32}$/;
async function resolveTeam(env, user, mode, claimed) {
  const ids = [...new Set(Array.isArray(claimed) ? claimed : [user.slack_id])].sort();
  if (!ids.length || ids.length > mode || !ids.every((id) => typeof id === "string" && SLACK_ID.test(id)) || !ids.includes(user.slack_id)) return null;
  const { results } = await env.DB.prepare(`SELECT id, slack_id FROM users WHERE slack_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  return results.length === ids.length ? { key: ids.join(","), users: results } : null;
}
const UPSERT_BEST = (table, keys) => `INSERT INTO ${table} (${keys.join(", ")}, best_rally, best_at) VALUES (${keys.map(() => "?").join(", ")}, ?, ?)
  ON CONFLICT (${keys.join(", ")}) DO UPDATE SET
    best_at = CASE WHEN excluded.best_rally > best_rally THEN excluded.best_at ELSE best_at END,
    best_rally = MAX(best_rally, excluded.best_rally)
  RETURNING best_rally, best_at`;
async function score(request, env, ctx) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const { rally, mode, team } = body ?? {};
  if (!MODES.includes(mode) || !Number.isInteger(rally) || rally < 0 || rally > MAX_RALLY) return json(request, env, { error: "bad-score" }, 400);
  const now = Date.now();
  const statements = [env.DB.prepare(UPSERT_BEST("scores", ["user_id", "mode"])).bind(user.id, mode, rally, now)];
  let boardKey = user.slack_id;
  if (mode > 1) {
    const resolved = await resolveTeam(env, user, mode, team);
    if (!resolved) return json(request, env, { error: "bad-team" }, 400);
    boardKey = resolved.key;
    statements.push(
      env.DB.prepare(UPSERT_BEST("teams", ["mode", "team"])).bind(mode, resolved.key, rally, now),
      ...resolved.users.map((u) => env.DB.prepare("INSERT OR IGNORE INTO team_members (mode, team, user_id) VALUES (?, ?, ?)").bind(mode, resolved.key, u.id))
    );
  }
  const results = await env.DB.batch(statements);
  const entry = results[mode === 1 ? 0 : 1].results[0];
  if (rally > 0 && entry.best_at === now) ctx.waitUntil(refreshIfTop(env, mode, boardKey, entry.best_rally));
  return json(request, env, { mode, bestRally: results[0].results[0].best_rally });
}
async function queryBoard(env, mode) {
  const { results } = mode === 1 ? await env.DB.prepare(
    `SELECT u.slack_id AS team, s.best_rally FROM scores s JOIN users u ON u.id = s.user_id
       WHERE s.mode = 1 AND s.best_rally > 0 ORDER BY s.best_rally DESC, s.best_at ASC, u.slack_id ASC LIMIT ?`
  ).bind(BOARD_SIZE).all() : await env.DB.prepare(
    "SELECT team, best_rally FROM teams WHERE mode = ? AND best_rally > 0 ORDER BY best_rally DESC, best_at ASC, team ASC LIMIT ?"
  ).bind(mode, BOARD_SIZE).all();
  return results.map((r) => ({ members: r.team.split(","), rally: r.best_rally }));
}
async function refreshBoard(env, mode) {
  const entries = await queryBoard(env, mode);
  if (env.BOARD) await env.BOARD.put(`board:${mode}`, JSON.stringify(entries));
  return entries;
}
async function boardEntries(env, mode) {
  const cached = env.BOARD && await env.BOARD.get(`board:${mode}`, { type: "json", cacheTtl: 30 });
  return Array.isArray(cached) ? cached : refreshBoard(env, mode);
}
async function refreshIfTop(env, mode, boardKey, rally) {
  try {
    const ahead = mode === 1 ? await env.DB.prepare("SELECT COUNT(*) AS n FROM scores s JOIN users u ON u.id = s.user_id WHERE s.mode = 1 AND u.slack_id != ? AND s.best_rally >= ?").bind(boardKey, rally).first() : await env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE mode = ? AND team != ? AND best_rally >= ?").bind(mode, boardKey, rally).first();
    if (ahead.n < BOARD_SIZE) await refreshBoard(env, mode);
  } catch (err) {
    console.error("board refresh failed", mode, err?.message);
  }
}
const modeParam = (url) => {
  const mode = parseInt(url.searchParams.get("mode") ?? "1", 10);
  return MODES.includes(mode) ? mode : null;
};
async function leaderboard(request, env, url) {
  const mode = modeParam(url);
  if (!mode) return json(request, env, { error: "bad-mode" }, 400);
  const entries = (await boardEntries(env, mode)).map((e, i) => ({ rank: i + 1, ...e }));
  return json(request, env, { mode, entries });
}
async function myRank(request, env, url) {
  const user = await authenticate(request, env);
  if (!user) return json(request, env, { error: "unauthorized" }, 401);
  const mode = modeParam(url);
  if (!mode) return json(request, env, { error: "bad-mode" }, 400);
  const solo = mode === 1;
  const mine = solo ? await env.DB.prepare("SELECT ?3 AS team, best_rally, best_at FROM scores WHERE user_id = ?1 AND mode = ?2 AND best_rally > 0").bind(user.id, mode, user.slack_id).first() : await env.DB.prepare(
    `SELECT t.team, t.best_rally, t.best_at FROM team_members m JOIN teams t ON t.mode = m.mode AND t.team = m.team
       WHERE m.user_id = ? AND m.mode = ? AND t.best_rally > 0 ORDER BY t.best_rally DESC, t.best_at ASC, t.team ASC LIMIT 1`
  ).bind(user.id, mode).first();
  if (!mine) return json(request, env, { mode, me: null });
  const ahead = solo ? await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores s JOIN users u ON u.id = s.user_id WHERE s.mode = 1 AND (s.best_rally > ?1 OR (s.best_rally = ?1 AND (s.best_at < ?2 OR (s.best_at = ?2 AND u.slack_id < ?3))))`
  ).bind(mine.best_rally, mine.best_at, mine.team).first() : await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM teams WHERE mode = ?1 AND (best_rally > ?2 OR (best_rally = ?2 AND (best_at < ?3 OR (best_at = ?3 AND team < ?4))))`
  ).bind(mode, mine.best_rally, mine.best_at, mine.team).first();
  return json(request, env, { mode, me: { rank: ahead.n + 1, members: mine.team.split(","), rally: mine.best_rally } });
}
async function logout(request, env) {
  const user = await authenticate(request, env);
  if (user) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.tokenHash).run();
  return json(request, env, { ok: true });
}
export async function handleAuth(request, env, url, ctx) {
  const { pathname } = url;
  if (!pathname.startsWith("/auth/") && !pathname.startsWith("/api/")) return null;
  if (request.method === "OPTIONS") return cors(request, env, new Response(null, { status: 204 }));
  if (!env.DB) return new Response("Database is not configured", { status: 500 });
  try {
    if (pathname === "/auth/login" && request.method === "GET") return await login(request, env, url);
    if (pathname === "/auth/callback" && request.method === "GET") return await callback(request, env, url);
    if (pathname === "/auth/logout" && request.method === "POST") return await logout(request, env);
    if (pathname === "/api/me" && request.method === "GET") return await me(request, env);
    if (pathname === "/api/leaderboard" && request.method === "GET") return await leaderboard(request, env, url);
    if (pathname === "/api/leaderboard/me" && request.method === "GET") return await myRank(request, env, url);
    if (pathname === "/api/score" && request.method === "POST") return await score(request, env, ctx);
    if (pathname === "/api/box/earn" && request.method === "POST") return await earnBox(request, env);
    if (pathname === "/api/box/open" && request.method === "POST") return await openBox(request, env);
    if (pathname === "/api/bonus/claim" && request.method === "POST") return await claimBonus(request, env);
    if (pathname === "/api/skins/seen" && request.method === "POST") return await markSeen(request, env);
    if (pathname === "/api/equip" && request.method === "POST") return await equip(request, env);
  } catch (err) {
    console.error("auth route failed", pathname, err?.message);
    return json(request, env, { error: "server-error" }, 500);
  }
  return new Response("Not found", { status: 404 });
}
