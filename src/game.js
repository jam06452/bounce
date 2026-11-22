import Phaser from 'phaser'
import { net } from './net.js'
import ballUrl from '../assets/textures/ball.png'
import bgUrl from '../assets/textures/bg.png'
import logUrl from '../assets/textures/log.png'
import musicUrl from '../assets/audio/BBacking.wav'
import bounce1Url from '../assets/audio/Bounce1.wav'
import bounce2Url from '../assets/audio/Bounce2.wav'
import bounce3Url from '../assets/audio/Bounce3.wav'
import woosh1Url from '../assets/audio/Woosh1.wav'
import woosh2Url from '../assets/audio/Woosh2.wav'
import woosh3Url from '../assets/audio/Woosh3.wav'
import { exitTarget, entryState, predictExit } from './topology.js'

const WIDTH = 800, HEIGHT = 450
const RES = 2
const PADDLE = { length: 180, thickness: 24, hitPad: 12 }
const MAX_STEP = 6
const CATCH_ARC = Math.PI * 1.15
const CATCH_SPEED = 24
const SEGMENTS = 32

const BALL = { radius: 18, gravity: 700, onlineGravity: 300, wallBounce: 0.85, paddleBounce: 0.9, maxSpeed: 1400, bounceDamping: 0.9, returnBoost: 1.12, heatReturns: 8, trailMax: 28 }
const BEST_KEY = 'bounce.bestRally'
const loadBest = () => { try { return Math.max(0, parseInt(localStorage.getItem(BEST_KEY), 10) || 0) } catch { return 0 } }
const saveBest = (n) => { try { localStorage.setItem(BEST_KEY, String(n)) } catch {} }
const RETURN_GAP_MS = 350
const WARN_LEAD_MS = 1200
const CATCH_REACH = 60
const CUP_RADIUS = PADDLE.length / CATCH_ARC
const PADDLE_VELOCITY_SMOOTHING = 25
const LEAD_MS = 20, MAX_EXTRAPOLATE_MS = 50
const HAND_GAIN = 1.5

function paddlePoints(curl) {
  const angle = curl * CATCH_ARC
  const points = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const s = (i / SEGMENTS - 0.5) * PADDLE.length
    if (angle < 1e-3) { points.push({ x: s, y: 0 }); continue }
    const radius = PADDLE.length / angle, phi = s / radius
    points.push({ x: radius * Math.sin(phi), y: -radius * (1 - Math.cos(phi)) })
  }
  const ys = points.map(p => p.y), shift = (Math.min(...ys) + Math.max(...ys)) / 2
  return points.map(p => ({ x: p.x, y: p.y - shift }))
}

function closestOnSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby
  const t = len2 === 0 ? 0 : Phaser.Math.Clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1)
  return { x: a.x + abx * t, y: a.y + aby * t }
}

const BOUNCE_KEYS = ['bounce1', 'bounce2', 'bounce3'], WOOSH_KEYS = ['woosh1', 'woosh2', 'woosh3']

const LOG_HEIGHT = 34

class CourtScene extends Phaser.Scene {
  preload() {
    this.load.image('bg', bgUrl)
    this.load.image('ball', ballUrl)
    this.load.image('log', logUrl)
    this.load.audio('music', musicUrl)
    BOUNCE_KEYS.forEach((k, i) => this.load.audio(k, [bounce1Url, bounce2Url, bounce3Url][i]))
    WOOSH_KEYS.forEach((k, i) => this.load.audio(k, [woosh1Url, woosh2Url, woosh3Url][i]))
  }

  sfx(keys, volume = 0.8) {
    this.sound.play(Phaser.Utils.Array.GetRandom(keys), { volume })
  }

