import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const nodeCommand = process.execPath

const frontend = spawn(npmCommand, ['run', 'dev'], {
  stdio: 'inherit',
  shell: false,
})

const backend = spawn(nodeCommand, ['server.mjs'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    PORT: process.env.PORT || '8787',
    HOST: process.env.HOST || '127.0.0.1',
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
