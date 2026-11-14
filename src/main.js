import './style.css'
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision'
import { LandmarkFilter } from './trackingFilter.js'
import { createGame } from './game.js'
import { net } from './net.js'
// Everything is served from this app (public/), so tracking needs no external requests.
// public/mediapipe/ must match the pinned @mediapipe/tasks-vision version; re-copy
// node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.* there if you upgrade it
// (the *_module_* variant is only used with forVisionTasks(path, true), so it is not copied).
const base = import.meta.env.BASE_URL
const PALM = [0, 5, 9, 13, 17]
const mean = (pts, idx) => idx.reduce((m, i) => ({ x: m.x + pts[i].x / idx.length, y: m.y + pts[i].y / idx.length, z: m.z + pts[i].z / idx.length }), { x: 0, y: 0, z: 0 })


document.querySelector('#app').innerHTML = `
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
  </div>
</div>
<div class="workspace closed" id="panel" inert><section class="camera"><video autoplay muted playsinline></video><canvas></canvas><div class="placeholder"><span id="camera-message">Enable your webcam to start.</span><small id="camera-help">Use the Enable webcam button beside this preview.</small></div><span class="badge">LOCAL CAMERA · MIRRORED</span></section>
<aside><div class="status" role="status">Camera off</div><h2 id="gesture">No hand</h2><p id="hint">Keep one hand visible, with your palm facing the camera.</p><dl><div><dt>Tracking rate</dt><dd id="fps">—</dd></div><div><dt>Inference time</dt><dd id="latency">—</dd></div><div><dt>Palm position</dt><dd id="position">—</dd></div></dl><button id="start">Enable webcam ↗</button><button id="stop" disabled>Stop camera</button><button id="fullscreen">Fullscreen ⛶</button><label><input id="overlay" type="checkbox" checked> Show landmarks</label></aside></div>
<section class="court" id="court"></section>
<section class="instructions"><article><b>01 · MOVE</b><p>Move your hand to position the circular paddle.</p></article><article><b>02 · CATCH</b><p>Close your hand into a fist.</p></article><article><b>03 · BOUNCE</b><p>Open your hand and show your palm.</p></article></section><footer>Video stays on this laptop. Everything runs in your browser. Gesture controls are a prototype.</footer></main>`
const $ = (s) => document.querySelector(s)
const video = $('video'), canvas = $('.camera canvas'), ctx = canvas.getContext('2d')
const drawing = new DrawingUtils(ctx)
const landmarkFilter = new LandmarkFilter()
const game = createGame('court')
let detector, stream, frame, running = false, starting = false, generation = 0, lastVideoTime = -1, lastTime = 0, fistClosed = false
const status = (message) => {
  $('.status').textContent = message
  if (!$('.placeholder').hidden) $('#camera-message').textContent = message
}