  create() {
    this.sound.play('music', { loop: true, volume: 0.5 })
    this.cameras.main.setZoom(RES).setScroll(WIDTH / 2 * (1 - RES), HEIGHT / 2 * (1 - RES))
    this.add.image(WIDTH / 2, HEIGHT / 2, 'bg').setDisplaySize(WIDTH, HEIGHT)
    const logTex = this.textures.get('log'), src = logTex.getSourceImage()
    for (let i = 0; i < SEGMENTS; i++) {
      logTex.add(`s${i}`, 0, Math.floor(i * src.width / SEGMENTS), 0, Math.ceil(src.width / SEGMENTS) + 1, src.height)
    }
    this.logSprites = Array.from({ length: SEGMENTS }, (_, i) => this.add.image(0, 0, 'log', `s${i}`).setVisible(false))
    this.target = null
    this.targetTime = 0
    this.targetVelocity = { x: 0, y: 0 }
    this.catching = false
    this.curl = 0
    this.paddle = this.add.graphics()
    this.best = loadBest()
    this.hud = this.add.text(WIDTH - 14, 10, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', align: 'right', stroke: '#000000', strokeThickness: 3, resolution: RES }).setOrigin(1, 0).setDepth(20)
    this.hudKey = ''
    this.warningGraphics = this.add.graphics().setDepth(10)
    this.trailGraphics = this.add.graphics()
    this.trail = []
    this.rally = 0
    this.hitSinceReceive = false
    this.lastContact = 0
    this.ball = this.add.image(0, 0, 'ball')
    this.ballScale = null
    this.ball.setDisplaySize(BALL.radius * 2.6, BALL.radius * 2.6 * this.ball.height / this.ball.width)
    this.baseScale = { x: this.ball.scaleX, y: this.ball.scaleY }
    this.held = false
    this.paddleVelocity = { x: 0, y: 0 }
    this.lastPaddle = null
    this.incoming = null
    this.warned = null
    this.launch()
    this.input.on('pointerdown', () => { if (this.hasBall) this.launch() })

    this.wasOnline = false
    this.onStatus = () => {
      const online = net.state === 'connected'
      if (online === this.wasOnline) return
      this.wasOnline = online
      if (!online) this.launch()
      else if (net.index === 0) this.launch()
      else this.setHasBall(false)
    }
    this.onNetMessage = (e) => {
      const m = e.detail.data
      if (e.detail.channel !== 'events' || this.hasBall) return
      if (m?.t === 'incoming' && m.cancel === true) { this.incoming = null; return }
      if (m?.t === 'incoming' && ['left', 'right', 'top'].includes(m.edge) && [m.x, m.y, m.ms].every(Number.isFinite)) {
        this.incoming = { edge: m.edge, x: Phaser.Math.Clamp(m.x, 0, 1) * WIDTH, y: Phaser.Math.Clamp(m.y, 0, 1) * HEIGHT, arrival: performance.now() + Phaser.Math.Clamp(m.ms, 0, 1400) }
        return
      }
      if (m?.t !== 'ball') return
      if (![m.x, m.y, m.vx, m.vy].every(Number.isFinite)) return
      const limit = (n) => Phaser.Math.Clamp(n, -BALL.maxSpeed, BALL.maxSpeed)
      const unit = (n) => Phaser.Math.Clamp(n, 0, 1)
      const entry = entryState({ edge: m.edge, x: unit(m.x), y: unit(m.y), vx: limit(m.vx), vy: limit(m.vy) }, WIDTH, HEIGHT, BALL.radius)
      if (!entry) return
      this.incoming = null
      this.held = false
      this.ball.setPosition(entry.x, entry.y)
      this.velocity = { x: entry.vx, y: entry.vy }
      this.hitSinceReceive = false
      this.rally = Number.isFinite(m.rally) ? Phaser.Math.Clamp(Math.floor(m.rally), 0, 99) : 0
      this.trail = []
      this.setHasBall(true)
    }
    net.events.addEventListener('status', this.onStatus)
    net.events.addEventListener('message', this.onNetMessage)
    this.events.once('shutdown', () => {
      net.events.removeEventListener('status', this.onStatus)
      net.events.removeEventListener('message', this.onNetMessage)
    })
    this.onHand = (e) => {
      const { tracked, position, timestamp } = e.detail
      if (tracked && this.target && timestamp > this.targetTime) {
        const dtMs = timestamp - this.targetTime
        const k = 0.6
        this.targetVelocity.x += k * ((position.x - this.target.x) / dtMs - this.targetVelocity.x)
        this.targetVelocity.y += k * ((position.y - this.target.y) / dtMs - this.targetVelocity.y)
      } else this.targetVelocity = { x: 0, y: 0 }
      this.target = tracked ? position : null
      this.targetTime = timestamp
      this.catching = !!e.detail.tracked && e.detail.gesture === 'catch'
    }
    window.addEventListener('handinput', this.onHand)
    this.events.once('shutdown', () => window.removeEventListener('handinput', this.onHand))
  }

  setHasBall(has) {
    this.hasBall = has
    this.ball.setVisible(has)
    if (!has) this.trail = []
    if (!has) this.warned = null
  }

  launch() {
    this.held = false
    this.ball.setPosition(WIDTH / 2, HEIGHT * 0.25)
    this.rally = 0
    this.hitSinceReceive = false
    this.trail = []
    this.velocity = { x: Phaser.Math.Between(-250, 250), y: 0 }
    this.setHasBall(true)
  }

  passBall(edge) {
    const { ball, velocity: v } = this
    const to = net.state === 'connected' ? exitTarget(net.size, net.index, edge) : null
    if (to === null) return false
    const message = { t: 'ball', edge, x: ball.x / WIDTH, y: ball.y / HEIGHT, vx: v.x, vy: v.y, rally: this.rally }
    if (!net.send('events', message, to)) return false
    this.held = false
    this.setHasBall(false)
    return true
  }

  update(_time, delta) {
    const dt = Math.min(delta, 33) / 1000
    this.drawTrail(dt)
    this.updateHud()
    this.paddle.clear()
    this.drawIncoming(performance.now())
    this.logSprites.forEach(l => l.setVisible(false))
    const goal = this.catching ? 1 : 0
    this.curl += (goal - this.curl) * (1 - Math.exp(-CATCH_SPEED * delta / 1000))
    if (!this.target) {
      this.held = false; this.lastPaddle = null; this.prevWorld = null
      this.stepBall(dt, null)
      return
    }

    const points = paddlePoints(this.curl)
    const half = PADDLE.thickness / 2
    const xs = points.map(p => p.x), ys = points.map(p => p.y)
    const minX = Math.min(...xs) - half, maxX = Math.max(...xs) + half
    const minY = Math.min(...ys) - half, maxY = Math.max(...ys) + half
    const ahead = Math.min(performance.now() - this.targetTime, MAX_EXTRAPOLATE_MS) + LEAD_MS
    const px = 0.5 + (this.target.x + this.targetVelocity.x * ahead - 0.5) * HAND_GAIN
    const py = 0.5 + (this.target.y + this.targetVelocity.y * ahead - 0.5) * HAND_GAIN
    const cx = Phaser.Math.Clamp(px * WIDTH, -minX, WIDTH - maxX)
    const cy = Phaser.Math.Clamp(py * HEIGHT, -minY, HEIGHT - maxY)

    const world = points.map(p => ({ x: p.x + cx, y: p.y + cy }))
    const segLen = PADDLE.length / SEGMENTS
    this.logSprites.forEach((spr, i) => {
      const a = world[i], b = world[i + 1]
      spr.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2).setRotation(Math.atan2(b.y - a.y, b.x - a.x))
        .setDisplaySize(segLen + 1, LOG_HEIGHT).setVisible(true)
    })

    if (this.lastPaddle && dt > 0) {
      const k = 1 - Math.exp(-PADDLE_VELOCITY_SMOOTHING * dt)
      this.paddleVelocity.x += k * ((cx - this.lastPaddle.x) / dt - this.paddleVelocity.x)
      this.paddleVelocity.y += k * ((cy - this.lastPaddle.y) / dt - this.paddleVelocity.y)
    } else this.paddleVelocity = { x: 0, y: 0 }
    this.lastPaddle = { x: cx, y: cy }

    const mid = world[SEGMENTS / 2]
    const rest = (1 - this.curl) * (PADDLE.thickness / 2 + BALL.radius) + this.curl * CUP_RADIUS
    const prev = this.prevWorld && this.prevWorld.length === world.length ? this.prevWorld : world
    this.prevWorld = world
    this.stepBall(dt, { world, prev, cup: { x: mid.x, y: mid.y - rest } })
  }

