import { runLlmTask, parseJsonArray, parseJsonObject, createRateLimiter } from '../llm/llmRouter.mjs'
import {
  assertMaxInput,
  buildMeta,
  mapLlmError,
  readJsonBody,
  resolveAiSupportEnabled,
  sendError,
  sendJson,
} from './_lib/http.js'
import {
  buildIdeaFallbacks,
  buildNameFallbacks,
  buildSpaceFallbacks,
  buildTimeFallbacks,
} from './_lib/fallbacks.js'

const limiter = createRateLimiter({ windowMs: 60_000, max: 30 })

const resolveAction = (req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  return String(url.searchParams.get('action') || '').trim().toLowerCase()
}

const buildModels = () => ({
  default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
  preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
  escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
})

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }

  const action = resolveAction(req)
  if (!action) {
    sendJson(res, 400, { ok: false, error: 'INVALID_ACTION' })
    return
  }

  const body = await readJsonBody(req)
  if (!body) {
    sendError(res, 400, 'INVALID_JSON', 'Invalid JSON body.')
    return
  }

  if (action === 'ideas') {
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
      models: buildModels(),
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
    return
  }

  if (action === 'names') {
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
      models: buildModels(),
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
    return
  }

  if (action === 'space-options') {
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
      models: buildModels(),
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
    return
  }

  if (action === 'time-options') {
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
      models: buildModels(),
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
    return
  }

  sendJson(res, 400, { ok: false, error: 'INVALID_ACTION' })
}
