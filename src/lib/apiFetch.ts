import { supabase } from './supabase/client'
import { getAuthReady } from './authState'

type ApiFetchOptions = RequestInit & {
  headers?: HeadersInit
}

const waitForAuthReady = async (timeoutMs = 1500) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (getAuthReady()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return getAuthReady()
}

export const apiFetch = async (input: RequestInfo | URL, options: ApiFetchOptions = {}) => {
  const ready = getAuthReady()
  if (!ready) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error('apiFetch called before authReady')
    }
    const resolved = await waitForAuthReady(1500)
    if (!resolved) {
      // Fallback to unauthenticated request to avoid hanging forever.
      const headers = new Headers(options.headers || {})
      const method = (options.method || 'GET').toUpperCase()
      if (method !== 'GET' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      return fetch(input, {
        ...options,
        headers,
      })
    }
  }

  const session = supabase ? await supabase.auth.getSession() : { data: { session: null } }
  const accessToken = session?.data?.session?.access_token || null

  const headers = new Headers(options.headers || {})
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const method = (options.method || 'GET').toUpperCase()
  if (method !== 'GET' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(input, {
    ...options,
    headers,
  })
}
