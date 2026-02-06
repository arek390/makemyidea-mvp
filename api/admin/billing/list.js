import { createSupabaseServerClient } from '../../_lib/supabaseServer.js'
import { getSupabaseAdmin } from '../../_lib/supabaseAdmin.js'

const ADMIN_EMAIL = 'arektest8@gmail.com'

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
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

    const limitRaw = parseNumber(req.query?.limit, 200)
    const offsetRaw = parseNumber(req.query?.offset, 0)
    const limit = Math.min(Math.max(limitRaw, 1), 500)
    const offset = Math.max(offsetRaw, 0)
    const to = offset + limit - 1

    const supabaseAdmin = getSupabaseAdmin()
    const usersRes = await supabaseAdmin
      .schema('auth')
      .from('users')
      .select('id, email, created_at')
      .order('created_at', { ascending: false })
      .range(offset, to)

    if (usersRes.error) {
      res.status(500).json({ ok: false, error: 'QUERY_FAILED' })
      return
    }

    const users = usersRes.data || []
    const userIds = users.map((row) => row.id).filter(Boolean)
    let balances = []

    if (userIds.length) {
      const balanceRes = await supabaseAdmin
        .from('billing_accounts')
        .select('user_id, balance_pln')
        .in('user_id', userIds)
      if (balanceRes.error) {
        res.status(500).json({ ok: false, error: 'QUERY_FAILED' })
        return
      }
      balances = balanceRes.data || []
    }

    const balanceByUser = new Map(
      balances.map((row) => [String(row.user_id), Number(row.balance_pln ?? 0)])
    )

    const items = users.map((row) => ({
      user_id: row.id,
      email: row.email,
      balance_pln: balanceByUser.get(String(row.id)) ?? 0,
    }))

    res.status(200).json({ ok: true, items })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' })
  }
}
