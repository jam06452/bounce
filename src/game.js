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
import { exitTarget, entryState } from './topology.js'

const WIDTH = 800, HEIGHT = 450
const PADDLE = { length: 180, thickness: 24, hitPad: 12 }
const MAX_STEP = 6
const CATCH_ARC = Math.PI * 1.15
const CATCH_SPEED = 24
const SEGMENTS = 32

const BALL = { radius: 18, gravity: 700, onlineGravity: 300, wallBounce: 0.85, paddleBounce: 0.9, maxSpeed: 1400, bounceDamping: 0.9 }
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
    this.ball = this.add.image(0, 0, 'ball')
    this.ball.setDisplaySize(BALL.radius * 2.6, BALL.radius * 2.6 * this.ball.height / this.ball.width)
    this.held = false
    this.paddleVelocity = { x: 0, y: 0 }
    this.lastPaddle = null
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
      if (e.detail.channel !== 'events' || m?.t !== 'ball' || this.hasBall) return
      if (![m.x, m.y, m.vx, m.vy].every(Number.isFinite)) return
      const limit = (n) => Phaser.Math.Clamp(n, -BALL.maxSpeed, BALL.maxSpeed)
      const unit = (n) => Phaser.Math.Clamp(n, 0, 1)
      const entry = entryState({ edge: m.edge, x: unit(m.x), y: unit(m.y), vx: limit(m.vx), vy: limit(m.vy) }, WIDTH, HEIGHT, BALL.radius)
      if (!entry) return
      this.held = false
      this.ball.setPosition(entry.x, entry.y)
      this.velocity = { x: entry.vx, y: entry.vy }
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
  }

  launch() {
    this.held = false
    this.ball.setPosition(WIDTH / 2, HEIGHT * 0.25)
    this.velocity = { x: Phaser.Math.Between(-250, 250), y: 0 }
    this.setHasBall(true)
  }

  passBall(edge) {
    const { ball, velocity: v } = this
    const to = net.state === 'connected' ? exitTarget(net.size, net.index, edge) : null
    if (to === null) return false
    const message = { t: 'ball', edge, x: ball.x / WIDTH, y: ball.y / HEIGHT, vx: v.x, vy: v.y }
    if (!net.send('events', message, to)) return false
    this.held = false
    this.setHasBall(false)
    return true
  }

  update(_time, delta) {
    const dt = Math.min(delta, 33) / 1000
    this.paddle.clear()
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
    if (speed > BALL.maxSpeed) { v.x *= BALL.maxSpeed / speed; v.y *= BALL.maxSpeed / speed }
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
      if (Math.abs(v.y) < 40) v.y = 0
    }
  }

  dampenBallSpeed() {
    this.velocity.x *= BALL.bounceDamping
    this.velocity.y *= BALL.bounceDamping
  }
}

export function createGame(parent) {
  return new Phaser.Game({
    type: Phaser.AUTO, parent, width: WIDTH, height: HEIGHT,
    backgroundColor: '#0a100d', scene: CourtScene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  })
}
