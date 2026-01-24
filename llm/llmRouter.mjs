import {
  BASE_SYSTEM_PROMPT,
  PREPROCESS_SYSTEM_PROMPT,
  buildPreprocessUserPrompt,
  buildGenerationUserPrompt,
} from './llmPrompts.mjs'
import { callOpenAIChat } from '../api/_lib/openaiClient.js'

const DEFAULT_MODELS = {
  default: 'gpt-4.1-mini',
  preprocess: 'gpt-5-nano',
  escalation: 'gpt-5-mini',
}

const MAX_INPUT_CHARS = 10_000
const DEFAULT_TIMEOUT_MS = 18_000

const estimateTokens = (value) => Math.ceil(String(value || '').length / 4)
const buildEmptyUsage = () => ({ input: 0, output: 0, total: 0 })
const mergeUsage = (current, usage) => {
  if (!usage) return current
  const input = Number(usage.prompt_tokens ?? 0)
  const output = Number(usage.completion_tokens ?? 0)
  const total = Number(usage.total_tokens ?? input + output)
  return {
    input: current.input + input,
    output: current.output + output,
    total: current.total + total,
  }
}

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const normalizeString = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const truncateInput = (value, maxChars = MAX_INPUT_CHARS) =>
  String(value || '').slice(0, maxChars)

export const parseJsonArray = (value) => {
  const parsed = safeJsonParse(value)
  return Array.isArray(parsed) ? parsed : null
}

export const parseJsonObject = (value) => {
  const parsed = safeJsonParse(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
}

export const createRateLimiter = ({ windowMs = 60_000, max = 30 } = {}) => {
  const hits = new Map()
  return (key) => {
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now > entry.resetAt) {
      const next = { count: 1, resetAt: now + windowMs }
      hits.set(key, next)
      return { allowed: true, remaining: max - 1, resetAt: next.resetAt }
    }
    if (entry.count >= max) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt }
    }
    entry.count += 1
    return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt }
  }
}

const resolvePreprocess = (raw, fallbackInput) => {
  const parsed = parseJsonObject(raw)
  if (!parsed) {
    return {
      cleaned_input: fallbackInput,
      summary: '',
      route: { escalate: false, confidence: 0.6, reason: 'preprocess_invalid' },
      needs_clarification: false,
      constraint_count: 0,
      valid: false,
    }
  }
  const cleaned = normalizeString(parsed.cleaned_input || fallbackInput)
  const summary = normalizeString(parsed.summary || '')
  const route = parsed.route && typeof parsed.route === 'object'
    ? {
        escalate: Boolean(parsed.route.escalate),
        confidence: Number(parsed.route.confidence ?? 0),
        reason: normalizeString(parsed.route.reason || ''),
      }
    : { escalate: false, confidence: 0.6, reason: 'preprocess_missing_route' }
  return {
    cleaned_input: cleaned || fallbackInput,
    summary,
    route,
    needs_clarification: Boolean(parsed.needs_clarification),
    constraint_count: Number(parsed.constraint_count ?? 0),
    valid: true,
  }
}

const shouldEscalate = ({ cleanedInput, preprocess }) => {
  const tokenEstimate = estimateTokens(cleanedInput)
  if (cleanedInput.length > 1200 || tokenEstimate > 400) return true
  if (preprocess.route?.escalate) return true
  if (preprocess.route?.confidence != null && preprocess.route.confidence < 0.5) return true
  if (preprocess.needs_clarification) return true
  if (preprocess.constraint_count && preprocess.constraint_count > 6) return true
  return false
}

