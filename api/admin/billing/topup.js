import crypto from 'crypto'
import { createSupabaseServerClient } from '../../_lib/supabaseServer.js'
import { getSupabaseAdmin } from '../../_lib/supabaseAdmin.js'

const ADMIN_EMAIL = 'arektest8@gmail.com'
const MAX_DELTA = 100000

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }
  try {
    const supabase = createSupabaseServerClient(req, res)
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
      return
    }
    const { data, error } = await supabase.auth.getUser(token)
    const rawEmail = data?.user?.email ? String(data.user.email) : ''
    const email = rawEmail.trim().toLowerCase()
    if (error || !email || email !== ADMIN_EMAIL) {
      res.status(403).json({ ok: false, error: 'FORBIDDEN' })
      return
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const targetUserId = String(body?.targetUserId || '').trim()
    const deltaRaw = Number(body?.deltaPLN)
    if (!targetUserId) {
      res.status(400).json({ ok: false, error: 'MISSING_TARGET_USER' })
      return
    }
    if (!Number.isFinite(deltaRaw) || deltaRaw <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_DELTA' })
      return
    }
    if (deltaRaw > MAX_DELTA) {
      res.status(400).json({ ok: false, error: 'DELTA_TOO_LARGE' })
      return
    }

    const requestId = crypto.randomUUID()
    const adminUserId = data?.user?.id || null
    const supabaseAdmin = getSupabaseAdmin()
    const rpcRes = await supabaseAdmin.rpc('admin_increment_balance', {
      target_user: targetUserId,
      delta_pln: deltaRaw,
      request_id: requestId,
      admin_user: adminUserId,
    })

    if (rpcRes.error) {
      res.status(400).json({ ok: false, error: rpcRes.error.message || 'RPC_FAILED' })
      return
    }

    const payload = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data
    const balanceAfter = Number(payload?.balance_after ?? 0)
    const balanceBefore = Number(payload?.balance_before ?? 0)

    res.status(200).json({
      ok: true,
      balanceBefore,
      balanceAfter,
      requestId,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' })
  }
}
