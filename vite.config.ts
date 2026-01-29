import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.VITE_DEV_PORT ?? 5173)
const strictPort = process.env.VITE_DEV_STRICT_PORT === '0' ? false : true

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
