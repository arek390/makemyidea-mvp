import { sendJson } from '../_lib/http.js'

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

const resolveAction = (req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  return String(url.searchParams.get('action') || '').trim().toLowerCase()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  const action = resolveAction(req)
  if (action !== 'usdpln') {
    sendJson(res, 400, { ok: false, error: 'INVALID_ACTION' })
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