// Consumers (Phaser / future WebRTC) can subscribe without coupling to the camera UI.
function publish(state) { window.dispatchEvent(new CustomEvent('handinput', { detail: state })) }
function reset() {
  fistClosed = false; landmarkFilter.reset(); lastTime = 0; lastVideoTime = -1
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  $('#gesture').textContent = 'No hand'
  for (const id of ['fps', 'latency', 'position']) $(`#${id}`).textContent = '—'
  publish({ tracked: false, timestamp: performance.now(), gesture: 'none', position: null, fistClosed: false })
}
function stop() {
  generation++; running = false; starting = false
  cancelFrame()
  stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null
  $('.placeholder').hidden = false; $('#camera-help').textContent = 'Use Enable webcam to start or retry.'
  reset(); status('Camera off'); $('#start').disabled = false; $('#stop').disabled = true
  $('.placeholder').hidden = false
}
async function start() {
  if (starting || running) return
  const session = ++generation
  starting = true; $('.placeholder').hidden = false; $('#camera-help').textContent = 'Allow camera access when your browser asks.'; $('#start').disabled = true; $('#stop').disabled = false
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open this page on localhost or HTTPS to use the webcam.')
    status('Waiting for camera permission…')
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' } })
    if (session !== generation) { acquired.getTracks().forEach(t => t.stop()); return }
    stream = acquired; video.srcObject = stream
    const track = stream.getVideoTracks()[0], cam = track.getSettings()
    console.info(`Camera "${track.label}": ${cam.width}x${cam.height} @ ${cam.frameRate} fps`)
    stream.getVideoTracks()[0].addEventListener('ended', stop)
    await video.play()
    status('Loading hand model…'); $('#camera-help').textContent = 'The first download may take a moment. Keep this tab open.'
    if (!detector) {
      const files = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
      const options = { baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1 }
      try { detector = await HandLandmarker.createFromOptions(files, options) }
      catch { options.baseOptions.delegate = 'CPU'; detector = await HandLandmarker.createFromOptions(files, options) }
    }
    if (session !== generation) return
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    $('.camera').style.aspectRatio = `${canvas.width}/${canvas.height}`
    $('.placeholder').hidden = true; running = true; starting = false; tick()
  } catch (error) {
    if (session !== generation) return
    stop(); status(error.name === 'NotAllowedError' ? 'Camera access denied. Allow camera access in your browser, then retry.' : error.name === 'NotFoundError' ? 'No webcam found. Connect a camera and retry.' : error.message)
  }
}
// Run detection the moment the camera delivers a frame instead of polling on
// the next display refresh (saves up to one refresh of delay).
const hasFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype
const scheduleFrame = () => { frame = hasFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick) }
const cancelFrame = () => hasFrameCallback ? video.cancelVideoFrameCallback(frame) : cancelAnimationFrame(frame)
function tick() {
  if (!running) return
  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime
      const now = performance.now(), result = detector.detectForVideo(video, now), elapsed = performance.now() - now
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const filtered = landmarkFilter.update(result, now / 1000)
      const points = filtered.landmarks
      if (!points) { reset(); status('Looking for your hand…') }
      else {
        status('Hand tracked'); $('#latency').textContent = `${elapsed.toFixed(0)} ms`
        if (lastTime) $('#fps').textContent = `${Math.round(1000 / (now - lastTime))} fps`
        lastTime = now
        const dist = (a, b) => Math.hypot((a.x-b.x)*canvas.width, (a.y-b.y)*canvas.height)
        // All four fingers must fold toward the palm. Ignore the thumb so a
        // thumb/index pinch cannot trigger catch. Hysteresis reduces flicker.
        const fingerReach = [8,12,16,20].map(i =>
          dist(points[i], points[0]) / Math.max(1, dist(points[i-2], points[0])))
        fistClosed = fingerReach.every(reach => reach < (fistClosed ? 1.08 : 0.95))
        const extended = fingerReach.filter(reach => reach > 1.15).length
        const gesture = fistClosed ? 'catch' : extended >= 3 ? 'bounce' : 'neutral'
        const palm = mean(points, PALM)
        const position = { x:1-palm.x, y:palm.y }
        $('#gesture').textContent = {catch:'Catch · closed fist',bounce:'Bounce · open palm',neutral:'Ready · relax'}[gesture]
        $('#position').textContent = `${position.x.toFixed(2)}, ${position.y.toFixed(2)}`
        if ($('#overlay').checked) { drawing.drawConnectors(points, HandLandmarker.HAND_CONNECTIONS, {color:'#b8d86b',lineWidth:2}); drawing.drawLandmarks(points,{color:'#fff',radius:3,lineWidth:1}) }
        ctx.beginPath(); ctx.arc(palm.x*canvas.width,palm.y*canvas.height, fistClosed ? 20 : 35,0,Math.PI*2)
        ctx.strokeStyle = fistClosed ? '#ffb86b' : '#b8d86b'; ctx.lineWidth = 4; ctx.stroke()
        publish({tracked:true,timestamp:now,gesture,position,fistClosed})
      }
    }
    scheduleFrame()
  } catch (error) { stop(); status(`Tracking stopped: ${error.message}. Try enabling the webcam again.`) }
}
// The panel is hidden by default but stays rendered (just invisible) so the
// video keeps producing frames for tracking.
function setPanel(open) {
  $('#panel').classList.toggle('closed', !open); $('#panel').inert = !open
  $('#panel-toggle').setAttribute('aria-expanded', String(open))
}
// --- online play ---------------------------------------------------------
let rtt = null
const NET_TEXT = {
  idle: () => 'Not connected', connecting: () => 'Connecting to server…',
  negotiating: () => 'Linking players…', reconnecting: () => 'Connection unstable…',
  waiting: ({ players, size }) => `${players} of ${size} players here. Waiting for the rest…`,
  connected: ({ index, size }) => `Connected · player ${index + 1} of ${size}${rtt === null ? '' : ` · ${rtt.toFixed(0)} ms`}`,
  error: ({ message }) => message ?? 'Connection failed.',
}
let netStatus = { state: 'idle' }, menuOpen = true // the menu is the start screen
function renderNet() {
  const { state, code } = netStatus, busy = state !== 'idle' && state !== 'error'
  $('#menu').hidden = !menuOpen
  $('#net-status').textContent = NET_TEXT[state](netStatus)
  $('#net-status').classList.toggle('bad', state === 'error')
  $('#net-host2').disabled = $('#net-host4').disabled = $('#net-join').disabled = $('#net-code').disabled = busy
  $('#net-leave').hidden = !busy
  $('#net-solo').hidden = busy
  $('#net-bigcode').hidden = !(state === 'waiting' && code)
  $('#net-bigcode').textContent = code ?? ''
  const chip = $('#net-chip')
  chip.textContent = state === 'connected' ? `ONLINE · ${code}${rtt === null ? '' : ` · ${rtt.toFixed(0)} ms`}`
    : busy ? `ROOM ${code ?? '…'}` : 'PLAY ONLINE'
  chip.classList.toggle('live', state === 'connected')
}
net.events.addEventListener('status', (e) => {
  netStatus = e.detail; if (netStatus.state !== 'connected') rtt = null
  if (netStatus.state === 'connected') menuOpen = false // linked: get out of the way and play
  else if (netStatus.state === 'error') menuOpen = true // show what went wrong
  renderNet()
})
$('#net-chip').addEventListener('click', () => { menuOpen = !menuOpen; renderNet() })
$('#net-solo').addEventListener('click', () => { menuOpen = false; renderNet() })
net.events.addEventListener('rtt', (e) => { rtt = rtt === null ? e.detail : rtt * 0.7 + e.detail * 0.3; renderNet() })
$('#net-host2').addEventListener('click', () => net.host(2))
$('#net-host4').addEventListener('click', () => net.host(4))
$('#net-join').addEventListener('click', () => { const code = $('#net-code').value.trim().toUpperCase(); if (code.length === 4) net.join(code) })
$('#net-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '') })
$('#net-code').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('#net-join').click() }) // typing 'f' must not toggle fullscreen
$('#net-leave').addEventListener('click', () => net.leave())
renderNet()

