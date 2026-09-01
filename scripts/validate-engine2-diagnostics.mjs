#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { validateEngine2Diagnostics } from '../src/lib/server/engine2DiagnosticValidator.js'

const args = process.argv.slice(2)
const scenarioIndex = args.findIndex((arg) => arg === '--scenario')
const scenario = scenarioIndex >= 0 ? args[scenarioIndex + 1] || 'lamp' : 'lamp'
const filePath = args.find((arg, index) =>
  arg !== '--scenario' &&
  (scenarioIndex < 0 || index !== scenarioIndex + 1)
)

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const raw = filePath ? readFileSync(filePath, 'utf8') : readStdin()
if (!raw.trim()) {
  console.error('FAIL')
  console.error('No diagnostics JSON provided. Pass a file path or pipe JSON to stdin.')
  process.exit(2)
}

let diagnostics
try {
  diagnostics = JSON.parse(raw)
} catch (error) {
  console.error('FAIL')
  console.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

const result = validateEngine2Diagnostics(diagnostics, { scenario })
console.log(result.ok ? 'PASS' : 'FAIL')
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
