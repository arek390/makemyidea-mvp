import { createClient } from '@supabase/supabase-js'

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
  // eslint-disable-next-line no-console
  console.warn('Missing Supabase env vars for client.')
}

const resolveAuthStorage = () => {
  if (typeof window === 'undefined') return undefined
  return window.localStorage
}

const authStorage = resolveAuthStorage()

let supabaseClient: ReturnType<typeof createClient> | null = null

if (supabaseUrl && supabaseAnonKey) {
  try {
    const parsed = new URL(supabaseUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      supabaseInitError = 'invalid_supabase_url_protocol'
    } else {
      supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          ...(authStorage ? { storage: authStorage } : {}),
        },
      })
    }
  } catch {
    supabaseInitError = 'invalid_supabase_url'
  }
}

export const supabase = supabaseClient

export const getSupabaseInitError = () => supabaseInitError
