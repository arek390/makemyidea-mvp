import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'

const handleMe = async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  try {
    const supabase = createSupabaseServerClient(req, res)
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const userId = data.user.id
    const userIdPrefix = String(userId).slice(0, 8)
    try {
      console.log('[auth][welcome_balance] attempt', { userIdPrefix })
      const supabaseAdmin = getSupabaseAdmin()
      const grantRes = await supabaseAdmin.rpc('grant_welcome_balance', { p_user_id: userId })
      if (grantRes.error) {
        console.error('[auth][welcome_balance] failed', {
          userIdPrefix,
          message: grantRes.error?.message ?? null,
          code: grantRes.error?.code ?? null,
        })
      } else {
        const row = Array.isArray(grantRes.data) ? grantRes.data[0] : grantRes.data
        const granted = Boolean(row?.granted)
        const amountMinor = Number(row?.amount_pln_grosze ?? 0)
        const balanceAfterMinor = Number(row?.balance_after_pln_grosze ?? 0)
        console.log(granted ? '[auth][welcome_balance] granted' : '[auth][welcome_balance] already_or_skipped', {
          userIdPrefix,
          granted,
          amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0,
          balanceAfterMinor: Number.isFinite(balanceAfterMinor) ? balanceAfterMinor : 0,
        })
      }
    } catch (error) {
      console.error('[auth][welcome_balance] failed', {
        userIdPrefix,
        message: error?.message ?? null,
        code: error?.code ?? null,
      })
    }
    res.status(200).json({
      ok: true,
      user: {
        id: userId,
        email: data.user.email || null,
      },
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' })
  }
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'me') {
    await handleMe(req, res)
    return
  }
  notFound(res)
}
