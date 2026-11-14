// Protocol check against a running relay:  node worker/conformance.mjs ws://localhost:8787/signal
// Works for both the Node relay (server/) and the Cloudflare Worker (worker/).
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'

const base = process.argv[2]
if (!base) { console.error('usage: node worker/conformance.mjs <ws-url>'); process.exit(2) }

function open(joinCode) {
  const ws = new WebSocket(joinCode ? `${base}?code=${joinCode}` : base), inbox = [], waiting = []
  ws.on('message', raw => { const m = JSON.parse(raw); const w = waiting.shift(); w ? w(m) : inbox.push(m) })
  ws.next = () => Promise.race([
    inbox.length ? Promise.resolve(inbox.shift()) : new Promise(r => waiting.push(r)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timed out waiting for a message')), 5000)),
  ])
  ws.json = (m) => ws.send(JSON.stringify(m))
  return new Promise((res, rej) => { ws.once('open', () => res(ws)); ws.once('error', rej) })
}
const checks = []
const check = async (name, fn) => { try { await fn(); console.log('ok  ', name) } catch (e) { console.log('FAIL', name, '-', e.message); checks.push(name) } }
const sockets = []
const connect = async (code) => { const ws = await open(code); sockets.push(ws); return ws }

await check('create returns a code, size and seat 0', async () => {
  const h = await connect(); h.json({ type: 'create', size: 4 })
  const m = await h.next()
  assert.equal(m.type, 'created'); assert.match(m.code, /^[A-HJ-NP-Z2-9]{4}$/); assert.deepEqual([m.size, m.index], [4, 0])
})

await check('4 players: join order = seats, peers announced, signals routed by seat', async () => {
  const h = await connect(); h.json({ type: 'create', size: 4 }); const { code } = await h.next()
  const a = await connect(code.toLowerCase()); a.json({ type: 'join', code })
  assert.deepEqual(await a.next(), { type: 'joined', code, size: 4, index: 1, peers: [0] })
  assert.deepEqual(await h.next(), { type: 'peer-joined', index: 1 })
  const b = await connect(code); b.json({ type: 'join', code })
  assert.deepEqual(await b.next(), { type: 'joined', code, size: 4, index: 2, peers: [0, 1] })
  assert.deepEqual(await h.next(), { type: 'peer-joined', index: 2 }); assert.deepEqual(await a.next(), { type: 'peer-joined', index: 2 })
  const c = await connect(code); c.json({ type: 'join', code })
  assert.deepEqual(await c.next(), { type: 'joined', code, size: 4, index: 3, peers: [0, 1, 2] })
  for (const w of [h, a, b]) assert.deepEqual(await w.next(), { type: 'peer-joined', index: 3 })
  b.json({ type: 'signal', to: 3, data: { n: 1 } })
  assert.deepEqual(await c.next(), { type: 'signal', from: 2, data: { n: 1 } })
  a.json({ type: 'signal', to: 1, data: { n: 2 } }) // to self: dropped
  a.json({ type: 'signal', to: 9, data: { n: 3 } }) // no such seat: dropped
  a.json({ type: 'signal', to: 0, data: { n: 4 } })
  assert.deepEqual(await h.next(), { type: 'signal', from: 1, data: { n: 4 } })
  const late = await connect(code); late.json({ type: 'join', code }) // room is full and started
  assert.deepEqual(await late.next(), { type: 'error', reason: 'room-full' })
})

await check('unknown or malformed code → no-such-room', async () => {
  for (const code of ['ZZZZ', 'x', 'abc!']) {
    const g = await connect(code); g.json({ type: 'join', code })
    assert.deepEqual(await g.next(), { type: 'error', reason: 'no-such-room' })
  }
})

await check('bad size, junk, wrong intent', async () => {
  const h = await connect(); h.json({ type: 'create', size: 3 })
  assert.deepEqual(await h.next(), { type: 'error', reason: 'bad-message' })
  h.send('not json'); assert.deepEqual(await h.next(), { type: 'error', reason: 'bad-message' })
  h.json({ type: 'nope' }); assert.deepEqual(await h.next(), { type: 'error', reason: 'bad-message' })
})

await check('lobby: guest leaving frees the seat; host leaving closes the room', async () => {
  const h = await connect(); h.json({ type: 'create', size: 4 }); const { code } = await h.next()
  const g1 = await connect(code); g1.json({ type: 'join', code }); await g1.next(); await h.next()
  const g2 = await connect(code); g2.json({ type: 'join', code }); await g2.next(); await h.next(); await g1.next()
  g1.close()
  assert.deepEqual(await h.next(), { type: 'peer-left', index: 1 }); assert.deepEqual(await g2.next(), { type: 'peer-left', index: 1 })
  const g3 = await connect(code); g3.json({ type: 'join', code })
  assert.deepEqual(await g3.next(), { type: 'joined', code, size: 4, index: 1, peers: [0, 2] })
  await h.next(); await g2.next()
  h.close()
  assert.deepEqual(await g2.next(), { type: 'room-closed' })
})

await check('started room survives players closing their sockets', async () => {
  const h = await connect(); h.json({ type: 'create', size: 2 }); const { code } = await h.next()
  const g = await connect(code); g.json({ type: 'join', code }); await g.next(); await h.next()
  h.close(); await new Promise(r => setTimeout(r, 100))
  const late = await connect(code); late.json({ type: 'join', code })
  assert.deepEqual(await late.next(), { type: 'error', reason: 'room-full' })
  g.json({ type: 'signal', to: 0, data: { x: 1 } }) // empty seat: dropped, no crash
})

for (const ws of sockets) ws.terminate()
console.log(checks.length ? `\n${checks.length} FAILED` : '\nall passed'); process.exit(checks.length ? 1 : 0)
