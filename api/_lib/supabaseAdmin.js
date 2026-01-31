import { createClient } from '@supabase/supabase-js'

let cachedSupabaseAdmin = null

export const getSupabaseAdmin = () => {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.')
  }
  cachedSupabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedSupabaseAdmin
}
