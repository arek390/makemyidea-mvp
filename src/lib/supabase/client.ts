import { createClient } from '@supabase/supabase-js'

export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

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

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          ...(authStorage ? { storage: authStorage } : {}),
        },
      })
    : null
