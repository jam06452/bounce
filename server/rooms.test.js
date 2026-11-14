import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { createSignaling } from './rooms.js'

async function setup(options) {
  const signaling = createSignaling(options)
  const server = createServer()
  server.on('upgrade', (req, socket, head) => signaling.handleUpgrade(req, socket, head))
  await new Promise(r => server.listen(0, r))
  const url = `ws://localhost:${server.address().port}/signal`
  const client = async (headers) => {
    const ws = new WebSocket(url, { headers }), inbox = [], waiting = []
    ws.on('message', raw => { const m = JSON.parse(raw); const w = waiting.shift(); w ? w(m) : inbox.push(m) })
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
    ws.next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise(r => waiting.push(r))
    ws.sendJson = (m) => ws.send(JSON.stringify(m))
    return ws
  }
  const stop = () => { signaling.close(); server.close() }
  return { client, stop }
}

test('host creates, guest joins, signals are relayed both ways', async () => {
  const { client, stop } = await setup()
  const host = await client(), guest = await client()
  host.sendJson({ type: 'create', size: 2 })
  const created = await host.next()
  assert.equal(created.type, 'created'); assert.match(created.code, /^[A-HJ-NP-Z2-9]{4}$/)
  assert.deepEqual([created.size, created.index], [2, 0])
  const { code } = created
  guest.sendJson({ type: 'join', code: code.toLowerCase() })
  assert.deepEqual(await guest.next(), { type: 'joined', code, size: 2, index: 1, peers: [0] })
  assert.deepEqual(await host.next(), { type: 'peer-joined', index: 1 })
  host.sendJson({ type: 'signal', to: 1, data: { description: { type: 'offer', sdp: 'x' } } })
  assert.deepEqual(await guest.next(), { type: 'signal', from: 0, data: { description: { type: 'offer', sdp: 'x' } } })
  guest.sendJson({ type: 'signal', to: 0, data: { candidate: { candidate: 'c' } } })
  assert.deepEqual(await host.next(), { type: 'signal', from: 1, data: { candidate: { candidate: 'c' } } })
  host.close(); guest.close(); stop()
})

test('4 players: seats follow join order and signals go to the addressed seat only', async () => {
  const { client, stop } = await setup()
  const [h, a, b, c] = await Promise.all([client(), client(), client(), client()])
  h.sendJson({ type: 'create', size: 4 }); const { code } = await h.next()
  a.sendJson({ type: 'join', code })
  assert.deepEqual(await a.next(), { type: 'joined', code, size: 4, index: 1, peers: [0] })
  assert.deepEqual(await h.next(), { type: 'peer-joined', index: 1 })
  b.sendJson({ type: 'join', code })
  assert.deepEqual(await b.next(), { type: 'joined', code, size: 4, index: 2, peers: [0, 1] })
  assert.deepEqual(await h.next(), { type: 'peer-joined', index: 2 })
  assert.deepEqual(await a.next(), { type: 'peer-joined', index: 2 })
  c.sendJson({ type: 'join', code })
  assert.deepEqual(await c.next(), { type: 'joined', code, size: 4, index: 3, peers: [0, 1, 2] })
  for (const w of [h, a, b]) assert.deepEqual(await w.next(), { type: 'peer-joined', index: 3 })
  b.sendJson({ type: 'signal', to: 3, data: { n: 1 } })
  assert.deepEqual(await c.next(), { type: 'signal', from: 2, data: { n: 1 } })
  a.sendJson({ type: 'signal', to: 1, data: { n: 2 } })
  a.sendJson({ type: 'signal', to: 9, data: { n: 3 } })
  a.sendJson({ type: 'signal', to: 0, data: { n: 4 } })
  assert.deepEqual(await h.next(), { type: 'signal', from: 1, data: { n: 4 } })
  for (const w of [h, a, b, c]) w.close(); stop()
})

test('errors: unknown room, full room, bad size, junk input', async () => {
  const { client, stop } = await setup()
  const host = await client(), a = await client(), b = await client()
  a.sendJson({ type: 'join', code: 'ZZZZ' })
  assert.deepEqual(await a.next(), { type: 'error', reason: 'no-such-room' })
  a.sendJson({ type: 'create', size: 3 })
  assert.deepEqual(await a.next(), { type: 'error', reason: 'bad-message' })
  host.sendJson({ type: 'create', size: 2 }); const { code } = await host.next()
  a.sendJson({ type: 'join', code }); await a.next(); await host.next()
  b.sendJson({ type: 'join', code })
  assert.deepEqual(await b.next(), { type: 'error', reason: 'room-full' })
  b.send('not json')
  assert.deepEqual(await b.next(), { type: 'error', reason: 'bad-message' })
  b.sendJson({ type: 'signal', to: 0, data: { x: 1 } })
  b.sendJson({ type: 'nope' })
  assert.deepEqual(await b.next(), { type: 'error', reason: 'bad-message' })
  for (const ws of [host, a, b]) ws.close(); stop()
})

test('lobby: guest leaving frees the seat; host leaving closes the room', async () => {
  const { client, stop } = await setup()
  const host = await client(), g1 = await client(), g2 = await client()
  host.sendJson({ type: 'create', size: 4 }); const { code } = await host.next()
  g1.sendJson({ type: 'join', code }); await g1.next(); await host.next()
  g2.sendJson({ type: 'join', code }); await g2.next(); await host.next(); await g1.next()
  g1.close()
  assert.deepEqual(await host.next(), { type: 'peer-left', index: 1 })
  assert.deepEqual(await g2.next(), { type: 'peer-left', index: 1 })
  const g3 = await client()
  g3.sendJson({ type: 'join', code })
  assert.deepEqual(await g3.next(), { type: 'joined', code, size: 4, index: 1, peers: [0, 2] })
  assert.deepEqual(await host.next(), { type: 'peer-joined', index: 1 })
  assert.deepEqual(await g2.next(), { type: 'peer-joined', index: 1 })
  host.close()
  assert.deepEqual(await g2.next(), { type: 'room-closed' })
  g2.close(); g3.close(); stop()
})

test('started room: players closing sockets does not disturb the rest, and nobody else can join', async () => {
  const { client, stop } = await setup()
  const host = await client(), guest = await client(), late = await client()
  host.sendJson({ type: 'create', size: 2 }); const { code } = await host.next()
  guest.sendJson({ type: 'join', code }); await guest.next(); await host.next()
  host.close()
  await new Promise(r => setTimeout(r, 30))
  late.sendJson({ type: 'join', code })
  assert.deepEqual(await late.next(), { type: 'error', reason: 'room-full' })
  guest.sendJson({ type: 'signal', to: 0, data: { x: 1 } })
  guest.close(); late.close(); stop()
})

test('origin allow-list rejects other sites', async () => {
  const { client, stop } = await setup({ allowedOrigins: ['https://game.example'] })
  await assert.rejects(client({ origin: 'https://evil.example' }))
  const ok = await client({ origin: 'https://game.example' }); ok.close(); stop()
})
