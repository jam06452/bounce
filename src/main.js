import "./style.css";
import { HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { LandmarkFilter } from "./trackingFilter.js";
import bgUrl from "../assets/textures/bg.png";
import caseClipUrl from "../assets/audio/CaseOpen.mp3";
import goldClipUrl from "../assets/audio/GOLD GOLD GOLD.mp3";
import neinClipUrl from "../assets/audio/NEIN.mp3";
import ballUrl from "../assets/textures/ball.png";
import logUrl from "../assets/textures/log.png";
import { createGame, loadBest, saveBest, setEquippedSkins, setPendingBonus, setBonusClaimer, setMenuOpen, MODES } from "./game.js";
import { SKINS, SLOTS, MILESTONES, RARITIES, skinById } from "./skins.js";
import { volume, volumeEvents, setVolume, CHANNELS, caseOpen } from "./volume.js";
import { net } from "./net.js";
import { auth } from "./auth.js";
import { startFeed } from "./feed.js";
const base = import.meta.env.BASE_URL;
const PALM = [0, 5, 9, 13, 17];
const mean = (pts, idx) => idx.reduce((m, i) => ({ x: m.x + pts[i].x / idx.length, y: m.y + pts[i].y / idx.length, z: m.z + pts[i].z / idx.length }), { x: 0, y: 0, z: 0 });
document.querySelector("#app").innerHTML = `
<header><span>BACK TO THE BOUNCE</span><span>01 / HAND TRACKING</span></header>
<main><h1>Your hand is the controller.</h1><p>Two laptops. One game of catch. Start by getting your hand in frame.</p>
<button id="panel-toggle" aria-expanded="false" aria-controls="panel">Camera</button><button id="net-chip" aria-controls="menu">PLAY ONLINE</button>
<div id="menu" role="dialog" aria-label="Game menu">
  <div class="menu-card">
    <div class="menu-title">BACK TO<br>THE BOUNCE</div>

    <div class="host-row">
      <button id="net-quick2" class="primary">Quick match 2-player</button>
      <button id="net-quick4" class="primary">Quick match 4-player</button>
    </div>

    <div class="menu-or">or play with friends</div>
    <div class="host-row">
      <button id="net-host2">Host 2-player</button>
      <button id="net-host4">Host 4-player</button>
    </div>
    <div class="net-row">
      <input id="net-code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code">
      <button id="net-join">Join</button>
    </div>

    <div id="net-bigcode" hidden></div>
    <small id="net-status" role="status">Not connected</small>
    <button id="net-leave" hidden>Cancel</button>
    <button id="net-solo" class="link">Practice alone</button>

    <div class="auth-row">
      <div id="auth-who" hidden><img id="auth-pfp" alt="" width="40" height="40"><span id="auth-name"></span></div>
      <button id="locker-btn" hidden>Mystery boxes <b id="locker-count"></b></button>
      <button id="auth-btn">Sign in with Hack Club</button>
      <small id="auth-status" role="status"></small>
    </div>
  </div>
</div>
<div id="locker" role="dialog" aria-label="Mystery boxes and skins" hidden>
  <div class="locker-card">
    <button id="locker-close" aria-label="Close">\u00D7</button>
    <div class="lb-title">MYSTERY BOXES</div>
    <div id="locker-boxes"></div>
    <small id="locker-reveal" role="status"></small>
    <div id="locker-skins"></div>
    <div id="locker-history"></div>
    <small class="locker-hint">Reach a rally of ${MILESTONES.map((m) => m.threshold).join(", ")} to earn a box.</small>
  </div>
</div>
<div id="box-stage" role="dialog" aria-label="Opening mystery box" hidden>
  <header class="bx-head">
    <h2>Unlock Container</h2>
    <p class="bx-sub"></p>
    <p class="bx-info"><span aria-hidden="true">i</span>This container can only be opened once</p>
  </header>
  <div class="bx-flash"></div>
  <div class="bx-rays"></div>
  <div class="bx-sparks"></div>
  <div class="bx-view"><div class="bx-reel"></div><div class="bx-marker"></div></div>
  <div class="bx-result"><div class="bx-rarity"></div><div class="bx-name"></div><div class="bx-dupe"></div></div>
  <button id="bx-skip" hidden>Skip (Space)</button>
  <button id="bx-done" hidden>Close (Esc)</button>
</div>
<div id="feed" aria-live="polite"></div>
<div id="toast" role="status" hidden></div>
<aside id="lb" aria-label="Leaderboard">
  <div class="lb-title">LEADERBOARD</div>
  <div id="lb-modes" role="tablist" aria-label="Game mode">
    <button role="tab" data-mode="1" aria-selected="true">Solo</button>
    <button role="tab" data-mode="2" aria-selected="false">2 Player</button>
    <button role="tab" data-mode="4" aria-selected="false">4 Player</button>
  </div>
  <ol id="lb-list"></ol>
  <small id="lb-status" role="status"></small>
</aside>
<div class="workspace closed" id="panel" inert><section class="camera"><video autoplay muted playsinline></video><canvas></canvas><div class="placeholder"><span id="camera-message">Enable your webcam to start.</span><small id="camera-help">Use the Enable webcam button beside this preview.</small></div><span class="badge">LOCAL CAMERA \xB7 MIRRORED</span></section>
<aside><div class="status" role="status">Camera off</div><h2 id="gesture">No hand</h2><p id="hint">Keep one hand visible, with your palm facing the camera.</p><dl><div><dt>Tracking rate</dt><dd id="fps">\u2014</dd></div><div><dt>Inference time</dt><dd id="latency">\u2014</dd></div><div><dt>Palm position</dt><dd id="position">\u2014</dd></div></dl><button id="start">Enable webcam \u2197</button><button id="stop" disabled>Stop camera</button><button id="fullscreen">Fullscreen \u26F6</button><label><input id="overlay" type="checkbox" checked> Show landmarks</label><div id="vol-sliders"></div></aside></div>
<section class="court" id="court"></section>
<section class="instructions"><article><b>01 \xB7 MOVE</b><p>Move your hand to position the circular paddle.</p></article><article><b>02 \xB7 CATCH</b><p>Close your hand into a fist.</p></article><article><b>03 \xB7 BOUNCE</b><p>Open your hand and show your palm.</p></article></section><footer>Video stays on this laptop. Everything runs in your browser. Gesture controls are a prototype.</footer></main>`;
const $ = (s) => document.querySelector(s);
const video = $("video"), canvas = $(".camera canvas"), ctx = canvas.getContext("2d");
const drawing = new DrawingUtils(ctx);
const landmarkFilter = new LandmarkFilter();
const game = createGame("court");
let worker, workerReady, busy = false, stream, frame, running = false, paused = false, starting = false, generation = 0, lastVideoTime = -1, lastTime = 0, fistClosed = false;
let stableGesture = "neutral", pendingGesture = "neutral", pendingCount = 0, lastPalm = null, palmVelocity = { x: 0, y: 0 };
const GESTURE_FRAMES = 2, MAX_LEAD_MS = 50, MAX_LEAD_DISTANCE = 0.08;
const el = { overlay: $("#overlay"), latency: $("#latency"), fps: $("#fps"), position: $("#position"), gesture: $("#gesture") };
const status = (message) => {
  $(".status").textContent = message;
  if (!$(".placeholder").hidden) $("#camera-message").textContent = message;
};
function publish(state) {
  window.dispatchEvent(new CustomEvent("handinput", { detail: state }));
}
function reset() {
  fistClosed = false;
  landmarkFilter.reset();
  lastTime = 0;
  lastVideoTime = -1;
  stableGesture = pendingGesture = "neutral";
  pendingCount = 0;
  lastPalm = null;
  palmVelocity = { x: 0, y: 0 };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("#gesture").textContent = "No hand";
  for (const id of ["fps", "latency", "position"]) $(`#${id}`).textContent = "\u2014";
  publish({ tracked: false, timestamp: performance.now(), gesture: "none", position: null, fistClosed: false });
}
function stop() {
  generation++;
  running = false;
  starting = false;
  busy = false;
  cancelFrame();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  $(".placeholder").hidden = false;
  $("#camera-help").textContent = "Use Enable webcam to start or retry.";
  reset();
  status("Camera off");
  $("#start").disabled = false;
  $("#stop").disabled = true;
  $(".placeholder").hidden = false;
}
async function start() {
  if (starting || running) return;
  const session = ++generation;
  starting = true;
  $(".placeholder").hidden = false;
  $("#camera-help").textContent = "Allow camera access when your browser asks.";
  $("#start").disabled = true;
  $("#stop").disabled = false;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page on localhost or HTTPS to use the webcam.");
    status("Waiting for camera permission\u2026");
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { min: 30, ideal: 60 }, facingMode: "user" } });
    if (session !== generation) {
      acquired.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = acquired;
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0], cam = track.getSettings();
    console.info(`Camera "${track.label}": ${cam.width}x${cam.height} @ ${cam.frameRate} fps`);
    if (cam.frameRate && cam.frameRate < 45) console.warn("Camera is running below 45 fps; improve lighting for faster tracking.");
    stream.getVideoTracks()[0].addEventListener("ended", stop);
    await video.play();
    status("Loading hand model\u2026");
    $("#camera-help").textContent = "The first download may take a moment. Keep this tab open.";
    await (workerReady ??= startWorker());
    if (session !== generation) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    $(".camera").style.aspectRatio = `${canvas.width}/${canvas.height}`;
    $(".placeholder").hidden = true;
    running = true;
    starting = false;
    tick();
  } catch (error) {
    if (session !== generation) return;
    stop();
    status(error.name === "NotAllowedError" ? "Camera access denied. Allow camera access in your browser, then retry." : error.name === "NotFoundError" ? "No webcam found. Connect a camera and retry." : error.message);
  }
}
const hasFrameCallback = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
const scheduleFrame = () => {
  frame = hasFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
};
const cancelFrame = () => hasFrameCallback ? video.cancelVideoFrameCallback(frame) : cancelAnimationFrame(frame);
function startWorker() {
  worker = new Worker(new URL("./handWorker.js", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        worker.onmessage = onWorkerMessage;
        resolve();
      } else if (data.type === "error") {
        worker.terminate();
        worker = workerReady = null;
        reject(new Error(data.message));
      }
    };
    worker.onerror = (e) => {
      worker?.terminate();
      worker = workerReady = null;
      console.error("Hand worker error", e);
      reject(new Error(e.message ? `Hand tracking worker failed: ${e.message}` : "Hand tracking worker failed to load (see console)"));
    };
    worker.postMessage({ type: "init", base });
  });
}
function onWorkerMessage({ data }) {
  busy = false;
  if (!running || paused) return;
  if (data.type === "error") {
    stop();
    status(`Tracking stopped: ${data.message}. Try enabling the webcam again.`);
    return;
  }
  try {
    handleResult(data.result, data.captured);
  } catch (error) {
    stop();
    status(`Tracking stopped: ${error.message}. Try enabling the webcam again.`);
  }
}
function tick(_now, metadata) {
  if (!running || paused) return;
  if (!busy && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    busy = true;
    const now = performance.now();
    const captured = Number.isFinite(metadata?.captureTime) && metadata.captureTime <= now ? metadata.captureTime : now;
    const session = generation;
    createImageBitmap(video).then((bitmap) => {
      if (!running || session !== generation || !worker) {
        bitmap.close();
        busy = false;
        return;
      }
      worker.postMessage({ type: "frame", bitmap, timestamp: now, captured }, [bitmap]);
    }).catch((error) => {
      busy = false;
      if (running) {
        stop();
        status(`Tracking stopped: ${error.message}. Try enabling the webcam again.`);
      }
    });
  }
  scheduleFrame();
}
// Hand tracking is off while a box is opening: no frames go to the worker and no gestures are published.
function pauseTracking() {
  if (!running || paused) return;
  paused = true;
  cancelFrame();
  video.pause(); // the hidden camera feed still decodes and composites under the overlay
  reset();
  publish({ tracked: false, timestamp: performance.now(), gesture: "none", position: null, fistClosed: false });
}
function resumeTracking() {
  if (!paused) return;
  paused = false;
  if (running) {
    video.play().catch(() => {});
    tick();
  }
}
function handleResult(result, captured) {
  const now = performance.now(), elapsed = now - captured;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const filtered = landmarkFilter.update(result, captured / 1e3);
  const points = filtered.landmarks;
  if (!points) {
    reset();
    status("Looking for your hand\u2026");
  } else {
    status("Hand tracked");
    el.latency.textContent = `${elapsed.toFixed(0)} ms`;
    if (lastTime) el.fps.textContent = `${Math.round(1e3 / (now - lastTime))} fps`;
    lastTime = now;
    const world = filtered.worldLandmarks;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const fingerReach = [8, 12, 16, 20].map((i) => dist(world[i], world[0]) / Math.max(1e-4, dist(world[i - 2], world[0])));
    fistClosed = fingerReach.every((reach) => reach < (fistClosed ? 1.08 : 0.95));
    const extended = fingerReach.filter((reach) => reach > 1.15).length;
    const candidate = fistClosed ? "catch" : extended >= 3 ? "bounce" : "neutral";
    if (candidate === stableGesture) pendingCount = 0;
    else if (candidate === pendingGesture) {
      if (++pendingCount >= GESTURE_FRAMES) {
        stableGesture = candidate;
        pendingCount = 0;
      }
    } else {
      pendingGesture = candidate;
      pendingCount = 1;
    }
    const gesture = stableGesture;
    const stableFist = gesture === "catch";
    const palm = mean(points, PALM);
    const mirrored = { x: 1 - palm.x, y: palm.y };
    if (lastPalm && now > lastPalm.t) {
      const dt = (now - lastPalm.t) / 1e3, k = 0.5;
      palmVelocity.x += k * ((mirrored.x - lastPalm.x) / dt - palmVelocity.x);
      palmVelocity.y += k * ((mirrored.y - lastPalm.y) / dt - palmVelocity.y);
    }
    lastPalm = { ...mirrored, t: now };
    const lead = Math.min(elapsed, MAX_LEAD_MS) / 1e3;
    const clampLead = (v) => Math.max(-MAX_LEAD_DISTANCE, Math.min(MAX_LEAD_DISTANCE, v * lead));
    const position = { x: Math.min(1, Math.max(0, mirrored.x + clampLead(palmVelocity.x))), y: Math.min(1, Math.max(0, mirrored.y + clampLead(palmVelocity.y))) };
    el.gesture.textContent = { catch: "Catch \xB7 closed fist", bounce: "Bounce \xB7 open palm", neutral: "Ready \xB7 relax" }[gesture];
    el.position.textContent = `${position.x.toFixed(2)}, ${position.y.toFixed(2)}`;
    if (el.overlay.checked) {
      drawing.drawConnectors(points, HandLandmarker.HAND_CONNECTIONS, { color: "#b8d86b", lineWidth: 2 });
      drawing.drawLandmarks(points, { color: "#fff", radius: 3, lineWidth: 1 });
    }
    ctx.beginPath();
    ctx.arc(palm.x * canvas.width, palm.y * canvas.height, stableFist ? 20 : 35, 0, Math.PI * 2);
    ctx.strokeStyle = stableFist ? "#ffb86b" : "#b8d86b";
    ctx.lineWidth = 4;
    ctx.stroke();
    publish({ tracked: true, timestamp: now, gesture, position, fistClosed: stableFist });
  }
}
function setPanel(open) {
  $("#panel").classList.toggle("closed", !open);
  $("#panel").inert = !open;
  $("#panel-toggle").setAttribute("aria-expanded", String(open));
}
let rtt = null;
const NET_TEXT = {
  idle: () => "Not connected",
  connecting: () => "Connecting to server\u2026",
  negotiating: () => "Linking players\u2026",
  reconnecting: () => "Connection unstable\u2026",
  waiting: ({ players, size, role }) => role === "quick" && players === 1 ? `Looking for players\u2026 (${players} of ${size})` : `${players} of ${size} players here. Waiting for the rest\u2026`,
  connected: ({ index, size }) => `Connected \xB7 player ${index + 1} of ${size}${rtt === null ? "" : ` \xB7 ${rtt.toFixed(0)} ms`}`,
  error: ({ message }) => message ?? "Connection failed."
};
let netStatus = { state: "idle" }, menuOpen = true;
let lbLast = 0, lbLoading = false, lbMode = 1;
function renderNet() {
  const { state, code } = netStatus, busy2 = state !== "idle" && state !== "error";
  setMenuOpen(menuOpen);
  $("#menu").hidden = !menuOpen;
  $("#lb").classList.toggle("shown", menuOpen);
  if (menuOpen && Date.now() - lbLast > 3e4) refreshLeaderboard();
  $("#net-status").textContent = NET_TEXT[state](netStatus);
  $("#net-status").classList.toggle("bad", state === "error");
  $("#net-quick2").disabled = $("#net-quick4").disabled = $("#net-host2").disabled = $("#net-host4").disabled = $("#net-join").disabled = $("#net-code").disabled = busy2;
  $("#net-leave").hidden = !busy2;
  $("#net-solo").hidden = busy2;
  $("#net-bigcode").hidden = !(state === "waiting" && code);
  $("#net-bigcode").textContent = code ?? "";
  const chip = $("#net-chip");
  chip.textContent = state === "connected" ? `ONLINE \xB7 ${code}${rtt === null ? "" : ` \xB7 ${rtt.toFixed(0)} ms`}` : busy2 ? `ROOM ${code ?? "\u2026"}` : "PLAY ONLINE";
  chip.classList.toggle("live", state === "connected");
}
net.events.addEventListener("status", (e) => {
  netStatus = e.detail;
  if (netStatus.state !== "connected") rtt = null;
  if (netStatus.state === "connected") menuOpen = false;
  else if (netStatus.state === "error") menuOpen = true;
  renderNet();
});
$("#net-chip").addEventListener("click", () => {
  menuOpen = !menuOpen;
  renderNet();
});
$("#net-solo").addEventListener("click", () => {
  menuOpen = false;
  renderNet();
  window.dispatchEvent(new Event("bounce:restart"));
});
net.events.addEventListener("rtt", (e) => {
  rtt = rtt === null ? e.detail : rtt * 0.7 + e.detail * 0.3;
  renderNet();
});
$("#net-quick2").addEventListener("click", () => net.quick(2));
$("#net-quick4").addEventListener("click", () => net.quick(4));
$("#net-host2").addEventListener("click", () => net.host(2));
$("#net-host4").addEventListener("click", () => net.host(4));
$("#net-join").addEventListener("click", () => {
  const code = $("#net-code").value.trim().toUpperCase();
  if (code.length === 4) net.join(code);
});
$("#net-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
});
$("#net-leave").addEventListener("click", () => net.leave());
renderNet();
let loot = { boxes: [], skins: [], equipped: {}, fresh: [], history: [], bonus: 0 };
const RARITY_LABEL = (r) => r[0].toUpperCase() + r.slice(1);
function setLoot(next) {
  loot = { boxes: next.boxes ?? [], skins: next.skins ?? [], equipped: next.equipped ?? {}, fresh: next.fresh ?? [], history: next.history ?? [], bonus: next.bonus ?? 0 };
  setPendingBonus(loot.bonus);
  setEquippedSkins(loot.equipped);
  $("#locker-count").textContent = loot.boxes.length ? `(${loot.boxes.length})` : "";
  $("#locker-btn").classList.toggle("has-boxes", loot.boxes.length > 0);
  renderLocker();
}
function lootButton(text, rarity, onClick, pressed) {
  const b = document.createElement("button");
  b.textContent = text;
  if (rarity) b.dataset.rarity = rarity;
  if (pressed !== void 0) b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", onClick);
  return b;
}
function renderLocker() {
  const boxes = loot.boxes.map((box) => lootButton(`${RARITY_LABEL(box.rarity)} box`, box.rarity, () => openBox(box.id)));
  $("#locker-boxes").replaceChildren(...boxes.length ? boxes : [Object.assign(document.createElement("small"), { textContent: "No unopened boxes." })]);
  const groups = SLOTS.map((slot) => {
    const section = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = slot === "ball" ? "Ball" : "Paddle";
    const equipped = loot.equipped[slot] ?? null;
    const owned = SKINS.filter((sk) => sk.slot === slot && loot.skins.includes(sk.id));
    section.append(title, lootButton("Default", null, () => equipSkin(slot, null), equipped === null), ...owned.map((sk) => {
      const b = lootButton(sk.name, sk.rarity, () => equipSkin(slot, sk.id), equipped === sk.id);
      if (loot.fresh.includes(sk.id)) b.classList.add("is-new");
      return b;
    }));
    return section;
  });
  $("#locker-skins").replaceChildren(...groups);
  renderHistory();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)");
