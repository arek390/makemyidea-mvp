import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import { grantWelcomeBalance } from '../src/lib/server/billing.js'

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
    try {
      await grantWelcomeBalance(userId, null, 'auth')
    } catch (error) {
      console.error('[auth][welcome_balance] failed', {
        userIdPrefix: String(userId).slice(0, 8),
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
