import "./style.css";
import { HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { LandmarkFilter } from "./trackingFilter.js";
import { createGame, loadBest, saveBest, MODES } from "./game.js";
import { net } from "./net.js";
import { auth } from "./auth.js";
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
      <button id="net-host2" class="primary">Host 2-player</button>
      <button id="net-host4" class="primary">Host 4-player</button>
    </div>

    <div class="menu-or">or join a friend</div>
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
      <button id="auth-btn">Sign in with Hack Club</button>
      <small id="auth-status" role="status"></small>
    </div>
  </div>
</div>
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
<aside><div class="status" role="status">Camera off</div><h2 id="gesture">No hand</h2><p id="hint">Keep one hand visible, with your palm facing the camera.</p><dl><div><dt>Tracking rate</dt><dd id="fps">\u2014</dd></div><div><dt>Inference time</dt><dd id="latency">\u2014</dd></div><div><dt>Palm position</dt><dd id="position">\u2014</dd></div></dl><button id="start">Enable webcam \u2197</button><button id="stop" disabled>Stop camera</button><button id="fullscreen">Fullscreen \u26F6</button><label><input id="overlay" type="checkbox" checked> Show landmarks</label></aside></div>
<section class="court" id="court"></section>
<section class="instructions"><article><b>01 \xB7 MOVE</b><p>Move your hand to position the circular paddle.</p></article><article><b>02 \xB7 CATCH</b><p>Close your hand into a fist.</p></article><article><b>03 \xB7 BOUNCE</b><p>Open your hand and show your palm.</p></article></section><footer>Video stays on this laptop. Everything runs in your browser. Gesture controls are a prototype.</footer></main>`;
const $ = (s) => document.querySelector(s);
const video = $("video"), canvas = $(".camera canvas"), ctx = canvas.getContext("2d");
const drawing = new DrawingUtils(ctx);
const landmarkFilter = new LandmarkFilter();
const game = createGame("court");
let worker, workerReady, busy = false, stream, frame, running = false, starting = false, generation = 0, lastVideoTime = -1, lastTime = 0, fistClosed = false;
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
  if (!running) return;
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
  if (!running) return;
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
  waiting: ({ players, size }) => `${players} of ${size} players here. Waiting for the rest\u2026`,
  connected: ({ index, size }) => `Connected \xB7 player ${index + 1} of ${size}${rtt === null ? "" : ` \xB7 ${rtt.toFixed(0)} ms`}`,
  error: ({ message }) => message ?? "Connection failed."
};
let netStatus = { state: "idle" }, menuOpen = true;
let lbLast = 0, lbLoading = false, lbMode = 1;
function renderNet() {
  const { state, code } = netStatus, busy2 = state !== "idle" && state !== "error";
  $("#menu").hidden = !menuOpen;
  $("#lb").classList.toggle("shown", menuOpen);
  if (menuOpen && Date.now() - lbLast > 3e4) refreshLeaderboard();
  $("#net-status").textContent = NET_TEXT[state](netStatus);
  $("#net-status").classList.toggle("bad", state === "error");
  $("#net-host2").disabled = $("#net-host4").disabled = $("#net-join").disabled = $("#net-code").disabled = busy2;
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
});
net.events.addEventListener("rtt", (e) => {
  rtt = rtt === null ? e.detail : rtt * 0.7 + e.detail * 0.3;
  renderNet();
});
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
  if (!user) return;
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
    await auth.signIn();
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
async function syncBest() {
  try {
    const { bests = {} } = await auth.api("/api/me");
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
