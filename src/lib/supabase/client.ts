import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const rawSupabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabaseUrl = rawSupabaseUrl
const supabaseAnonKey = rawSupabaseAnon

export const supabaseEnvDiag = {
  hasUrl: Boolean(rawSupabaseUrl),
  hasAnon: Boolean(rawSupabaseAnon),
  urlLen: rawSupabaseUrl.length,
  anonLen: rawSupabaseAnon.length,
}

// Keep in sync with package-lock.json to help runtime auth diagnostics.
export const SUPABASE_JS_VERSION = '2.91.0'

let supabaseInitError: string | null = null

console.info('[diag] supabase env', {
  mode: import.meta.env.MODE,
  prod: import.meta.env.PROD,
  dev: import.meta.env.DEV,
  hasUrl: supabaseEnvDiag.hasUrl,
  hasAnon: supabaseEnvDiag.hasAnon,
  urlLen: supabaseEnvDiag.urlLen,
  anonLen: supabaseEnvDiag.anonLen,
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  console.log('[diag] supabase config', {
    url: supabaseUrl,
    anonKeyPresent: Boolean(supabaseAnonKey),
    anonKeyPrefix: supabaseAnonKey ? supabaseAnonKey.slice(0, 8) : null,
    origin: window.location.origin,
  })
  console.log('[diag] supabase auth opts', {
    origin: window.location.origin,
    ua: window.navigator.userAgent,
  })
}

if (!supabaseUrl || !supabaseAnonKey) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn('Auth disabled: missing Supabase env vars for client.')
  }
}

const resolveAuthStorage = () => {
  if (typeof window === 'undefined') return undefined
  return window.localStorage
}

const authStorage = resolveAuthStorage()

let supabaseClient: SupabaseClient<Database> | null = null

if (supabaseUrl && supabaseAnonKey) {
  try {
    const parsed = new URL(supabaseUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      supabaseInitError = 'invalid_supabase_url_protocol'
    } else {
      const authOptions = {
        auth: {
          flowType: 'pkce',
          // We handle PKCE callback exchange explicitly on /auth/callback.
          // Keeping this true can cause an automatic exchange during client init,
          // which then makes a manual exchange fail with pkce_code_verifier_not_found.
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
          ...(authStorage ? { storage: authStorage } : {}),
        },
      }
      if (typeof window !== 'undefined') {
        console.info('[diag] supabase auth config', {
          flowType: (authOptions as any).auth.flowType,
          detectSessionInUrl: (authOptions as any).auth.detectSessionInUrl,
          persistSession: (authOptions as any).auth.persistSession,
          autoRefreshToken: (authOptions as any).auth.autoRefreshToken,
          storage: (authOptions as any).auth.storage === window.localStorage ? 'window.localStorage' : 'custom',
        })
      }
      supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, authOptions as any)
    }
  } catch {
    supabaseInitError = 'invalid_supabase_url'
  }
}

export const supabase = supabaseClient

export const getSupabaseInitError = () => supabaseInitError
