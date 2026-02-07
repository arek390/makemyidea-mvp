export const ENGINE_FX_KEY = 'engine_fx_usdpln_v1'
export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000

type FxCache = { rate: number; updatedAt: number }

export const loadFxCache = (): FxCache | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(ENGINE_FX_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FxCache | null
    if (!parsed || !Number.isFinite(parsed.rate) || !Number.isFinite(parsed.updatedAt)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const saveFxCache = (rate: number, updatedAt = Date.now()) => {
  if (typeof window === 'undefined') return
  if (!Number.isFinite(rate) || rate <= 0) return
  window.sessionStorage.setItem(ENGINE_FX_KEY, JSON.stringify({ rate, updatedAt }))
}

export const getFreshFxRate = () => {
  const cached = loadFxCache()
  if (!cached) return null
  if (Date.now() - cached.updatedAt > FX_CACHE_TTL_MS) return null
  return cached.rate
}

export const fetchFxUsdPlnRate = async (): Promise<number | null> => {
  const cached = loadFxCache()
  if (cached && Date.now() - cached.updatedAt < FX_CACHE_TTL_MS) {
    return cached.rate
  }
  try {
    const response = await fetch('/api/core?action=fx_usdpln')
    const payload = (await response.json()) as {
      ok?: boolean
      usdpln?: number
      updatedAt?: number
    }
    const rate = Number(payload?.usdpln)
    if (response.ok && Number.isFinite(rate) && rate > 0) {
      saveFxCache(rate, payload?.updatedAt ?? Date.now())
      return rate
    }
  } catch {
    // ignore
  }
  return cached?.rate ?? null
}
