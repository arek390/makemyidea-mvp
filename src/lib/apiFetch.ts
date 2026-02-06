import { supabase } from './supabase/client'

type ApiFetchOptions = RequestInit & {
  headers?: HeadersInit
}

export const apiFetch = async (input: RequestInfo | URL, options: ApiFetchOptions = {}) => {
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
