import crypto from 'crypto'
import { createSupabaseServerClient } from '../supabaseServer.js'
import { getSupabaseAdmin } from '../supabaseAdmin.js'

const ADMIN_EMAIL = 'arektest8@gmail.com'
const MAX_DELTA = 100000

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const requireAdmin = async (req, res) => {
  const supabase = createSupabaseServerClient(req, res)
  const auth = String(req.headers.authorization || '')
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })
    return null
  }
  const { data, error } = await supabase.auth.getUser(token)
  const rawEmail = data?.user?.email ? String(data.user.email) : ''
  const email = rawEmail.trim().toLowerCase()
  if (error || !email || email !== ADMIN_EMAIL) {
    res.status(403).json({ ok: false, error: 'FORBIDDEN' })
    return null
  }
  return data?.user || null
}

export const handleAdminBillingList = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  try {
    const adminUser = await requireAdmin(req, res)
    if (!adminUser) return

    const limitRaw = parseNumber(req.query?.limit, 200)
    const offsetRaw = parseNumber(req.query?.offset, 0)
    const limit = Math.min(Math.max(limitRaw, 1), 500)
    const offset = Math.max(offsetRaw, 0)

    const supabaseAdmin = getSupabaseAdmin()
    const offsetRemainder = offset % limit
    const perPage = Math.min(500, limit + offsetRemainder)
    const page = Math.floor(offset / limit) + 1

    const usersRes = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    })

    if (usersRes.error) {
      console.error('[admin][billing_list] listUsers failed', usersRes.error)
      res.status(500).json({ ok: false, error: usersRes.error.message || 'LIST_USERS_FAILED' })
      return
    }

    const users = usersRes.data?.users || []
    const pagedUsers = offsetRemainder ? users.slice(offsetRemainder) : users
    const userIds = pagedUsers.map((row) => row.id).filter(Boolean)
    let balances = []

    if (userIds.length) {
      const balanceRes = await supabaseAdmin
        .from('billing_accounts')
        .select('user_id, balance_pln')
        .in('user_id', userIds)
      if (balanceRes.error) {
        console.error('[admin][billing_list] billing_accounts failed', balanceRes.error)
        res.status(500).json({ ok: false, error: balanceRes.error.message || 'QUERY_FAILED' })
        return
      }
      balances = balanceRes.data || []
    }

    const balanceByUser = new Map(
      balances.map((row) => [String(row.user_id), Number(row.balance_pln ?? 0)])
    )

    const items = pagedUsers.slice(0, limit).map((row) => ({
      userId: row.id,
      email: row.email || null,
      balancePLN: balanceByUser.get(String(row.id)) ?? 0,
    }))

    res.status(200).json({ ok: true, items })
  } catch (error) {
    console.error('[admin][billing_list] unhandled', error)
    res.status(500).json({
      ok: false,
      error: error?.message || 'SERVER_ERROR',
    })
  }
}

export const handleAdminBillingTopup = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }
  try {
    const adminUser = await requireAdmin(req, res)
    if (!adminUser) return

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
    const adminUserId = adminUser?.id || null
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

const MODEL_PRICING_USD = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
}

const resolveFxUsdPln = () => {
  const raw = Number(process.env.FX_USD_PLN || 0)
  return Number.isFinite(raw) && raw > 0 ? raw : 4.0
}

const calculateCostFromTotalTokens = (tokensTotal) => {
  const total = Number(tokensTotal || 0)
  if (!Number.isFinite(total) || total <= 0) {
    return { costUsd: 0, costPln: 0 }
  }
  const model = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini'
  const pricing = MODEL_PRICING_USD[model]
  const avgRate = pricing ? (pricing.input + pricing.output) / 2 : 0
  const costUsd = (total / 1_000_000) * avgRate
  const costPln = costUsd * resolveFxUsdPln()
  return { costUsd, costPln }
}

export const handleAdminReportList = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  try {
    const adminUser = await requireAdmin(req, res)
    if (!adminUser) return

    const limitRaw = parseNumber(req.query?.limit, 100)
    const offsetRaw = parseNumber(req.query?.offset, 0)
    const limit = Math.min(Math.max(limitRaw, 1), 500)
    const offset = Math.max(offsetRaw, 0)
    const to = offset + limit - 1

    const supabaseAdmin = getSupabaseAdmin()
    const reportRes = await supabaseAdmin
      .schema('public')
      .from('admin_session_report')
      .select('*')
      .order('session_created_at', { ascending: false })
      .range(offset, to)

    if (reportRes.error) {
      res.status(500).json({ ok: false, error: 'QUERY_FAILED' })
      return
    }

    const rows = (reportRes.data || []).map((row) => {
      const tokensTotal = Number(row.tokens_total || 0)
      const costs = calculateCostFromTotalTokens(tokensTotal)
      return {
        ...row,
        cost_usd: costs.costUsd,
        cost_pln: costs.costPln,
      }
    })

    res.status(200).json({
      ok: true,
      rows,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' })
  }
}
