import { getSupabaseAdmin } from '../../_lib/supabaseAdmin.js'

const getEnvHost = () => {
  const url = process.env.SUPABASE_URL || ''
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

export const handle = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const countRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id', { count: 'exact', head: true })
    const listRes = await supabaseAdmin
      .schema('public')
      .from('sessions')
      .select('id,user_id,name,created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    const authCountRes = await supabaseAdmin
      .schema('auth')
      .from('sessions')
      .select('id', { count: 'exact', head: true })
    res.status(200).json({
      ok: true,
      diag: {
        supabaseUrl: process.env.SUPABASE_URL || null,
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      errors: {
        publicCountErr: countRes.error
          ? {
              code: countRes.error?.code ?? null,
              message: countRes.error?.message ?? null,
              details: countRes.error?.details ?? null,
              hint: countRes.error?.hint ?? null,
              status: countRes.error?.status ?? null,
            }
          : null,
        authCountErr: authCountRes.error
          ? {
              code: authCountRes.error?.code ?? null,
              message: authCountRes.error?.message ?? null,
              details: authCountRes.error?.details ?? null,
              hint: authCountRes.error?.hint ?? null,
              status: authCountRes.error?.status ?? null,
            }
          : null,
        lastSessionsErr: listRes.error
          ? {
              code: listRes.error?.code ?? null,
              message: listRes.error?.message ?? null,
              details: listRes.error?.details ?? null,
              hint: listRes.error?.hint ?? null,
              status: listRes.error?.status ?? null,
            }
          : null,
      },
      envHost: getEnvHost(),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      countSessions: typeof countRes.count === 'number' ? countRes.count : null,
      countPublicSessions: typeof countRes.count === 'number' ? countRes.count : null,
      countAuthSessions:
        typeof authCountRes.count === 'number' ? authCountRes.count : null,
      lastSessions: listRes.data || null,
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: {
        code: error?.code ?? null,
        message: error?.message ?? 'Request failed',
        details: error?.details ?? null,
      },
    })
  }
}
