import { spawn } from 'node:child_process'

const frontend = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
})

const backend = spawn('node', ['server.mjs'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT: process.env.PORT || '8787',
  },
})

const shutdown = (code = 0) => {
  frontend.kill('SIGINT')
  backend.kill('SIGINT')
  process.exit(code)
}

frontend.on('exit', (code) => shutdown(code ?? 0))
backend.on('exit', (code) => shutdown(code ?? 0))

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
