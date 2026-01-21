import { runLlmTask, parseJsonArray, createRateLimiter } from '../llm/llmRouter.mjs'
import {
  assertMaxInput,
  buildMeta,
  mapLlmError,
  readJsonBody,
  resolveAiSupportEnabled,
  sendError,
  sendJson,
} from './_lib/http.js'
import { buildNameFallbacks } from './_lib/fallbacks.js'

const limiter = createRateLimiter({ windowMs: 60_000, max: 30 })

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }

  const body = await readJsonBody(req)
  if (!body) {
    sendError(res, 400, 'INVALID_JSON', 'Invalid JSON body.')
    return
  }

  const { description, count = 5 } = body
  if (!description) {
    sendError(res, 400, 'MISSING_DESCRIPTION', 'Missing description.')
    return
  }

  try {
    assertMaxInput(description)
  } catch (error) {
    sendError(res, 400, error.code || 'INPUT_TOO_LARGE', 'Input too large.')
    return
  }

  const aiSupportEnabled = resolveAiSupportEnabled(req, body)
  const result = await runLlmTask({
    apiKey: process.env.OPENAI_API_KEY,
    aiSupportEnabled,
    task: 'generate-names',
    input: description,
    language: 'English',
    taskInstructions:
      `Generate ${count} short, brandable product names (1-3 words) based on this description. ` +
      'Avoid punctuation. Output ONLY a JSON array of strings, no extra text.',
    parseResponse: parseJsonArray,
    fallbackData: buildNameFallbacks(description, count),
    models: {
      default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
      preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
      escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
    },
    maxOutputTokens: 300,
    rateLimiter: limiter,
    rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
  })

  if (!result.ok) {
    const mapped = mapLlmError(result.error)
    sendError(res, mapped.status, mapped.code, mapped.message, result.meta)
    return
  }

  sendJson(res, 200, {
    ok: true,
    data: { names: result.data },
    meta: buildMeta(result.meta || { aiSupportEnabled, modelUsed: null }),
  })
}
