import { runLlmTask, parseJsonObject, createRateLimiter } from '../llm/llmRouter.mjs'
import {
  assertMaxInput,
  buildMeta,
  mapLlmError,
  readJsonBody,
  resolveAiSupportEnabled,
  sendError,
  sendJson,
} from './_lib/http.js'
import { buildSpaceFallbacks } from './_lib/fallbacks.js'

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

  const {
    productName,
    description = '',
    worldCount = 10,
    elementCount = 10,
    language = 'English',
  } = body

  if (!productName) {
    sendError(res, 400, 'MISSING_PRODUCT', 'Missing productName.')
    return
  }

  try {
    assertMaxInput(`${productName}\n${description}`)
  } catch (error) {
    sendError(res, 400, error.code || 'INPUT_TOO_LARGE', 'Input too large.')
    return
  }

  const aiSupportEnabled = resolveAiSupportEnabled(req, body)
  const outputLanguage = String(language || 'English')
  const result = await runLlmTask({
    apiKey: process.env.OPENAI_API_KEY,
    aiSupportEnabled,
    task: 'generate-space-options',
    input: `${productName}\n${description}`,
    language: outputLanguage,
    taskInstructions:
      `Product: "${productName}". Description: "${description}".\n\nTask:\n` +
      `1) Generate ${worldCount} options for where this product can exist, be used, or be found (near context and broader context). These are for the "World" category.\n` +
      `2) Generate ${elementCount} options describing components, materials, subassemblies, or parts the product can be made of. These are for the "Elements" category.\n\n` +
      `Requirements:\n- Write ONLY in ${outputLanguage}.\n- Each option 1-6 words.\n- Return ONLY a JSON object: {"worldOptions":[...],"elementOptions":[...]}\n- No extra text.`,
    parseResponse: (value) => {
      const parsed = parseJsonObject(value)
      if (!parsed || !Array.isArray(parsed.worldOptions) || !Array.isArray(parsed.elementOptions)) {
        return null
      }
      return parsed
    },
    fallbackData: buildSpaceFallbacks(productName),
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
    data: {
      worldOptions: result.data.worldOptions,
      elementOptions: result.data.elementOptions,
    },
    meta: buildMeta(result.meta || { aiSupportEnabled, modelUsed: null }),
  })
}
