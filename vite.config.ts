import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

const port = Number(process.env.VITE_DEV_PORT ?? 5173)
const strictPort = process.env.VITE_DEV_STRICT_PORT === '0' ? false : true
const commitSha =
  process.env.VITE_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  (() => {
    try {
      return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return 'unknown'
    }
  })()
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
  },
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
