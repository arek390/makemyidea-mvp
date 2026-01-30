import { createSupabaseServerClient } from '../_lib/supabaseServer.js'
import { readJsonBody, sendJson } from '../_lib/http.js'

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 3
const MIN_INTERVAL_MS = 30_000

const rateState = new Map()

const getClientIp = (req) => {
  const raw = req.headers['x-forwarded-for']
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header === 'string' && header.trim()) {
    return header.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

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

export default async function handler(req, res) {
  const requestId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `fb-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
      allowed: ['POST'],
      requestId,
    })
    return
  }

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

  const body = await readJsonBody(req)
  if (!body) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON', requestId })
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

  const toEmail = process.env.FEEDBACK_TO_EMAIL || 'arektest8@gmail.com'

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
