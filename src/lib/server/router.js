export const normalizeAction = (value) => String(value || '').trim().toLowerCase()

const pickFirst = (value) => (Array.isArray(value) ? value[0] : value)

export const resolveAction = (req, body) => {
  const queryAction = pickFirst(req.query?.action)
  const urlAction = (() => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      return url.searchParams.get('action')
    } catch {
      return null
    }
  })()
  const bodyAction = body?.action || req.body?.action
  return normalizeAction(queryAction || urlAction || bodyAction)
}

export const resolveQueryValue = (req, key) => {
  const direct = pickFirst(req.query?.[key])
  if (direct != null) return direct
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    return url.searchParams.get(key)
  } catch {
    return null
  }
}

export const isDevEnabled = () => process.env.ENABLE_DEV_ENDPOINTS === 'true'
