import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

const worker = { target: process.env.WORKER_URL ?? 'http://localhost:8787', ws: true }

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/signal': worker, '/feed': worker, '/turn': worker, '/auth': worker, '/api': worker },
  },
  worker: { format: 'iife' },
  preview: { host: true, port: 4173 },
})
