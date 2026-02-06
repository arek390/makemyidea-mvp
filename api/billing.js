import { createSupabaseServerClient } from '../src/lib/server/supabaseServer.js'
import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'

const handleBalance = async (req, res) => {
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
    const { data: account, error: accountError } = await supabase
      .from('billing_accounts')
      .select('balance_pln')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (accountError) {
      res.status(500).json({ ok: false, error: accountError.message || 'QUERY_FAILED' })
      return
    }
    const balance = Number(account?.balance_pln ?? 0)
    res.status(200).json({
      ok: true,
      balancePLN: Number.isFinite(balance) ? balance : 0,
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
  if (action === 'balance') {
    await handleBalance(req, res)
    return
  }
  notFound(res)
}
