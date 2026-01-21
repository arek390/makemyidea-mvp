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
import { buildTimeFallbacks } from './_lib/fallbacks.js'

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

  const { productName, count = 15, language = 'English' } = body
  if (!productName) {
    sendError(res, 400, 'MISSING_PRODUCT', 'Missing productName.')
    return
  }

  try {
    assertMaxInput(productName)
  } catch (error) {
    sendError(res, 400, error.code || 'INPUT_TOO_LARGE', 'Input too large.')
    return
  }

  const aiSupportEnabled = resolveAiSupportEnabled(req, body)
  const outputLanguage = String(language || 'English')
  const result = await runLlmTask({
    apiKey: process.env.OPENAI_API_KEY,
    aiSupportEnabled,
    task: 'generate-time-options',
    input: productName,
    language: outputLanguage,
    taskInstructions:
      `Generate ${count} concise observation/time/process options (1-6 words) for product "${productName}". ` +
      `Write ONLY in ${outputLanguage}. Do not use any other language. Output ONLY a JSON array of strings, no extra text.`,
    parseResponse: parseJsonArray,
    fallbackData: buildTimeFallbacks().slice(0, count),
    models: {
      default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
      preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
      escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
    },
    maxOutputTokens: 400,
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
    data: { options: result.data },
    meta: buildMeta(result.meta || { aiSupportEnabled, modelUsed: null }),
  })
}
