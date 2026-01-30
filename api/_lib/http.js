import { createSupabaseServerClient } from './supabaseServer.js'

const MAX_INPUT_CHARS = 10_000
const ADMIN_EMAIL = 'arektest8@gmail.com'

export const readJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export const sendJson = (res, status, payload) => {
  res.status(status).json(payload)
}

export const sendError = (res, status, code, message, meta) => {
  sendJson(res, status, {
    ok: false,
    code,
    message,
    meta,
  })
}

export const assertMaxInput = (value, maxChars = MAX_INPUT_CHARS) => {
  if (String(value || '').length > maxChars) {
    const error = new Error('INPUT_TOO_LARGE')
    error.code = 'INPUT_TOO_LARGE'
    throw error
  }
}

export const resolveAiSupportEnabled = (req, body) => {
  if (process.env.AI_SUPPORT_DISABLED === 'true') return false
  const header = req.headers['x-ai-support']
  const headerValue = Array.isArray(header) ? header[0] : header
  if (typeof headerValue === 'string') {
    const normalized = headerValue.toLowerCase().trim()
    if (['on', 'true', '1', 'yes'].includes(normalized)) return true
    if (['off', 'false', '0', 'no'].includes(normalized)) return false
  }
  if (body && typeof body.aiSupportEnabled === 'boolean') return body.aiSupportEnabled
  return true
}

const resolveHeaderValue = (req, name) => {
  const header =
    req.headers[name] ||
    (typeof req.headers.get === 'function' ? req.headers.get(name) : null)
  const headerValue = Array.isArray(header) ? header[0] : header
  return typeof headerValue === 'string' ? headerValue : null
}

const parseBooleanHeader = (value) => {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().trim()
  if (['on', 'true', '1', 'yes'].includes(normalized)) return true
  if (['off', 'false', '0', 'no'].includes(normalized)) return false
  return null
}

export const resolveDiagnosticsEnabled = async (req, res) => {
  const headerValue = resolveHeaderValue(req, 'x-diagnostics')
  const requested = parseBooleanHeader(headerValue)
  if (!requested) return false
  try {
    const supabase = createSupabaseServerClient(req, res)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user?.email) return false
    return String(data.user.email).toLowerCase() === ADMIN_EMAIL
  } catch {
    return false
  }
}

export const buildMeta = ({ aiSupportEnabled, modelUsed, tokens, escalated }) => {
  const input = Number(tokens?.input ?? 0)
  const output = Number(tokens?.output ?? 0)
  const total = Number(tokens?.total ?? input + output)
  return {
    aiSupportEnabled: Boolean(aiSupportEnabled),
    modelUsed: modelUsed ?? null,
    escalated: Boolean(escalated),
    tokens: { input, output, total },
  }
}

export const mapLlmError = (error) => {
  const message = String(error || '')
  if (message.includes('Rate limit')) {
    return { status: 429, code: 'RATE_LIMIT', message: 'Rate limit exceeded.' }
  }
  if (message.includes('OPENAI_KEY')) {
    return { status: 500, code: 'OPENAI_KEY_MISSING', message: 'OpenAI key not configured.' }
  }
  return { status: 500, code: 'LLM_FAILED', message: 'LLM request failed.' }
}