$('#panel-toggle').addEventListener('click', () => setPanel($('#panel').classList.contains('closed')))
$('#start').addEventListener('click', start)
$('#stop').addEventListener('click', stop)
const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()
$('#fullscreen').addEventListener('click', toggleFullscreen)
window.addEventListener('keydown', e => { if (e.key === 'f' && !e.metaKey && !e.ctrlKey) toggleFullscreen() })
window.addEventListener('pagehide', stop)
if (import.meta.hot) import.meta.hot.dispose(() => { stop(); detector?.close(); game.destroy(true); window.removeEventListener('pagehide',stop) })
// Start the camera on load. If it can't start (permission denied, no camera),
// open the panel so the error and the retry button are visible.
start().then(() => { if (!running) setPanel(true) })

// Falling leaves: decorative, drawn over the court but under the UI, never blocking clicks.
const leafUrls = Object.values(import.meta.glob('../assets/leaves/*.png', { eager: true, query: '?url', import: 'default' }))
const notes = document.createElement('div')
notes.id = 'notes'
document.body.appendChild(notes)
function makenote() {
  if (document.hidden || !leafUrls.length) return // animations pause in background tabs, so don't pile leaves up
  const note = document.createElement('img')
  note.classList.add('note')
  note.alt = ''
  note.src = leafUrls[Math.floor(Math.random() * leafUrls.length)]
  note.style.left = Math.random() * 100 + '%'
  note.style.width = (25 + Math.random() * 25) + 'px'
  note.style.animationDuration = (8 + Math.random() * 8) + 's'
  note.style.setProperty('--rotation', (360 + Math.random() * 720) * (Math.random() < 0.5 ? -1 : 1) + 'deg')
  note.style.setProperty('--sway', (20 + Math.random() * 50) * (Math.random() < 0.5 ? -1 : 1) + 'px')
  notes.appendChild(note)
  note.addEventListener('animationend', () => note.remove())
}
for (let i = 0; i < 6; i++) setTimeout(makenote, i * 400) // already some in the air at load
setInterval(makenote, 1000)
