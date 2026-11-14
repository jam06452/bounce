import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { createSignaling } from './server/rooms.js'

// Serves the room-code signaling relay at /signal on the same HTTPS port as the
// app, so `npm run dev` / `npm run preview` work for two laptops with no extra
// process. For internet play deploy server/index.js and set VITE_SIGNALING_URL.
function signalingPlugin() {
  const attach = (server) => {
    const signaling = createSignaling()
    server.httpServer?.on('upgrade', (req, socket, head) => {
      if (new URL(req.url, 'http://x').pathname === '/signal') signaling.handleUpgrade(req, socket, head)
    })
    server.httpServer?.on('close', () => signaling.close())
  }
  return { name: 'signaling', configureServer: attach, configurePreviewServer: attach }
}

// The webcam API only works on localhost or HTTPS, so serving to other devices on
// the network needs HTTPS. basicSsl makes a self-signed certificate: the browser
// shows a one-time warning on each laptop (Advanced → Proceed).
export default defineConfig({
  plugins: [basicSsl(), signalingPlugin()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
