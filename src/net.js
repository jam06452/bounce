// Peer-to-peer links between players (2 or 4).
//
// A WebSocket to the signaling relay is used only for the handshake: the host
// opens a room and gets a short code, guests enter it and take seats in join
// order (host = seat 0), and everyone swaps WebRTC offers/answers/ICE candidates
// through the relay. Every pair of players gets its own direct link (a full
// mesh), so a ball passed between any two seats takes the shortest route. When
// all of a player's links are open the WebSocket is closed.
//
// Each link has two channels, so each message gets the delivery it needs:
//   'state'  unordered, no retransmits (UDP-like): positions. Stale = useless.
//   'events' reliable + ordered: ball hand-offs, serve, score.
//
// Events (on `net.events`):  'status'  → {state, role, code, size, index, players, message?}
//                            'message' → {channel, data, from}      'rtt' → ms (mean over peers)

const turn = import.meta.env.VITE_TURN_URL
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  // Strict NATs (many mobile/corporate networks) can't connect directly and need a relay.
  ...(turn ? [{ urls: turn, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : []),
]
// Joining puts the room code in the URL: the Cloudflare relay needs it to pick
// the right room before any message is sent. The Node relay just ignores it.
const signalingUrl = (joinCode) => {
  const url = new URL(import.meta.env.VITE_SIGNALING_URL ||
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`)
  if (joinCode) url.searchParams.set('code', joinCode)
  return url.toString()
}

const ERRORS = {
  'no-such-room': 'No room with that code.',
  'room-full': 'That room is full or already started.',
  'server-busy': 'The server is busy. Try again shortly.',
  'already-in-room': 'Already in a room.',
  'bad-message': 'The server rejected a message.',
}

export function createNet() {
  const events = new EventTarget()
  let socket = null, role = null, code = null, size = 0, index = -1, players = 0
  const peers = new Map() // seat → { pc, channels, queued, rtt }
  let pingTimer = null, session = 0, state = 'idle'

  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }))
  const setState = (next, message) => { state = next; emit('status', { state, role, code, size, index, players, message }) }
  const signal = (to, data) => socket?.readyState === 1 && socket.send(JSON.stringify({ type: 'signal', to, data }))

  function closePeer(seat) {
    const peer = peers.get(seat)
    if (!peer) return
    peer.pc.onicecandidate = peer.pc.onconnectionstatechange = peer.pc.ondatachannel = null
    for (const ch of Object.values(peer.channels)) ch.onopen = ch.onclose = ch.onmessage = null
    peer.pc.close(); peers.delete(seat)
  }
  function teardown() {
    session++ // invalidates any in-flight async work from the previous attempt
    clearInterval(pingTimer); pingTimer = null
    if (socket) { socket.onclose = socket.onmessage = socket.onerror = null; socket.close() }
    socket = null
    for (const seat of [...peers.keys()]) closePeer(seat)
  }
  function fail(message) { teardown(); setState('error', message) }

  function openSocket(joinCode) {
    return new Promise((resolve, reject) => {
      let ws
      const url = signalingUrl(joinCode), where = new URL(url).host
      try { ws = new WebSocket(url) } catch { return reject(new Error(`Bad signaling URL (${url}).`)) }
      ws.onopen = () => resolve(ws)
      // The browser doesn't say why (wrong address, blocked origin, server down), so name the address it tried.
      ws.onerror = () => reject(new Error(`Cannot reach the signaling server at ${where}.`))
    })
  }

  async function connect(asRole, firstMessage) {
    teardown(); role = asRole; code = null; size = players = 0; index = -1
    const mine = session
    setState('connecting')
    try {
      const ws = await openSocket(firstMessage.code)
      if (mine !== session) return ws.close()
      socket = ws
      ws.onmessage = (e) => handleSignaling(e.data)
      ws.onclose = () => { if (['connecting', 'waiting', 'negotiating'].includes(state)) fail('Lost connection to the signaling server.') }
      ws.send(JSON.stringify(firstMessage))
    } catch (error) { if (mine === session) fail(error.message) }
  }

  const lobbyState = () => players < size ? 'waiting' : 'negotiating'

  function handleSignaling(raw) {
    let message
    try { message = JSON.parse(raw) } catch { return }
    switch (message.type) {
      case 'created':
        ({ code, size, index } = message); players = 1
        return setState('waiting')
      case 'joined':
        ({ code, size, index } = message); players = message.peers.length + 1
        return setState(lobbyState())
      case 'peer-joined':
        players++
        setState(lobbyState())
        // The lower seat always makes the offer, so the two sides never collide.
        if (index < message.index) startPeer(message.index, true)
        return
      case 'signal': return onSignal(message.from, message.data)
      case 'peer-left':
        if (state === 'connected') return // direct links are independent of the relay
        closePeer(message.index); players--
        return setState('waiting')
      case 'room-closed': return fail('The host closed the room.')
      case 'error': return fail(ERRORS[message.reason] ?? 'Signaling error.')
    }
  }

  function startPeer(seat, offerer) {
    const mine = session
    const peer = { pc: new RTCPeerConnection({ iceServers: ICE_SERVERS }), channels: {}, queued: [], rtt: null }
    const { pc } = peer
    peers.set(seat, peer)
    pc.onicecandidate = (e) => e.candidate && signal(seat, { candidate: e.candidate })
    pc.onconnectionstatechange = () => {
      if (mine !== session) return
      if (pc.connectionState === 'failed') fail(`Could not connect to player ${seat + 1}. A strict network may need a TURN relay.`)
      else if (pc.connectionState === 'disconnected' && state === 'connected') setState('reconnecting')
      else if (pc.connectionState === 'connected' && state === 'reconnecting') setState('connected')
    }
    if (offerer) {
      wire(seat, peer, pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }))
      wire(seat, peer, pc.createDataChannel('events'))
      pc.setLocalDescription().then(() => signal(seat, { description: pc.localDescription })).catch(() => fail('Handshake failed.'))
    } else pc.ondatachannel = (e) => wire(seat, peer, e.channel)
    return peer
  }

  async function onSignal(from, data) {
    if (!Number.isInteger(from) || from === index || !data) return
    try {
      const peer = peers.get(from) ?? startPeer(from, false)
      const { pc } = peer
      if (data.description) {
        await pc.setRemoteDescription(data.description)
        for (const c of peer.queued.splice(0)) await pc.addIceCandidate(c)
        if (data.description.type === 'offer') {
          await pc.setLocalDescription()
          signal(from, { description: pc.localDescription })
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate)
        else peer.queued.push(data.candidate)
      }
    } catch { fail('Handshake failed.') }
  }

  function wire(seat, peer, channel) {
    const mine = session
    peer.channels[channel.label] = channel
    channel.onopen = () => { if (mine === session) checkConnected() }
    channel.onclose = () => { if (mine === session && state === 'connected') { teardown(); setState('error', 'A player disconnected.') } }
    channel.onmessage = (e) => {
      let data
      try { data = JSON.parse(e.data) } catch { return }
      if (data?.t === 'ping') return send('state', { t: 'pong', n: data.n }, seat)
      if (data?.t === 'pong') {
        const sample = performance.now() - data.n
        peer.rtt = peer.rtt === null ? sample : peer.rtt * 0.7 + sample * 0.3
        const known = [...peers.values()].map(p => p.rtt).filter(r => r !== null)
        return emit('rtt', known.reduce((a, b) => a + b, 0) / known.length)
      }
      emit('message', { channel: channel.label, data, from: seat })
    }
  }

  // Linked once every other player has both channels open.
  function checkConnected() {
    if (state === 'connected' || peers.size !== size - 1) return
    for (const p of peers.values()) {
      if (p.channels.state?.readyState !== 'open' || p.channels.events?.readyState !== 'open') return
    }
    if (socket) { socket.onclose = null; socket.close(); socket = null } // the relay is no longer needed
    setState('connected')
    pingTimer = setInterval(() => send('state', { t: 'ping', n: performance.now() }), 1000)
  }

  /** Send to one seat, or to everyone if `to` is omitted. True if anything was sent. */
  function send(channel, data, to) {
    const targets = to === undefined ? [...peers.values()] : [peers.get(to)].filter(Boolean)
    const text = JSON.stringify(data)
    let sent = false
    for (const p of targets) {
      const ch = p.channels[channel]
      if (ch?.readyState === 'open') { ch.send(text); sent = true }
    }
    return sent
  }

  return {
    events,
    get state() { return state },
    get index() { return index },
    get size() { return size },
    host: (playerCount) => connect('host', { type: 'create', size: playerCount }),
    join: (roomCode) => connect('guest', { type: 'join', code: roomCode }),
    leave() { teardown(); role = code = null; size = players = 0; index = -1; setState('idle') },
    send,
  }
}

export const net = createNet()
