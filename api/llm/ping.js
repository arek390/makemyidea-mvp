import { runLlmTask, parseJsonArray, createRateLimiter } from '../../llm/llmRouter.mjs'
import {
  buildMeta,
  mapLlmError,
  readJsonBody,
  resolveAiSupportEnabled,
  sendError,
  sendJson,
} from '../_lib/http.js'

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 })

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

  const aiSupportEnabled = resolveAiSupportEnabled(req, body)
  if (!aiSupportEnabled) {
    sendError(res, 403, 'AI_DISABLED', 'AI support disabled.')
    return
  }

  const result = await runLlmTask({
    apiKey: process.env.OPENAI_API_KEY,
    aiSupportEnabled: true,
    task: 'llm-ping',
    input: 'Ping the model. Respond with a JSON array containing a single string: \"pong\".',
    language: 'English',
    taskInstructions: 'Return ONLY a JSON array of strings.',
    parseResponse: parseJsonArray,
    fallbackData: [],
    models: {
      default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
      preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
      escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
    },
    maxOutputTokens: 50,
    rateLimiter: limiter,
    rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
  })

  if (!result.ok) {
    const mapped = mapLlmError(result.error)
    sendError(res, mapped.status, mapped.code, mapped.message, result.meta)
    return
  }

  const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
  sendJson(res, 200, {
    ok: true,
    data: { pong: true },
    meta,
    usage: {
      model: meta.modelUsed,
      tokensIn: meta.tokens.input,
      tokensOut: meta.tokens.output,
    },
  })
}
