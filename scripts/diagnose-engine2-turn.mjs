import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { planEngine2LlmTurn } from '../src/lib/server/engine2LlmTurnPlanner.js'

const envPath = resolve(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
}

const text = process.argv[2] || "I have a problem with my desk lamp. It is too heavy and its arm is too short, so the light does not reach the place where I need it."
const messageId = 'engine2-diagnostic-user-1'
const result = await planEngine2LlmTurn({
  apiKey: process.env.OPENAI_API_KEY,
  aiSupportEnabled: true,
  input: {
    language: 'en',
    conversation: [{ id: messageId, role: 'user', content: text }],
    lastUserMessageId: messageId,
    replyToGapId: null,
    activeQuestionId: null,
    findings: [],
    questions: [],
    askedQuestionHistory: [],
    userDecisions: [],
    readinessCriteria: {
      materialScore: 'May include pending findings.',
      reportScore: 'Confirmed findings only.',
    },
    remainingTurns: 10,
  },
})

console.log(JSON.stringify({
  input: { language: 'en', messageId, text },
  ok: result.ok,
  delta: result.delta,
  validation: result.validation,
  rawStructuredOutput: result.rawOutput,
  meta: {
    attemptedModel: result.meta?.attemptedModel ?? null,
    modelUsed: result.meta?.modelUsed ?? null,
    errorCategory: result.errorCategory ?? null,
    repairRetry: Boolean(result.meta?.repairRetry),
    attempts: result.attempts.length,
    tokens: result.meta?.tokens ?? null,
  },
}, null, 2))
