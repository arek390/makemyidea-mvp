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
import { buildIdeaFallbacks } from './_lib/fallbacks.js'

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

  const { productName, cells = [], ideasPerCell = 3 } = body
  if (!productName || !Array.isArray(cells) || !cells.length) {
    sendError(res, 400, 'MISSING_FIELDS', 'Missing productName or cells.')
    return
  }

  const promptCells = cells
    .map((cell) => `- ${cell.id}: space="${cell.spaceDef}", level="${cell.timeDef}"`)
    .join('\n')

  try {
    assertMaxInput(`${productName}\n${promptCells}`)
  } catch (error) {
    sendError(res, 400, error.code || 'INPUT_TOO_LARGE', 'Input too large.')
    return
  }

  const aiSupportEnabled = resolveAiSupportEnabled(req, body)
  const result = await runLlmTask({
    apiKey: process.env.OPENAI_API_KEY,
    aiSupportEnabled,
    task: 'generate-ideas',
    input: `${productName}\n${promptCells}`,
    language: 'English',
    taskInstructions:
      `Generate ${ideasPerCell} concise ideas (max 50 words each) for each cell for product "${productName}". ` +
      'Each idea must relate to both the space and observation level. ' +
      'Return ONLY a JSON object where keys are cell ids and values are arrays of ideas.',
    parseResponse: parseJsonObject,
    fallbackData: buildIdeaFallbacks(cells, ideasPerCell),
    models: {
      default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
      preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
      escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
    },
    maxOutputTokens: 1200,
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
    data: { ideas: result.data },
    meta: buildMeta(result.meta || { aiSupportEnabled, modelUsed: null }),
  })
}
