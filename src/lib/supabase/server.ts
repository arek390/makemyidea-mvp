/// <reference types="node" />
import { createServerClient } from '@supabase/ssr'

type CookieHandlers = {
  get: (name: string) => string | undefined
  set: (name: string, value: string, options?: Record<string, unknown>) => void
  remove: (name: string, options?: Record<string, unknown>) => void
}

export const createSupabaseServerClient = (cookies: CookieHandlers) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('Auth disabled: missing Supabase env vars for server.')
    }
    return null
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, { cookies })
}