  updateHud() {
    if (this.rally > this.best) { this.best = this.rally; saveBest(this.best) }
    const key = `${this.rally}/${this.best}`
    if (key === this.hudKey) return
    this.hudKey = key
    this.hud.setText(`RALLY ${this.rally}\nBEST ${this.best}`)
    this.hud.setColor(this.rally > 0 && this.rally >= this.best ? '#ffd24d' : '#ffffff')
  }

  drawIncoming(now) {
    const warning = this.incoming
    this.warningGraphics.clear()
    if (!warning) return
    const remaining = warning.arrival - now
    if (remaining <= 0) { this.incoming = null; return }
    const ramp = Phaser.Math.Clamp(1 - remaining / 1200, 0, 1)
    const flash = remaining < 350 && Math.floor(now / (remaining < 160 ? 70 : 140)) % 2 === 0
    const alpha = flash ? 1 : 0.28 + ramp * 0.5
    const g = this.warningGraphics
    g.lineStyle(5 + ramp * 5, 0xffb84d, alpha)
    const x = warning.edge === 'left' ? 36 : warning.edge === 'right' ? WIDTH - 36 : warning.x
    const y = warning.edge === 'top' ? 36 : warning.edge === 'bottom' ? HEIGHT - 36 : warning.y
    if (warning.edge === 'left' || warning.edge === 'right') {
      const inward = warning.edge === 'left' ? 1 : -1
      g.lineBetween(x, y - 38, x, y + 38)
      g.fillStyle(0xffb84d, alpha)
      g.fillTriangle(x + inward * 4, y, x + inward * 28, y - 16, x + inward * 28, y + 16)
    } else {
      const inward = warning.edge === 'top' ? 1 : -1
      g.lineBetween(x - 38, y, x + 38, y)
      g.fillStyle(0xffb84d, alpha)
      g.fillTriangle(x, y + inward * 4, x - 16, y + inward * 28, x + 16, y + inward * 28)
    }
  }

