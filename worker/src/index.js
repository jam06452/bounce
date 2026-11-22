import { handleAuth } from "./auth.js";
export { Feed } from "./feed.js";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const SIZES = [2, 4];
const ROOM_TTL_MS = 2 * 60 * 60 * 1e3;
const MAX_MESSAGE = 16 * 1024;
const RATE_WINDOW_MS = 5e3, RATE_MAX = 400;
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
async function turnCredentials(request, env) {
  const none = (reason) => Response.json({ iceServers: [], reason });
  const keyId = env.TURN_KEY_ID ?? env.TURN_TOKEN_ID;
  if (!keyId) return none("TURN_KEY_ID not set on this Worker");
  if (!env.TURN_KEY_API_TOKEN) return none("TURN_KEY_API_TOKEN not set on this Worker");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  if (allowed.length && origin && !allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 86400 })
    });
    if (!res.ok) return none(`Cloudflare replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Response(res.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return none(`fetch failed: ${e.message}`);
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/turn") return turnCredentials(request, env);
    const authResponse = await handleAuth(request, env, url, ctx);
    if (authResponse) return authResponse;
    if (url.pathname === "/feed") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const allowedFeed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (allowedFeed.length && !allowedFeed.includes(request.headers.get("Origin"))) return new Response("Forbidden", { status: 403 });
      return env.FEED.get(env.FEED.idFromName("global")).fetch(request);
    }
    if (url.pathname !== "/signal") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(request.headers.get("Origin"))) {
      console.warn("signal rejected: origin", request.headers.get("Origin"), "not in ALLOWED_ORIGINS", allowed.join(","));
      return new Response("Forbidden", { status: 403 });
    }
    let joining = url.searchParams.has("code");
    const asked = (url.searchParams.get("code") ?? "").trim().toUpperCase();
    let code = joining ? CODE_RE.test(asked) ? asked : "XXXX-invalid" : newCode();
    if (url.searchParams.has("quick")) {
      const size = Number(url.searchParams.get("quick"));
      if (!SIZES.includes(size)) return new Response("Bad request", { status: 400 });
      const stale = (url.searchParams.get("stale") ?? "").toUpperCase();
      const assigned = await env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global")).fetch(`https://matchmaker/assign?size=${size}&stale=${CODE_RE.test(stale) ? stale : ""}`).then((r) => r.json());
      code = assigned.code;
      joining = assigned.intent === "join";
    }
    const headers = new Headers(request.headers);
    headers.set("x-room-code", code);
    headers.set("x-intent", joining ? "join" : "create");
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(request, { headers }));
  }
};
export class Matchmaker {
  constructor() {
    this.open = new Map();
  }
  async fetch(request) {
    const url = new URL(request.url);
    const size = Number(url.searchParams.get("size")), stale = url.searchParams.get("stale");
    if (!SIZES.includes(size)) return new Response("Bad request", { status: 400 });
    let lobby = this.open.get(size);
    if (lobby && lobby.code === stale) lobby = null;
    if (lobby) {
      if (++lobby.seated >= size) this.open.delete(size);
      console.log(`matchmaker: size ${size} -> join ${lobby.code} (${lobby.seated}/${size})`);
      return Response.json({ code: lobby.code, intent: "join" });
    }
    const code = newCode();
    this.open.set(size, { code, seated: 1 });
    console.log(`matchmaker: size ${size} -> create ${code}${stale ? ` (dropped stale ${stale})` : ""}`);
    return Response.json({ code, intent: "create" });
  }
}
export class Room {
  constructor(state) {
    this.state = state;
    this.room = null;
    this.sockets =  new Set();
  }
  async fetch(request) {
    const intent = request.headers.get("x-intent"), code = request.headers.get("x-room-code");
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const peer = { ws: server, index: -1, joined: false, left: false, rate: { start: Date.now(), count: 0 } };
    this.sockets.add(server);
    server.addEventListener("message", (e) => this.onMessage(peer, e.data, intent, code));
    server.addEventListener("close", () => this.leave(peer));
    server.addEventListener("error", () => this.leave(peer));
    return new Response(null, { status: 101, webSocket: client });
  }
  send(peer, message) {
    if (peer?.ws.readyState === 1) peer.ws.send(JSON.stringify(message));
  }
  leave(peer) {
    if (peer.left) return;
    peer.left = true;
    this.sockets.delete(peer.ws);
    const room = this.room;
    if (!room || !peer.joined) return;
    room.members[peer.index] = null;
    const others = room.members.filter(Boolean);
    if (room.started) {
      if (!others.length) this.room = null;
    } else if (peer.index === 0) {
      this.room = null;
      for (const m of others) {
        m.joined = false;
        this.send(m, { type: "room-closed" });
      }
    } else for (const m of others) this.send(m, { type: "peer-left", index: peer.index });
  }
  async alarm() {
    for (const ws of this.sockets) ws.close(1e3, "room expired");
    this.room = null;
  }
  async onMessage(peer, raw, intent, code) {
    const now = Date.now();
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return peer.ws.close(1009, "message too big");
    if (now - peer.rate.start > RATE_WINDOW_MS) peer.rate = { start: now, count: 0 };
    if (++peer.rate.count > RATE_MAX) return peer.ws.close(1008, "rate limit");
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.send(peer, { type: "error", reason: "bad-message" });
    }
    if (!message || typeof message !== "object") return this.send(peer, { type: "error", reason: "bad-message" });
    if (message.type === "quick") message = intent === "create" ? { type: "create", size: message.size } : { type: "join" };
    switch (message.type) {
      case "create": {
        if (intent !== "create") return this.send(peer, { type: "error", reason: "bad-message" });
        if (peer.joined) return this.send(peer, { type: "error", reason: "already-in-room" });
        if (!SIZES.includes(message.size)) return this.send(peer, { type: "error", reason: "bad-message" });
        if (this.room) return this.send(peer, { type: "error", reason: "server-busy" });
        const members = Array(message.size).fill(null);
        members[0] = peer;
        this.room = { code, size: message.size, members, started: false };
        peer.index = 0;
        peer.joined = true;
        await this.state.storage.setAlarm(now + ROOM_TTL_MS);
        return this.send(peer, { type: "created", code, size: message.size, index: 0 });
      }
      case "join": {
        if (intent !== "join") return this.send(peer, { type: "error", reason: "bad-message" });
        if (peer.joined) return this.send(peer, { type: "error", reason: "already-in-room" });
        const room = this.room;
        if (!room) return this.send(peer, { type: "error", reason: "no-such-room", code });
        const seat = room.started ? -1 : room.members.indexOf(null);
        if (seat < 0) return this.send(peer, { type: "error", reason: "room-full", code });
        const peers = room.members.flatMap((m, i) => m ? [i] : []);
        room.members[seat] = peer;
        peer.index = seat;
        peer.joined = true;
        if (!room.members.includes(null)) room.started = true;
        this.send(peer, { type: "joined", code: room.code, size: room.size, index: seat, peers });
        for (const i of peers) this.send(room.members[i], { type: "peer-joined", index: seat });
        return;
      }
      case "signal": {
        const room = this.room;
        if (!room || !peer.joined || !message.data || typeof message.data !== "object") return;
        const target = Number.isInteger(message.to) ? room.members[message.to] : null;
        if (!target || target === peer) return;
        return this.send(target, { type: "signal", from: peer.index, data: message.data });
      }
      default:
        return this.send(peer, { type: "error", reason: "bad-message" });
    }
  }
}
