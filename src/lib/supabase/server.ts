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
    throw new Error('Missing Supabase env vars for server.')
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, { cookies })
}