  stepBall(dt, paddle) {
    if (!this.hasBall) return
    const ball = this.ball, v = this.velocity

    if (this.held && !(paddle && this.catching)) {
      this.held = false
      if (paddle) { v.x = this.paddleVelocity.x; v.y = this.paddleVelocity.y }
      this.sfx(WOOSH_KEYS)
    }
    if (this.held) {
      const k = 1 - Math.exp(-30 * dt)
      ball.x += (paddle.cup.x - ball.x) * k
      ball.y += (paddle.cup.y - ball.y) * k
      v.x = v.y = 0
    } else {
      v.y += (net.state === 'connected' ? BALL.onlineGravity : BALL.gravity) * dt
      const travel = Math.hypot(v.x - (paddle ? this.paddleVelocity.x : 0), v.y - (paddle ? this.paddleVelocity.y : 0)) * dt
      const steps = Math.min(20, Math.max(1, Math.ceil(travel / MAX_STEP)))
      for (let i = 1; i <= steps; i++) {
        ball.x += v.x * dt / steps
        ball.y += v.y * dt / steps
        if (paddle) {
          const t = i / steps
          const at = paddle.prev === paddle.world ? paddle.world
            : paddle.world.map((q, j) => ({ x: paddle.prev[j].x + (q.x - paddle.prev[j].x) * t, y: paddle.prev[j].y + (q.y - paddle.prev[j].y) * t }))
          if (this.collide({ world: at, cup: paddle.cup })) { this.held = true; break }
        }
        this.bounceOffWalls()
        if (!this.hasBall) break
      }
    }
    const speed = Math.hypot(v.x, v.y)
    this.sendIncomingWarning()
    if (speed > BALL.maxSpeed) { v.x *= BALL.maxSpeed / speed; v.y *= BALL.maxSpeed / speed }
  }

  sendIncomingWarning() {
    const send = (message) => { const to = this.warnTo; return to !== undefined && net.send('events', message, to) }
    const clear = () => { if (this.warned) send({ t: 'incoming', cancel: true }); this.warned = null }
    if (net.state !== 'connected' || !this.hasBall || this.held) { clear(); return }
    const exits = ['left', 'right', 'top'].filter(e => exitTarget(net.size, net.index, e) !== null)
    const gravity = BALL.onlineGravity
    const hit = predictExit(this.ball, this.velocity, gravity, BALL.radius, WIDTH, HEIGHT, exits, WARN_LEAD_MS)
    if (!hit) { clear(); return }
    const now = performance.now(), arrival = now + hit.ms
    const last = this.warned
    if (last && last.edge === hit.edge && Math.abs(last.arrival - arrival) < 120 && Math.abs(last.coord - hit.coord) < 40) return
    this.warnTo = exitTarget(net.size, net.index, hit.edge)
    const entryEdge = hit.edge === 'left' ? 'right' : hit.edge === 'right' ? 'left' : 'top'
    const clamped = Phaser.Math.Clamp(hit.coord, 0, hit.edge === 'top' ? WIDTH : HEIGHT)
    const message = { t: 'incoming', edge: entryEdge, x: hit.edge === 'top' ? 1 - clamped / WIDTH : 0, y: hit.edge === 'top' ? 0 : clamped / HEIGHT, ms: hit.ms }
    if (send(message)) this.warned = { edge: hit.edge, arrival, coord: hit.coord }
  }

