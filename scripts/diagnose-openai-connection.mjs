import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runOpenAiConnectionDiagnostic } from '../src/lib/server/openaiClient.js'

const envPath = resolve(process.cwd(), '.env.local')

const loadEnvFile = (filePath) => {
  if (!existsSync(filePath)) return
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '')
    process.env[key] = value
  }
}

loadEnvFile(envPath)

const model = process.argv[2] || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini'
const result = await runOpenAiConnectionDiagnostic({
  apiKey: process.env.OPENAI_API_KEY,
  model,
  timeoutMs: 10_000,
})

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      model: result.model,
      status: result.status,
      diagnostic: result.diagnostic,
    },
    null,
    2
  )
)
