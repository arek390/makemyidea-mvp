import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction, resolveQueryValue } from '../src/lib/server/router.js'

const FALLBACK_RATE = 3.55
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
let cachedRate = null
let cachedAt = 0

const fetchUsdPln = async () => {
  const response = await fetch('https://api.nbp.pl/api/exchangerates/rates/A/USD?format=json')
  if (!response.ok) {
    throw new Error(`NBP_FETCH_FAILED:${response.status}`)
  }
  const payload = await response.json()
  const rate = Number(payload?.rates?.[0]?.mid)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('NBP_RATE_INVALID')
  }
  return rate
}

const handleHealth = (req, res, body) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const scope = String(resolveQueryValue(req, 'scope') || body?.scope || '').trim().toLowerCase()
  if (scope === 'ping') {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() })
    return
  }
  if (scope === 'llm') {
    sendJson(res, 200, {
      ok: true,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      aiSupportEnabled: process.env.AI_SUPPORT_DISABLED !== 'true',
    })
    return
  }
  sendJson(res, 200, { ok: true, hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY) })
}

const handlePing = (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  sendJson(res, 200, { ok: true, time: new Date().toISOString() })
}

const handleVersion = (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  sendJson(res, 200, {
    ok: true,
    version: process.env.APP_VERSION || process.env.npm_package_version || null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
  })
}

const handleFxUsdPln = async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const now = Date.now()
  const cacheValid = cachedRate && now - cachedAt < CACHE_TTL_MS
  if (cacheValid) {
    sendJson(res, 200, {
      ok: true,
      usdpln: cachedRate,
      source: 'cache',
      updatedAt: cachedAt,
      ttlMs: CACHE_TTL_MS,
    })
    return
  }
  try {
    const rate = await fetchUsdPln()
    cachedRate = rate
    cachedAt = now
    sendJson(res, 200, {
      ok: true,
      usdpln: rate,
      source: 'live',
      updatedAt: cachedAt,
      ttlMs: CACHE_TTL_MS,
    })
  } catch (error) {
    if (cachedRate) {
      sendJson(res, 200, {
        ok: true,
        usdpln: cachedRate,
        source: 'cache',
        updatedAt: cachedAt,
        ttlMs: CACHE_TTL_MS,
        warning: String(error?.message || error),
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      usdpln: FALLBACK_RATE,
      source: 'fallback',
      updatedAt: now,
      ttlMs: CACHE_TTL_MS,
      warning: String(error?.message || error),
    })
  }
}

const handleFeedbackSend = async (req, res, body) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const requestId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `fb-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from) {
    console.error('[feedback-email] missing env', {
      requestId,
      hasApiKey: Boolean(apiKey),
      hasFrom: Boolean(from),
    })
    sendJson(res, 500, { ok: false, error: 'EMAIL_NOT_CONFIGURED', requestId })
    return
  }

  const getClientIp = (r) => {
    const raw = r.headers['x-forwarded-for']
    const header = Array.isArray(raw) ? raw[0] : raw
    if (typeof header === 'string' && header.trim()) {
      return header.split(',')[0].trim()
    }
    return r.socket?.remoteAddress || 'unknown'
  }

  const rateState = handleFeedbackSend.rateState || new Map()
  handleFeedbackSend.rateState = rateState
  const RATE_WINDOW_MS = 60_000
  const RATE_MAX = 3
  const MIN_INTERVAL_MS = 30_000

  const checkRateLimit = (ip) => {
    const now = Date.now()
    const entry = rateState.get(ip)
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      rateState.set(ip, { windowStart: now, count: 0, lastSentAt: 0 })
    }
    const current = rateState.get(ip)
    if (!current) return { allowed: true }
    const sinceLast = now - (current.lastSentAt || 0)
    if (current.lastSentAt && sinceLast < MIN_INTERVAL_MS) {
      return { allowed: false, retryAfter: Math.ceil((MIN_INTERVAL_MS - sinceLast) / 1000) }
    }
    if (current.count >= RATE_MAX) {
      const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - current.windowStart)) / 1000)
      return { allowed: false, retryAfter: Math.max(1, retryAfter) }
    }
    current.count += 1
    current.lastSentAt = now
    rateState.set(ip, current)
    return { allowed: true }
  }

  const resolveSubject = (lang) => {
    const normalized = String(lang || '').toLowerCase()
    if (normalized.startsWith('pl')) return 'MakeMyIdea.work – Feedback'
    return 'MakeMyIdea.work – Feedback'
  }

  if (!body) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON', requestId })
    return
  }

  const ip = getClientIp(req)
  const rate = checkRateLimit(ip)
  if (!rate.allowed) {
    sendJson(res, 429, {
      ok: false,
      error: 'RATE_LIMITED',
      retryAfter: rate.retryAfter,
      requestId,
    })
    return
  }

  const honeypot = String(body.website || '').trim()
  if (honeypot) {
    sendJson(res, 400, { ok: false, error: 'HONEYPOT', requestId })
    return
  }

  const message = String(body.message || '').trim()
  if (!message || message.length < 10) {
    sendJson(res, 400, { ok: false, error: 'MESSAGE_TOO_SHORT', requestId })
    return
  }
  if (message.length > 4000) {
    sendJson(res, 400, { ok: false, error: 'MESSAGE_TOO_LONG', requestId })
    return
  }

  let userEmail = null
  try {
    const supabase = createSupabaseServerClient(req, res)
    const { data } = await supabase.auth.getUser()
    userEmail = data?.user?.email || null
  } catch {
    userEmail = null
  }

  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {}
  const timestamp = new Date().toISOString()
  const subject = resolveSubject(meta.lang)
  const route = meta.page || null
  const sessionId = meta.sessionId || null
  const userAgent = req.headers['user-agent'] || null

  const text = [
    message,
    '',
    '---',
    `Timestamp: ${timestamp}`,
    `User email: ${userEmail || 'n/a'}`,
    `Route: ${route || 'n/a'}`,
    `Session ID: ${sessionId || 'n/a'}`,
    `Language: ${meta.lang || 'n/a'}`,
    `User agent: ${userAgent || 'n/a'}`,
  ].join('\n')

  const toEmail = process.env.FEEDBACK_TO_EMAIL || 'makemyideawork@aremai.tech'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        text,
        reply_to: userEmail || undefined,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[feedback-email] failed', {
        requestId,
        status: response.status,
        errorText: errorText.slice(0, 300),
      })
      sendJson(res, 502, { ok: false, error: 'EMAIL_SEND_FAILED', requestId })
      return
    }

    console.log('[feedback-email] sent', { requestId, len: message.length })
    sendJson(res, 200, { ok: true, requestId })
  } catch (error) {
    console.error('[feedback-email] failed', {
      requestId,
      name: error?.name,
      message: error?.message,
    })
    sendJson(res, 500, { ok: false, error: 'EMAIL_SEND_FAILED', requestId })
  }
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'health') {
    handleHealth(req, res, body)
    return
  }
  if (action === 'ping') {
    handlePing(req, res)
    return
  }
  if (action === 'version') {
    handleVersion(req, res)
    return
  }
  if (action === 'fx_usdpln') {
    await handleFxUsdPln(req, res)
    return
  }
  if (action === 'feedback_send') {
    await handleFeedbackSend(req, res, body)
    return
  }
  notFound(res)
}