  collide({ world, cup }) {
    const ball = this.ball, v = this.velocity, reach = BALL.radius + PADDLE.thickness / 2 + PADDLE.hitPad
    if (this.catching && Math.hypot(ball.x - cup.x, ball.y - cup.y) < CATCH_REACH) return true
    for (let i = 0; i < world.length - 1; i++) {
      const c = closestOnSegment(ball, world[i], world[i + 1])
      const dx = ball.x - c.x, dy = ball.y - c.y, dist = Math.hypot(dx, dy)
      if (dist >= reach) continue
      if (this.catching) return true
      const nx = dist > 1e-6 ? dx / dist : 0, ny = dist > 1e-6 ? dy / dist : -1
      ball.x = c.x + nx * reach; ball.y = c.y + ny * reach
      const rel = (v.x - this.paddleVelocity.x) * nx + (v.y - this.paddleVelocity.y) * ny
      if (rel < -60) this.sfx(BOUNCE_KEYS, Math.min(1, 0.4 + -rel / 800))
      if (rel < 0) { v.x -= (1 + BALL.paddleBounce) * rel * nx; v.y -= (1 + BALL.paddleBounce) * rel * ny }
      this.dampenBallSpeed()
      const now = performance.now(), clear = now - this.lastContact > RETURN_GAP_MS
      this.lastContact = now
      if (rel < -60 && clear) this.registerReturn()
      return false
    }
    return false
  }

  bounceOffWalls() {
    const ball = this.ball, v = this.velocity, r = BALL.radius
    if (ball.x < r) {
      if (v.x < 0 && this.passBall('left')) return
      ball.x = r; v.x = Math.abs(v.x) * BALL.wallBounce; this.dampenBallSpeed()
    }
    if (ball.x > WIDTH - r) {
      if (v.x > 0 && this.passBall('right')) return
      ball.x = WIDTH - r; v.x = -Math.abs(v.x) * BALL.wallBounce; this.dampenBallSpeed()
    }
    if (ball.y < r) {
      if (v.y < 0 && this.passBall('top')) return
      ball.y = r; v.y = Math.abs(v.y) * BALL.wallBounce; this.dampenBallSpeed()
    }
    if (ball.y > HEIGHT - r) {
      ball.y = HEIGHT - r; v.y = -Math.abs(v.y) * BALL.wallBounce; this.dampenBallSpeed()
      this.rally = 0
      if (Math.abs(v.y) < 40) v.y = 0
    }
  }

  registerReturn() {
    if (net.state === 'connected') {
      if (this.hitSinceReceive) return
      this.hitSinceReceive = true
    }
    this.rally++
    this.velocity.x *= BALL.returnBoost
    this.velocity.y *= BALL.returnBoost
    this.ballPulse = 1
  }

  heat() {
    return Phaser.Math.Clamp(this.rally / BALL.heatReturns, 0, 1)
  }

  drawTrail(dt) {
    const g = this.trailGraphics, ball = this.ball
    g.clear()
    const heat = this.heat()
    this.ballPulse = Math.max(0, (this.ballPulse || 0) - dt * 5)
    const pulse = 1 + this.ballPulse * 0.35
    ball.setScale(this.baseScale.x * pulse, this.baseScale.y * pulse)
    const tint = Phaser.Display.Color.Interpolate.ColorWithColor(
      new Phaser.Display.Color(255, 255, 255), new Phaser.Display.Color(255, heat < 1 ? 150 : 70, 60), 100, Math.round(heat * 100))
    ball.setTint(Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b))
    if (!this.hasBall) return
    this.trail.push({ x: ball.x, y: ball.y })
    if (this.trail.length > BALL.trailMax) this.trail.shift()
    const speed = this.velocity ? Math.hypot(this.velocity.x, this.velocity.y) : 0
    const intensity = Math.max(heat, Phaser.Math.Clamp((speed - 500) / (BALL.maxSpeed - 500), 0, 1))
    if (intensity <= 0.02) return
    const len = Math.ceil(4 + intensity * (BALL.trailMax - 4))
    const pts = this.trail.slice(-len)
    const color = Phaser.Display.Color.GetColor(255, Math.round(230 - 160 * heat), Math.round(200 - 150 * heat))
    pts.forEach((p, i) => {
      const f = (i + 1) / pts.length
      g.fillStyle(color, f * (0.15 + 0.5 * intensity))
      g.fillCircle(p.x, p.y, BALL.radius * (0.35 + 0.75 * f))
    })
    if (heat > 0.5) {
      g.fillStyle(0xff6a3c, 0.12 + 0.18 * heat)
      g.fillCircle(ball.x, ball.y, BALL.radius * (1.6 + 0.6 * heat))
    }
  }

  dampenBallSpeed() {
    this.velocity.x *= BALL.bounceDamping
    this.velocity.y *= BALL.bounceDamping
  }
}

export function createGame(parent) {
  return new Phaser.Game({
    type: Phaser.AUTO, parent, width: WIDTH * RES, height: HEIGHT * RES,
    backgroundColor: '#0a100d', scene: CourtScene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  })
}
