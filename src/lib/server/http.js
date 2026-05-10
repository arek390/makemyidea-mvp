import { createClient } from '@supabase/supabase-js'

const MAX_INPUT_CHARS = 10_000

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
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return false
    const url = process.env.SUPABASE_URL || ''
    const anonKey = process.env.SUPABASE_ANON_KEY || ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (!url || !anonKey) return false
    // Use anon client to resolve the authenticated user id from the bearer token.
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data, error } = await authClient.auth.getUser(token)
    const userId = data?.user?.id ? String(data.user.id) : ''
    if (error || !userId) return false
    // Gate diagnostics by presence in admin_users (same rule as the admin panel).
    if (!serviceKey) return false
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })
    const adminCheck = await adminClient
      .schema('public')
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (adminCheck.error || !adminCheck.data?.user_id) return false
    return true
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

export const methodNotAllowed = (res, allowed) => {
  sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed })
}

export const notFound = (res) => {
  sendJson(res, 404, { ok: false, error: 'NOT_FOUND' })
}
