import { createClient } from '@supabase/supabase-js'

let cachedSupabaseAdmin = null

const getSupabaseAdmin = () => {
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

const getEnvHost = () => {
  const url = process.env.SUPABASE_URL || ''
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  const sessionId = String(req.query?.sessionId || '').trim()
  if (!sessionId) {
    res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' })
    return
  }
  let data = null
  let error = null
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const resSelect = await supabaseAdmin
      .from('sessions')
      .select('id,user_id,name')
      .eq('id', sessionId)
      .maybeSingle()
    data = resSelect.data || null
    error = resSelect.error || null
  } catch (err) {
    error = err
  }
  res.status(200).json({
    ok: true,
    found: Boolean(data),
    session: data
      ? { id: data.id ?? null, user_id: data.user_id ?? null, name: data.name ?? null }
      : null,
    supabaseError: error
      ? {
          code: error?.code ?? null,
          message: error?.message ?? null,
          details: error?.details ?? null,
        }
      : null,
    envHost: getEnvHost(),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  })
}
