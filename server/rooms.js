// Room-code signaling relay for WebRTC. It only ferries the handshake (offers,
// answers, ICE candidates) between players; game data never touches it.
// A room holds 2 or 4 players. Seats are numbered in join order: host = 0.
//
//   client → server   {type:'create', size:2|4}       host opens a room
//                     {type:'join', code}             guest takes the next free seat
//                     {type:'signal', to, data}       relayed to seat `to`
//   server → client   {type:'created', code, size, index:0}
//                     {type:'joined', code, size, index, peers:[seat, …]}
//                     {type:'peer-joined', index}     a new player took a seat
//                     {type:'signal', from, data}
//                     {type:'peer-left', index} / {type:'room-closed'} / {type:'error', reason}
//
// Once the room is full it is "started": nobody else can join, and players
// closing their sockets (they do, once linked) don't disturb the rest.
import { randomInt } from 'node:crypto'
import { WebSocketServer } from 'ws'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/
const SIZES = [2, 4]
const MAX_ROOMS = 500
const ROOM_TTL_MS = 2 * 60 * 60 * 1000
const MAX_PAYLOAD = 16 * 1024 // SDP blobs are a few KB
const RATE_WINDOW_MS = 5000, RATE_MAX = 400 // a 4-player mesh trickles a lot of ICE

export function createSignaling({ allowedOrigins = [] } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  const rooms = new Map() // code → { size, members: [ws|null, …], started, created }

  const send = (ws, message) => { if (ws?.readyState === 1) ws.send(JSON.stringify(message)) }
  function newCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
      if (!rooms.has(code)) return code
    }
    return null
  }
  function leave(ws) {
    const room = rooms.get(ws.room)
    if (!room) return
    const code = ws.room
    room.members[ws.index] = null
    ws.room = null
    const others = room.members.filter(Boolean)
    if (room.started) { if (!others.length) rooms.delete(code) }
    else if (ws.index === 0) {
      rooms.delete(code)
      for (const m of others) { m.room = null; send(m, { type: 'room-closed' }) }
    } else for (const m of others) send(m, { type: 'peer-left', index: ws.index })
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true; ws.room = null; ws.index = -1
    ws.rate = { start: Date.now(), count: 0 }
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('close', () => leave(ws))
    ws.on('error', () => {})
    ws.on('message', (raw) => {
      const now = Date.now()
      if (now - ws.rate.start > RATE_WINDOW_MS) ws.rate = { start: now, count: 0 }
      if (++ws.rate.count > RATE_MAX) return ws.close(1008, 'rate limit')
      let message
      try { message = JSON.parse(raw) } catch { return send(ws, { type: 'error', reason: 'bad-message' }) }
      if (!message || typeof message !== 'object') return send(ws, { type: 'error', reason: 'bad-message' })

      switch (message.type) {
        case 'create': {
          if (ws.room) return send(ws, { type: 'error', reason: 'already-in-room' })
          if (!SIZES.includes(message.size)) return send(ws, { type: 'error', reason: 'bad-message' })
          if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', reason: 'server-busy' })
          const code = newCode()
          if (!code) return send(ws, { type: 'error', reason: 'server-busy' })
          const members = Array(message.size).fill(null); members[0] = ws
          rooms.set(code, { size: message.size, members, started: false, created: now })
          ws.room = code; ws.index = 0
          return send(ws, { type: 'created', code, size: message.size, index: 0 })
        }
        case 'join': {
          if (ws.room) return send(ws, { type: 'error', reason: 'already-in-room' })
          const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : ''
          const room = CODE_RE.test(code) ? rooms.get(code) : null
          if (!room) return send(ws, { type: 'error', reason: 'no-such-room' })
          const seat = room.started ? -1 : room.members.indexOf(null)
          if (seat < 0) return send(ws, { type: 'error', reason: 'room-full' })
          const peers = room.members.flatMap((m, i) => m ? [i] : [])
          room.members[seat] = ws; ws.room = code; ws.index = seat
          if (!room.members.includes(null)) room.started = true
          send(ws, { type: 'joined', code, size: room.size, index: seat, peers })
          for (const i of peers) send(room.members[i], { type: 'peer-joined', index: seat })
          return
        }
        case 'signal': {
          const room = rooms.get(ws.room)
          if (!room || !message.data || typeof message.data !== 'object') return
          const target = Number.isInteger(message.to) ? room.members[message.to] : null
          if (!target || target === ws) return
          return send(target, { type: 'signal', from: ws.index, data: message.data })
        }
        default: return send(ws, { type: 'error', reason: 'bad-message' })
      }
    })
  })

  // Drop dead sockets and abandoned rooms.
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue }
      ws.isAlive = false; ws.ping()
    }
    const cutoff = Date.now() - ROOM_TTL_MS
    for (const room of rooms.values()) if (room.created < cutoff) for (const m of room.members) m?.close(1000, 'room expired')
  }, 30_000)
  sweep.unref()

  return {
    /** Call from an http(s) server's 'upgrade' event for the signaling path. */
    handleUpgrade(req, socket, head) {
      const origin = req.headers.origin
      if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy()
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    },
    roomCount: () => rooms.size,
    close() { clearInterval(sweep); for (const ws of wss.clients) ws.terminate(); wss.close() },
  }
}
