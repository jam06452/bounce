import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { createSignaling } from './server/rooms.js'

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

export default defineConfig({
  plugins: [basicSsl(), signalingPlugin()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
})
