import { createServer } from 'node:http'
import { createSignaling } from './rooms.js'

const port = Number(process.env.PORT) || 8787
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
if (!allowedOrigins.length) console.warn('ALLOWED_ORIGINS is not set: any website can use this server.')

const signaling = createSignaling({ allowedOrigins })
const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok') }
  res.writeHead(404); res.end()
})
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname === '/signal') signaling.handleUpgrade(req, socket, head)
  else socket.destroy()
})
server.listen(port, () => console.log(`Signaling listening on :${port} (path /signal)`))