const ART = { ball: { url: ballUrl }, paddle: { url: logUrl } };
const artCache = new Map();
const hex = (n) => "#" + n.toString(16).padStart(6, "0");
// DEBUG: temporary. Lists frames where the reel's clock or speed jumps.
function reportReel(trace) {
  const rows = [];
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    const wallMs = b.wall - a.wall, clipMs = (b.at - a.at) * 1000, du = b.u - a.u;
    const prevDu = i > 1 ? a.u - trace[i - 2].u : du;
    const flags = [];
    if (wallMs > 20) flags.push("frame gap");
    if (Math.abs(clipMs - wallMs) > 5) flags.push("clock vs wall");
    if (Math.abs(du - prevDu) > 0.05) flags.push("speed jump");
    if (flags.length) rows.push({ clipT: +b.at.toFixed(3), u: +b.u.toFixed(2), wallMs: +wallMs.toFixed(1), clipMs: +clipMs.toFixed(1), du: +du.toFixed(3), prevDu: +prevDu.toFixed(3), flags: flags.join(", ") });
  }
  console.log(`reel frames: ${trace.length}, flagged: ${rows.length}`);
  console.table(rows.slice(0, 40));
}
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const loadArt = async () => {
  await Promise.all(Object.values(ART).map((a) => a.img ? 0 : new Promise((res) => {
    a.img = new Image();
    a.img.onload = a.img.onerror = res;
    a.img.src = a.url;
  })));
  // Build every skin's display art once up front, so opening a box doesn't stall while it's drawn.
  for (const sk of SKINS) if (!artCache.has(sk.id)) skinArt(sk);
};
function skinArt(skin) {
  if (artCache.has(skin.id)) return artImage(skin, artCache.get(skin.id));
  const { img } = ART[skin.slot];
  const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  if (skin.rainbow || skin.tint !== void 0) {
    g.globalCompositeOperation = "multiply";
    if (skin.rainbow) {
      const grad = skin.slot === "paddle" ? g.createLinearGradient(0, 0, w, 0) : g.createLinearGradient(0, 0, w, h);
      ["#ff6b6b", "#ffd24d", "#7fe08a", "#6fb4ff", "#c58bff"].forEach((col, i, all) => grad.addColorStop(i / (all.length - 1), col));
      g.fillStyle = grad;
    } else {
      g.fillStyle = hex(skin.tint);
    }
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(img, 0, 0);
  }
  // Keep a copy at roughly 2x its on-screen size, so reel tiles don't each hold a full-resolution texture.
  const dispW = skin.slot === "paddle" ? 240 : 150, k = Math.min(1, (dispW * 2) / w);
  const small = document.createElement("canvas");
  small.width = Math.round(w * k);
  small.height = Math.round(h * k);
  small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
  const url = small.toDataURL("image/png");
  artCache.set(skin.id, url);
  return artImage(skin, url);
}
// Every tile of a skin shares one cached image, so opening a box doesn't allocate a canvas per tile.
function artImage(skin, url) {
  const img = new Image();
  img.src = url;
  img.className = "bx-art";
  img.alt = "";
  img.dataset.slot = skin.slot;
  if (skin.glow) {
    img.dataset.glow = "";
    img.style.setProperty("--glow", hex(skin.glow));
  }
  return img;
}
const CLIP = {
  lead: 0.1,
  hit: 6.502,
  skipTo: 6.25,
  ticks: [0.249, 0.336, 0.411, 0.482, 0.551, 0.621, 0.691, 0.749, 0.865, 0.934, 1.021, 1.079, 1.139, 1.25, 1.336, 1.392, 1.464, 1.522, 1.591, 1.666, 1.726, 1.795, 1.878, 1.947, 2.034, 2.11, 2.179, 2.25, 2.318, 2.402, 2.47, 2.553, 2.716, 2.784, 2.843, 2.911, 3.017, 3.087, 3.182, 3.25, 3.344, 3.412, 3.576, 3.88, 4.158, 4.601, 5.264]
};
const REEL = { tile: 300, gap: 18, win: CLIP.ticks.length, len: CLIP.ticks.length + 9 };
const REEL_TILE = REEL.tile, REEL_GAP = REEL.gap, REEL_WIN = REEL.win, REEL_LEN = REEL.len;
function makeCurve(ts, us) {
  const n = ts.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    h[i] = ts[i + 1] - ts[i];
    d[i] = (us[i + 1] - us[i]) / h[i];
  }
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  return (t) => {
    if (t <= ts[0]) return us[0];
    if (t >= ts[n - 1]) return us[n - 1];
    let i = 0;
    while (ts[i + 1] < t) i++;
    const x = (t - ts[i]) / h[i], x2 = x * x, x3 = x2 * x;
    return (2 * x3 - 3 * x2 + 1) * us[i] + (x3 - 2 * x2 + x) * h[i] * m[i] + (-2 * x3 + 3 * x2) * us[i + 1] + (x3 - x2) * h[i] * m[i + 1];
  };
}
let audioCtx;
const ac = () => (audioCtx ??= new AudioContext());
function blip({ freq, end = freq, type = "sine", gain = 0.08, dur = 0.1, delay = 0 }) {
  try {
    const c = ac(), t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(end, t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, gain * volume.reveal), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {
  }
}
const sfx = {
  unlock() { try { ac().resume(); } catch {} },
  reveal(rarity) {
    const tier = RARITIES.indexOf(rarity);
    if (tier >= 3) {
      blip({ freq: 110, end: 40, type: "sine", gain: 0.3, dur: 0.7 });
      for (let i = 0; i < 6; i++) blip({ freq: 2000 + Math.random() * 2500, type: "sine", gain: 0.025, dur: 0.3, delay: 0.2 + i * 0.07 });
    }
    if (tier >= 4) {
      blip({ freq: 400, end: 2400, type: "sawtooth", gain: 0.04, dur: 0.9 });
      [1047, 1319, 1568, 2093].forEach((f, i) => blip({ freq: f, type: "triangle", gain: 0.06, dur: 0.9, delay: 0.3 + i * 0.12 }));
    }
  }
};
function reelTile(skin) {
  const t = document.createElement("div");
  t.className = "bx-tile";
  t.dataset.rarity = skin.rarity;
  t.append(skinArt(skin));
  return t;
}
function randomFiller() {
  const weights = { common: 50, uncommon: 25, rare: 14, epic: 8, legendary: 3 };
  let r = Math.random() * 100;
  for (const sk of SKINS.slice().sort(() => Math.random() - 0.5)) if ((r -= weights[sk.rarity] / SKINS.filter((x) => x.rarity === sk.rarity).length) <= 0) return sk;
  return SKINS[0];
}
const NEAR_MISS_CHANCE = 0.25;
const SLOWDOWN_TILES = 8;
const caseClip = { buf: null };
async function loadClip() {
  if (caseClip.buf !== null) return;
  try {
    const res = await fetch(caseClipUrl);
    caseClip.buf = await ac().decodeAudioData(await res.arrayBuffer());
  } catch {
    caseClip.buf = false;
  }
}
const stingers = { gold: { url: goldClipUrl, buf: null }, nein: { url: neinClipUrl, buf: null } };
async function loadStinger(s) {
  if (s.buf !== null) return;
  try {
    const res = await fetch(s.url);
    s.buf = await ac().decodeAudioData(await res.arrayBuffer());
  } catch {
    s.buf = false;
  }
}
function playStinger(name) {
  const buf = stingers[name].buf;
  if (!buf) return null;
  try {
    const c = ac(), gain = c.createGain(), src = c.createBufferSource();
    gain.gain.value = volume[name];
    gain.connect(c.destination);
    src.buffer = buf;
    src.connect(gain);
    src.start();
    return () => { try { src.stop(); } catch {} };
  } catch {
    return null;
  }
}
function createClip() {
  const buf = caseClip.buf, c = buf ? ac() : null;
  let src = null, gain = null, origin = 0, latency = 0;
  // The reel follows the wall clock: audioContext.currentTime advances in coarse steps, which made the reel stall and then jump.
  const wall = () => performance.now() / 1e3;
  const onVolume = () => { if (gain) gain.gain.value = volume.case; };
  const halt = (fade) => {
    if (!src) return;
    const old = src;
    src = null;
    if (fade) gain.gain.setTargetAtTime(0, c.currentTime, 0.06);
    try { old.stop(c.currentTime + (fade ? 0.35 : 0)); } catch {}
  };
  return {
    now: (ts) => (ts ?? performance.now()) / 1e3 - origin - latency,
    play(from = 0) {
      origin = wall() - from;
      latency = c ? c.outputLatency || c.baseLatency || 0 : 0;
      if (!c) return;
      halt(false);
      gain = c.createGain();
      gain.gain.value = volume.case;
      gain.connect(c.destination);
      src = c.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(0, from);
      volumeEvents.addEventListener("change", onVolume);
    },
    stop() {
      volumeEvents.removeEventListener("change", onVolume);
      halt(true);
    }
  };
}
function placeFlair(stage, view, rarity) {
  const tier = RARITIES.indexOf(rarity);
  const r = view.getBoundingClientRect(), at = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px`;
  const sparks = stage.querySelector(".bx-sparks"), rays = stage.querySelector(".bx-rays");
  sparks.style.cssText = rays.style.cssText = at;
  const count = tier >= 4 ? 48 : tier === 3 ? 30 : 0;
  sparks.replaceChildren(...Array.from({ length: count }, (_, i) => {
    const sp = document.createElement("i");
    const angle = i / count * Math.PI * 2 + Math.random() * 0.3, dist = 140 + Math.random() * 260;
    sp.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    sp.style.setProperty("--dy", `${Math.sin(angle) * dist * 0.7}px`);
    sp.style.setProperty("--d", `${Math.random() * 0.2}s`);
    return sp;
  }));
}
async function playBoxOpening(rarity, request) {
  const stage = $("#box-stage"), reel = stage.querySelector(".bx-reel"), done = $("#bx-done"), skipBtn = $("#bx-skip");
  let skipped = false, onSkip, clip, stopStinger, stopNein = null, neinPlayed = false;
  const skip = new Promise((r) => onSkip = r);
  const doSkip = () => { skipped = true; skipBtn.hidden = true; onSkip(); };
  skipBtn.addEventListener("click", doSkip, { once: true });
  const onKey = (e) => {
    if (![" ", "Enter", "Escape"].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (!skipBtn.hidden) doSkip();
    else if (!done.hidden) done.click();
  };
  window.addEventListener("keydown", onKey, true);
  const quick = REDUCED_MOTION.matches;
  sfx.unlock();
  const music = game.sound?.get("music");
  const pausedMusic = !!music?.isPlaying;
  if (pausedMusic) music.pause();
  caseOpen.active = true;
  // The court and side panels are covered by the overlay; hide them so the browser doesn't composite them every frame.
  const hidden = [$("#court"), document.querySelector("aside:not(#lb)"), $("#lb")].filter(Boolean);
  hidden.forEach((el) => el.style.visibility = "hidden");
  // The court keeps rendering under the overlay; pause it so the GPU is free for the reel.
  game.loop?.sleep();
  pauseTracking();
  for (const snd of game.sound?.sounds ?? []) if (/^(bounce|woosh)/.test(snd.key)) snd.stop();
  stage.style.backgroundImage = `url(${bgUrl})`;
  stage.dataset.phase = "wait";
  stage.dataset.rarity = rarity;
  stage.querySelector(".bx-sub").innerHTML = `Unlock <b>${RARITY_LABEL(rarity)} Mystery Box</b>`;
  reel.style.transition = "none";
  reel.style.transform = "translateX(0)";
  reel.replaceChildren();
  stage.hidden = false;
  try {
    const [res] = await Promise.all([request(), loadArt(), loadClip(), ...Object.values(stingers).map(loadStinger)]);
    const skin = skinById(res.skin);
    const legendaries = SKINS.filter((sk) => sk.rarity === "legendary");
    const bait = skin.rarity !== "legendary" && Math.random() < NEAR_MISS_CHANCE ? legendaries[Math.floor(Math.random() * legendaries.length)] : null;
    reel.replaceChildren(...Array.from({ length: REEL_LEN }, (_, i) => reelTile(i === REEL_WIN ? skin : i === REEL_WIN - 2 && bait ? bait : randomFiller())));
    const view = stage.querySelector(".bx-view");
    const step = REEL_TILE + REEL_GAP;
    const uEnd = REEL_WIN + 0.55 + Math.random() * 0.3;
    const curve = makeCurve([CLIP.lead, ...CLIP.ticks, CLIP.hit], [0.45, ...CLIP.ticks.map((_, i) => i + 1), uEnd]);
    const halfView = view.clientWidth / 2;
    const place = (u) => { reel.style.transform = `translateX(${halfView - u * step}px)`; };
    let lastTile = -1;
    const playNein = () => {
      if (neinPlayed || skin.rarity === "legendary") return;
      neinPlayed = true;
      stopNein = playStinger("nein");
    };
    const setCenter = (u) => {
      const tile = Math.floor(u);
      if (tile === lastTile) return;
      reel.children[lastTile]?.classList.remove("center");
      lastTile = tile;
      reel.children[tile]?.classList.add("center");
      // Passing a legendary during the final slowdown counts as a near miss.
      if (tile >= REEL_WIN - SLOWDOWN_TILES && tile < REEL_WIN && reel.children[tile]?.dataset.rarity === "legendary") playNein();
    };
    place(0.45);
    setCenter(0.45);
    // Let the new tiles paint before the reel clock starts, so the first paint isn't counted as lost spin time.
    await Promise.all([...reel.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
    if (!quick) await nextPaint();
    clip = createClip();
    if (!quick) clip.play(0);
    stage.dataset.phase = "unlock";
    skipBtn.hidden = false;
    skipBtn.focus();
    if (!quick) await new Promise((resolve) => {
      let spun = false, goldStarted = false;
      const trace = import.meta.env.DEV ? [] : null; // DEBUG: temporary, dev builds only
      const frame = (ts) => {
        const at = clip.now(ts);
        if (skipped || at >= CLIP.hit) {
          if (trace) reportReel(trace);
          return resolve();
        }
        if (!spun && at >= CLIP.lead) {
          spun = true;
          stage.dataset.phase = "spin";
        }
        const u = curve(at);
        // GOLD starts once the winning tile is on screen, and stops when the reel lands (below).
        if (!goldStarted && skin.rarity === "legendary" && !skipped && u >= REEL_WIN - halfView / step) {
          goldStarted = true;
          stopStinger = playStinger("gold");
        }
        if (trace) trace.push({ at, u, wall: ts ?? performance.now() });
        place(u);
        setCenter(u);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    skipBtn.hidden = true;
    stopStinger?.();
    stopStinger = null;
    place(uEnd);
    setCenter(uEnd);
    if (skipped || quick) {
      clip.play(CLIP.skipTo);
      await sleep((CLIP.hit - CLIP.skipTo) * 1e3);
    }
    reel.children[REEL_WIN].classList.add("won");
    stage.dataset.rarity = skin.rarity;
    placeFlair(stage, stage.querySelector(".bx-view"), skin.rarity);
    sfx.reveal(skin.rarity);
    // A near miss is any legendary tile still on screen when the reel stops, other than the winner.
    const onScreen = view.clientWidth / 2;
    const nearMiss = skin.rarity !== "legendary" && Array.from(reel.children).some((el, i) => i !== REEL_WIN && el.dataset.rarity === "legendary" && Math.abs(i - uEnd) * step < onScreen);
    if (nearMiss) playNein();
    stage.querySelector(".bx-rarity").textContent = `${RARITY_LABEL(skin.rarity)} ${skin.slot}`;
    stage.querySelector(".bx-name").textContent = skin.name;
    stage.querySelector(".bx-dupe").textContent = res.duplicate ? `You already had this one: +${res.bonus ?? 0} rally at the start of your next round` : "New skin!";
    stage.dataset.phase = "reveal";
    done.hidden = false;
    done.focus();
    await new Promise((r) => done.addEventListener("click", r, { once: true }));
    return res;
  } finally {
    caseOpen.active = false;
    hidden.forEach((el) => el.style.visibility = "");
    game.loop?.wake(true);
    resumeTracking();
    clip?.stop();
    stopStinger?.();
    stopNein?.();
    window.removeEventListener("keydown", onKey, true);
    skipBtn.removeEventListener("click", doSkip);
    skipBtn.hidden = true;
    if (pausedMusic) music.resume();
    stage.hidden = true;
    stage.dataset.phase = "";
    done.hidden = true;
  }
}
const timeAgo = (at) => {
  const m = Math.max(0, Math.floor((Date.now() - at) / 6e4));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};
function renderHistory() {
  const box = $("#locker-history");
  if (!loot.history.length) return box.replaceChildren();
  const title = Object.assign(document.createElement("h3"), { textContent: "Recent drops" });
  const rows = loot.history.map((h) => {
    const skin = skinById(h.skin), row = document.createElement("div");
    row.className = "hist-row";
    row.dataset.rarity = skin.rarity;
    const name = Object.assign(document.createElement("span"), { textContent: `${skin.name} ${skin.slot}` });
    const meta = Object.assign(document.createElement("small"), { textContent: `${h.duplicate ? "duplicate \u00B7 " : ""}${timeAgo(h.at)}` });
    row.append(name, meta);
    return row;
  });
  box.replaceChildren(title, ...rows);
}
async function openBox(id) {
  $("#locker-boxes").querySelectorAll("button").forEach((b) => b.disabled = true);
  const box = loot.boxes.find((b) => b.id === id);
  $("#locker-reveal").textContent = "";
  try {
    const res = await playBoxOpening(box?.rarity ?? "common", async () => {
      const r = await auth.api("/api/box/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (r.error) throw new Error(r.error);
      return r;
    });
    const skin = skinById(res.skin);
    $("#locker-reveal").textContent = `${RARITY_LABEL(res.rarity)} box: ${skin.name} ${skin.slot} skin${res.duplicate ? " (you already had it)" : "!"}`;
    $("#locker-reveal").dataset.rarity = skin.rarity;
  } catch (e) {
    if (e.message !== "signed-out") $("#locker-reveal").textContent = "Could not open that box. Try again.";
  }
  await refreshLoot();
}
async function equipSkin(slot, skin) {
  setLoot({ ...loot, equipped: { ...loot.equipped, [slot]: skin } });
  try {
    const res = await auth.api("/api/equip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot, skin }) });
    if (res.error) throw new Error(res.error);
  } catch {
    await refreshLoot();
  }
}
async function refreshLoot() {
  try {
    const me = await auth.api("/api/me");
    if (!me.error) setLoot(me);
    return me;
  } catch {
  }
}
const FEED_MAX = 4, FEED_MS = 6e3;
function showDrop(drop) {
  if (drop.slackId && drop.slackId === auth.user?.slackId) return;
  const skin = skinById(drop.skin);
  if (!skin) return;
  const item = document.createElement("div");
  item.className = "feed-item";
  item.dataset.rarity = skin.rarity;
  const who = Object.assign(document.createElement("b"), { textContent: typeof drop.name === "string" && drop.name ? drop.name.slice(0, 40) : "A player" });
  const what = Object.assign(document.createElement("span"), { textContent: skin.name });
  item.append(who, " unboxed ", what, ` (${skin.rarity} ${skin.slot})`);
  const feed = $("#feed");
  feed.append(item);
  while (feed.children.length > FEED_MAX) feed.firstElementChild.remove();
  setTimeout(() => item.remove(), FEED_MS);
}
startFeed(showDrop);
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").hidden = true, 6e3);
}
$("#locker-btn").addEventListener("click", () => {
  $("#locker").hidden = false;
  $("#locker-reveal").textContent = "";
  refreshLoot();
});
function closeLocker() {
  if ($("#locker").hidden) return;
  $("#locker").hidden = true;
  if (!loot.fresh.length) return;
  loot.fresh = [];
  auth.api("/api/skins/seen", { method: "POST" }).catch(() => {});
}
$("#locker-close").addEventListener("click", closeLocker);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLocker();
});
const AUTH_ERRORS = {
  "popup-blocked": "Allow popups for this site, then try again.",
  "no-slack-id": "Hack Club Auth did not share your Slack ID."
};
function renderAuth(message) {
  const user = auth.user;
  $("#auth-btn").textContent = user ? "Sign out" : "Sign in with Hack Club";
  $("#auth-status").textContent = message ?? "";
  $("#auth-status").classList.toggle("bad", !!message);
  $("#auth-who").hidden = !user;
  $("#locker-btn").hidden = !user;
  if (!user) {
    setLoot({});
    $("#locker").hidden = true;
    return;
  }
  $("#auth-name").textContent = user.slackId;
  $("#auth-pfp").hidden = true;
  auth.loadProfile(user.slackId).then((p) => {
    if (auth.user?.slackId !== user.slackId || !p) return;
    $("#auth-name").textContent = p.name;
    if (p.image) {
      $("#auth-pfp").src = p.image;
      $("#auth-pfp").hidden = false;
    }
  });
}
auth.events.addEventListener("change", () => renderAuth());
$("#auth-btn").addEventListener("click", async () => {
  if (auth.signedIn) return auth.signOut();
  $("#auth-btn").disabled = true;
  try {
    const user = await auth.signIn();
    if (user.welcome > 0) {
      toast(`Welcome! You got ${user.welcome} free mystery boxes. Open them from "Mystery boxes".`);
      await refreshLoot();
    }
  } catch (e) {
    if (e.message !== "cancelled") renderAuth(AUTH_ERRORS[e.message] ?? "Sign-in failed. Try again.");
  } finally {
    $("#auth-btn").disabled = false;
  }
});
renderAuth();
function teamLabel(names) {
  if (names.length <= 2) return names.join(" & ");
  const rest = names.slice(2);
  return `${names.slice(0, 2).join(", ")}
${rest.length === 1 ? `& ${rest[0]}` : rest.join(" & ")}`;
}
function lbRow(entry, mine) {
  const li = document.createElement("li");
  if (mine) li.className = "me";
  const rank = document.createElement("span"), faces = document.createElement("span"), name = document.createElement("span"), score = document.createElement("b");
  rank.textContent = `#${entry.rank}`;
  rank.className = "lb-rank";
  faces.className = "lb-faces";
  name.className = "lb-name";
  score.textContent = entry.rally;
  const names = [...entry.members];
  name.textContent = teamLabel(names);
  entry.members.forEach((id, i) => {
    const pfp = document.createElement("img");
    pfp.alt = "";
    pfp.width = pfp.height = 28;
    pfp.hidden = true;
    faces.append(pfp);
    auth.loadProfile(id).then((p) => {
      if (!p) return;
      names[i] = p.name;
      name.textContent = teamLabel(names);
      if (p.image) {
        pfp.src = p.image;
        pfp.hidden = false;
      }
    });
  });
  li.append(rank, faces, name, score);
  return li;
}
async function refreshLeaderboard() {
  if (lbLoading) return;
  lbLoading = true;
  lbLast = Date.now();
  const mode = lbMode;
  if (!$("#lb-list").children.length) $("#lb-status").textContent = "Loading\u2026";
  try {
    const { entries, me } = await auth.leaderboard(mode);
    if (mode !== lbMode) {
      lbLoading = false;
      return refreshLeaderboard();
    }
    const mineId = auth.user?.slackId;
    const rows = entries.map((e) => lbRow(e, e.members.includes(mineId)));
    $("#lb-list").replaceChildren(...rows);
    const outside = me && !entries.some((e) => e.members.includes(mineId));
    $("#lb-status").textContent = !entries.length ? "No scores yet. Be the first." : outside ? `You: #${me.rank} \xB7 ${me.rally}` : "";
  } catch {
    lbLast = 0;
    $("#lb-status").textContent = "Could not load the leaderboard.";
  } finally {
    lbLoading = false;
  }
}
$("#lb-modes").addEventListener("click", (e) => {
  const mode = Number(e.target.closest("button")?.dataset.mode);
  if (!MODES.includes(mode) || mode === lbMode) return;
  lbMode = mode;
  for (const b of $("#lb-modes").children) b.setAttribute("aria-selected", String(Number(b.dataset.mode) === mode));
  $("#lb-list").replaceChildren();
  lbLast = 0;
  refreshLeaderboard();
});
const staleLeaderboard = () => {
  lbLast = 0;
  if (menuOpen) refreshLeaderboard();
};
auth.events.addEventListener("change", staleLeaderboard);
const SLACK_ID = /^[A-Z0-9]{3,32}$/;
const teammates =  new Map();
const announced =  new Set();
const currentTeam = () => auth.user ? [... new Set([auth.user.slackId, ...teammates.values()])].sort() : [];
function announce(to) {
  if (!auth.user || net.state !== "connected") return;
  net.send("events", { t: "who", slackId: auth.user.slackId }, to);
  for (let seat = 0; seat < net.size; seat++) if (seat !== net.index && (to === void 0 || to === seat)) announced.add(seat);
}
net.events.addEventListener("message", ({ detail: { channel, data, from } }) => {
  if (channel !== "events" || data?.t !== "who" || typeof data.slackId !== "string" || !SLACK_ID.test(data.slackId)) return;
  teammates.set(from, data.slackId);
  if (!announced.has(from)) announce(from);
});
net.events.addEventListener("status", (e) => {
  if (e.detail.state === "connected") announce();
  else {
    teammates.clear();
    announced.clear();
  }
});
auth.events.addEventListener("change", () => {
  announced.clear();
  announce();
});
const pendingBest =  new Map();
let flushTimer = null;
function flushBest(keepalive = false) {
  clearTimeout(flushTimer);
  if (!auth.signedIn) return;
  for (const [key, pending] of pendingBest) {
    pendingBest.delete(key);
    const { mode, rally } = pending;
    const body = { mode, rally, ...mode > 1 && { team: pending.team ?? currentTeam() } };
    auth.api("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive }).then(staleLeaderboard, () => {
      if (!pendingBest.has(key)) pendingBest.set(key, pending);
    });
  }
}
window.addEventListener("bounce:best", ({ detail: { mode, rally } }) => {
  const team = mode > 1 && auth.signedIn ? currentTeam() : null;
  pendingBest.set(`${mode}:${team ?? ""}`, { mode, rally, team });
  if (!auth.signedIn) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushBest, 2e3);
});
window.addEventListener("pagehide", () => flushBest(true));
let boxChain = Promise.resolve(), rallyBox = null;
setBonusClaimer(async () => {
  if (!auth.signedIn) return 0;
  const res = await auth.api("/api/bonus/claim", { method: "POST" });
  loot.bonus = 0;
  return res.bonus ?? 0;
});
$("#vol-sliders").replaceChildren(...CHANNELS.map(({ key, label }) => {
  const row = document.createElement("label");
  row.className = "vol";
  row.append(label, Object.assign(document.createElement("input"), { id: `vol-${key}`, type: "range", min: 0, max: 100, step: 1, value: Math.round(volume[key] * 100) }));
  row.lastChild.addEventListener("input", () => setVolume(key, row.lastChild.value / 100));
  return row;
}));
window.addEventListener("bounce:bonus", ({ detail: { bonus } }) => toast(`Duplicate bonus: +${bonus} rally`));
window.addEventListener("bounce:rallyend", () => {
  boxChain = boxChain.then(() => {
    rallyBox = null;
  });
});
window.addEventListener("bounce:milestone", ({ detail: { threshold } }) => {
  if (!auth.signedIn) return toast("Sign in to earn mystery boxes");
  boxChain = boxChain.then(async () => {
    const upgrade = rallyBox?.threshold < threshold ? rallyBox.id : void 0;
    const send = () => auth.api("/api/box/earn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threshold, upgrade }) });
    try {
      let res;
      try {
        res = await send();
      } catch (e) {
        if (e.message === "signed-out") throw e;
        res = await send();
      }
      if (!res.box) throw new Error(res.error ?? "failed");
      rallyBox = res.box;
      toast(res.upgraded ? `Your mystery box upgraded to ${res.box.rarity}!` : `You earned a ${res.box.rarity} mystery box!`);
      refreshLoot();
    } catch (e) {
      if (e.message !== "signed-out") toast("Could not award your mystery box");
    }
  });
});
async function syncBest() {
  try {
    const me = await auth.api("/api/me");
    if (me.error) return;
    setLoot(me);
    const { bests = {} } = me;
    for (const mode of MODES) {
      const remote = bests[mode] ?? 0, local = loadBest(mode);
      if (remote > local) {
        saveBest(mode, remote);
        window.dispatchEvent(new CustomEvent("bounce:setbest", { detail: { mode, rally: remote } }));
      } else if (local > remote && mode === 1) pendingBest.set("1:", { mode, rally: local, team: null });
    }
    flushBest();
  } catch {
  }
}
auth.events.addEventListener("change", () => {
  if (auth.signedIn) syncBest();
});
if (auth.signedIn) syncBest();
$("#panel-toggle").addEventListener("click", () => setPanel($("#panel").classList.contains("closed")));
$("#start").addEventListener("click", start);
$("#stop").addEventListener("click", stop);
const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
$("#fullscreen").addEventListener("click", toggleFullscreen);
window.addEventListener("keydown", (e) => {
  if (e.key === "f" && !e.metaKey && !e.ctrlKey) toggleFullscreen();
});
window.addEventListener("pagehide", stop);
if (import.meta.hot) import.meta.hot.dispose(() => {
  stop();
  worker?.postMessage({ type: "close" });
  worker?.terminate();
  game.destroy(true);
  window.removeEventListener("pagehide", stop);
});
start().then(() => {
  if (!running) setPanel(true);
});
const leafUrls = Object.values(import.meta.glob("../assets/leaves/*.png", { eager: true, query: "?url", import: "default" }));
const notes = document.createElement("div");
notes.id = "notes";
document.body.appendChild(notes);
function makenote() {
  if (document.hidden || !leafUrls.length) return;
  const note = document.createElement("img");
  note.classList.add("note");
  note.alt = "";
  note.src = leafUrls[Math.floor(Math.random() * leafUrls.length)];
  note.style.left = Math.random() * 100 + "%";
  note.style.width = 25 + Math.random() * 25 + "px";
  note.style.animationDuration = 8 + Math.random() * 8 + "s";
  note.style.setProperty("--rotation", (360 + Math.random() * 720) * (Math.random() < 0.5 ? -1 : 1) + "deg");
  note.style.setProperty("--sway", (20 + Math.random() * 50) * (Math.random() < 0.5 ? -1 : 1) + "px");
  notes.appendChild(note);
  note.addEventListener("animationend", () => note.remove());
}
for (let i = 0; i < 6; i++) setTimeout(makenote, i * 400);
setInterval(makenote, 1e3);