export const runLlmTask = async ({
  apiKey,
  aiSupportEnabled,
  task,
  input,
  language = 'English',
  taskInstructions,
  parseResponse,
  fallbackData,
  models = DEFAULT_MODELS,
  maxOutputTokens = 800,
  preprocessTokens = 220,
  temperature = 0.7,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  rateLimiter,
  rateLimitKey,
}) => {
  if (!aiSupportEnabled) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ai] LLM skipped: aiSupport=off', { task })
    }
    return {
      ok: true,
      data: fallbackData,
      meta: { aiSupportEnabled: false, modelUsed: null, escalated: false, tokens: buildEmptyUsage() },
    }
  }

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ai] llm decision', { willCallLLM: false, reason: 'missing_api_key', task })
    }
    return {
      ok: false,
      error: 'OPENAI_API_KEY is not set on the server.',
      meta: { aiSupportEnabled: true, modelUsed: null, escalated: false, tokens: buildEmptyUsage() },
    }
  }

  if (rateLimiter && rateLimitKey) {
    const rate = rateLimiter(rateLimitKey)
    if (!rate.allowed) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[ai] llm decision', { willCallLLM: false, reason: 'rate_limited', task })
      }
      return {
        ok: false,
        error: 'Rate limit exceeded.',
        meta: { aiSupportEnabled: true, modelUsed: null, escalated: false, tokens: buildEmptyUsage() },
      }
    }
  }

  const safeInput = truncateInput(input)
  const preprocessMessages = [
    { role: 'system', content: PREPROCESS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildPreprocessUserPrompt({
        task,
        input: safeInput,
        language,
      }),
    },
  ]

  let preprocess = {
    cleaned_input: normalizeString(safeInput),
    summary: '',
    route: { escalate: false, confidence: 0.6, reason: 'preprocess_failed' },
    needs_clarification: false,
    constraint_count: 0,
    valid: false,
  }
  let usageTotals = buildEmptyUsage()
  let preprocessSucceeded = false
  try {
    const result = await callOpenAIChat({
      apiKey,
      model: models.preprocess,
      messages: preprocessMessages,
      maxTokens: preprocessTokens,
      temperature: 0.2,
      timeoutMs,
    })
    usageTotals = mergeUsage(usageTotals, result.usage)
    preprocess = resolvePreprocess(result.content, preprocess.cleaned_input)
    preprocessSucceeded = preprocess.valid
  } catch {
    preprocessSucceeded = false
  }

  const cleanedInput = preprocess.cleaned_input || normalizeString(safeInput)
  const summary = preprocess.summary
  const escalated = preprocessSucceeded ? shouldEscalate({ cleanedInput, preprocess }) : false
  const primaryModel = escalated ? models.escalation : models.default
  if (process.env.NODE_ENV !== 'production') {
    console.log('[ai] llm decision', {
      willCallLLM: true,
      reason: escalated ? 'escalated' : 'default',
      modelChosen: primaryModel,
      task,
    })
  }

  const buildMessages = () => [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildGenerationUserPrompt({
        task,
        cleanedInput,
        summary,
        instructions: taskInstructions,
        language,
      }),
    },
  ]

  const runGeneration = async (model) => {
    const result = await callOpenAIChat({
      apiKey,
      model,
      messages: buildMessages(),
      maxTokens: maxOutputTokens,
      temperature,
      timeoutMs,
    })
    const parsed = parseResponse(result.content)
    if (!parsed) {
      const error = new Error('Invalid model response.')
      error.usage = result.usage
      throw error
    }
    return { parsed, usage: result.usage, model }
  }

  try {
    const result = await runGeneration(primaryModel)
    usageTotals = mergeUsage(usageTotals, result.usage)
    return {
      ok: true,
      data: result.parsed,
      meta: {
        aiSupportEnabled: true,
        modelUsed: result.model,
        escalated,
        tokens: usageTotals,
      },
    }
  } catch (error) {
    if (error?.usage) {
      usageTotals = mergeUsage(usageTotals, error.usage)
    }
    if (escalated) {
      try {
        const fallback = await runGeneration(models.default)
        usageTotals = mergeUsage(usageTotals, fallback.usage)
        return {
          ok: true,
          data: fallback.parsed,
          meta: {
            aiSupportEnabled: true,
            modelUsed: fallback.model,
            escalated: false,
            tokens: usageTotals,
          },
        }
      } catch (fallbackError) {
        if (fallbackError?.usage) {
          usageTotals = mergeUsage(usageTotals, fallbackError.usage)
        }
        return {
          ok: false,
          error: String(fallbackError),
          meta: { aiSupportEnabled: true, modelUsed: null, escalated: true, tokens: usageTotals },
        }
      }
    }
    return {
      ok: false,
      error: String(error),
      meta: { aiSupportEnabled: true, modelUsed: null, escalated: false, tokens: usageTotals },
    }
  }
}
