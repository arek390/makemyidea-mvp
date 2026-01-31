import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

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
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const countRes = await supabaseAdmin.from('sessions').select('id', { count: 'exact', head: true })
    if (countRes.error) {
      res.status(500).json({
        ok: false,
        error: {
          code: countRes.error?.code ?? null,
          message: countRes.error?.message ?? null,
          details: countRes.error?.details ?? null,
        },
      })
      return
    }
    const listRes = await supabaseAdmin
      .from('sessions')
      .select('id,user_id,name,created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (listRes.error) {
      res.status(500).json({
        ok: false,
        error: {
          code: listRes.error?.code ?? null,
          message: listRes.error?.message ?? null,
          details: listRes.error?.details ?? null,
        },
      })
      return
    }
    res.status(200).json({
      ok: true,
      envHost: getEnvHost(),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      countSessions: typeof countRes.count === 'number' ? countRes.count : 0,
      lastSessions: listRes.data || [],
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
