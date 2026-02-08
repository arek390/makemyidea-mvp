import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../supabaseAdmin.js'

const MAX_DELTA = 100000

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const resolveBackendSupabaseHost = () => {
  try {
    const url = process.env.SUPABASE_URL
    if (!url) return null
    return new URL(url).hostname
  } catch {
    return null
  }
}

const resolveEnvDebug = () => ({
  hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
  hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
  hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  vercelEnv: process.env.VERCEL_ENV || null,
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
})

const decodeJwtPayload = (token) => {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padLength = padded.length % 4
    const normalized = padLength === 0 ? padded : padded + '='.repeat(4 - padLength)
    const decoded = Buffer.from(normalized, 'base64').toString('utf-8')
    const json = JSON.parse(decoded)
    return {
      iss: json.iss ?? null,
      sub: json.sub ?? null,
      exp: json.exp ?? null,
      iat: json.iat ?? null,
      session_id: json.session_id ?? json.sid ?? null,
      aud: json.aud ?? null,
    }
  } catch {
    return null
  }
}

const readAuthorizationHeader = (req) => {
  const direct = req?.headers?.authorization
  if (typeof direct === 'string') return direct
  if (direct && typeof direct.get === 'function') {
    const value = direct.get('authorization')
    if (typeof value === 'string') return value
  }
  const headers = req?.headers || {}
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === 'authorization') {
      return Array.isArray(value) ? value[0] : String(value || '')
    }
  }
  return ''
}

const readBearerToken = (req) => {
  const auth = String(readAuthorizationHeader(req) || '')
  if (!auth) return ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7)
  return ''
}

const requireAuthUser = async (req, res) => {
  const token = readBearerToken(req)
  if (!token) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED', reason: 'NO_TOKEN' })
    return null
  }
  console.log('auth_check', { hasAuthHeader: Boolean(token), tokenLen: token.length })

  const supabaseUrl = process.env.SUPABASE_URL || ''
  const anonKey = process.env.SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !anonKey) {
    res.status(500).json({ ok: false, error: 'MISSING_SUPABASE_ENV' })
    return null
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      res.status(401).json({
        ok: false,
        error: 'UNAUTHORIZED',
        reason: 'INVALID_TOKEN',
        details: text || String(response.status),
      })
      return null
    }
    const payload = await response.json().catch(() => null)
    const userId = payload?.id ?? payload?.user?.id ?? null
    const email = payload?.email ?? payload?.user?.email ?? null
    if (!userId) {
      res.status(401).json({
        ok: false,
        error: 'UNAUTHORIZED',
        reason: 'INVALID_TOKEN',
        details: 'missing_user_id',
      })
      return null
    }
    return { id: userId, email }
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      reason: 'INVALID_TOKEN',
      details: error?.message || 'fetch_failed',
    })
    return null
  }
}

const requireAdmin = async (req, res) => {
  const authUser = await requireAuthUser(req, res)
  if (!authUser) return null

  const supabaseAdmin = getSupabaseAdmin()
  const adminCheck = await supabaseAdmin
    .schema('public')
    .from('admin_users')
    .select('user_id')
    .eq('user_id', authUser.id)
    .limit(1)
    .maybeSingle()

  if (adminCheck.error || !adminCheck.data?.user_id) {
    res.status(403).json({ ok: false, error: 'FORBIDDEN', seenUserId: authUser.id })
    return null
  }

  return authUser
}

export const handleAdminWhoAmI = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  try {
    const authUser = await requireAuthUser(req, res)
    if (!authUser) return
    res.status(200).json({
      ok: true,
      userId: authUser.id,
      email: authUser.email ?? null,
      backendSupabaseHost: resolveBackendSupabaseHost(),
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'SERVER_ERROR' })
  }
}

const parseAuthHeader = (req) => {
  const auth = String(readAuthorizationHeader(req) || '')
  const startsWithBearer = auth.toLowerCase().startsWith('bearer ')
  const token = startsWithBearer ? auth.slice(7) : ''
  return {
    auth,
    token,
    present: Boolean(auth),
    startsWithBearer,
  }
}

const getRequestOrigin = (req) => {
  const originHeader = req?.headers?.origin
  if (typeof originHeader === 'string') return originHeader
  return null
}

export const handleAdminCheck = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }
  try {
    const authUser = await requireAuthUser(req, res)
    if (!authUser) return
    const supabaseAdmin = getSupabaseAdmin()
    const adminCheck = await supabaseAdmin
      .schema('public')
      .from('admin_users')
      .select('user_id')
      .eq('user_id', authUser.id)
      .limit(1)
      .maybeSingle()
    if (adminCheck.error) {
      res.status(500).json({ ok: false, error: adminCheck.error.message || 'QUERY_FAILED' })
      return
    }
    res.status(200).json({ ok: true, isAdmin: Boolean(adminCheck.data?.user_id) })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'SERVER_ERROR' })
  }
}

export const handleAdminDebug = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }

  const { auth, token, present, startsWithBearer } = parseAuthHeader(req)
  const jwt = token ? decodeJwtPayload(token) : null
  const supabaseUrl = process.env.SUPABASE_URL || null
  const issMatchesSupabaseUrl = jwt?.iss && supabaseUrl ? jwt.iss === supabaseUrl : null
  const debug = {
    request: {
      method: req.method,
      url: req.url || null,
      host: req.headers?.host || null,
      origin: getRequestOrigin(req),
    },
    authHeader: {
      present,
      startsWithBearer,
      tokenLen: token.length,
    },
    backendSupabaseHost: resolveBackendSupabaseHost(),
    env: resolveEnvDebug(),
    authPath: 'rest: /auth/v1/user',
    jwt,
    issMatchesSupabaseUrl,
    getUser: { ok: false },
    adminCheck: { ok: false },
  }

  if (!token) {
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      debug,
    })
    return
  }

  try {
    const authUser = await requireAuthUser(req, res)
    if (!authUser) return
    debug.getUser = {
      ok: true,
      userId: authUser.id,
      email: authUser.email ?? null,
    }
    const supabaseAdmin = getSupabaseAdmin()
    const adminCheck = await supabaseAdmin
      .schema('public')
      .from('admin_users')
      .select('user_id')
      .eq('user_id', authUser.id)
      .limit(1)
      .maybeSingle()
    if (adminCheck.error) {
      debug.adminCheck = {
        ok: false,
        userId: authUser.id,
        error: adminCheck.error.message || 'QUERY_FAILED',
      }
    } else {
      const adminRowFound = Boolean(adminCheck.data?.user_id)
      debug.adminCheck = {
        ok: true,
        userId: authUser.id,
        isAdmin: adminRowFound,
        adminRowFound,
      }
    }
  } catch (error) {
    debug.getUser = { ok: false, error: error?.message || 'UNKNOWN_ERROR' }
  }

  res.status(200).json({ ok: true, debug })
}

export const handleAdminAuthProbe = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] })
    return
  }

  const token = readBearerToken(req)
  if (!token) {
    res.status(401).json({ ok: false, error: 'NO_TOKEN' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL || ''
  const anonKey = process.env.SUPABASE_ANON_KEY || ''
  const backendSupabaseHost = resolveBackendSupabaseHost()
  const jwt = (() => {
    try {
      const parts = token.split('.')
      if (parts.length < 2) return null
      const payload = parts[1]
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
      const padLength = padded.length % 4
      const normalized =
        padLength === 0 ? padded : padded + '='.repeat(4 - padLength)
      const decoded = Buffer.from(normalized, 'base64').toString('utf-8')
      const json = JSON.parse(decoded)
      return {
        iss: json.iss ?? null,
        sub: json.sub ?? null,
        exp: json.exp ?? null,
        iat: json.iat ?? null,
        session_id: json.session_id ?? json.sid ?? null,
        aud: json.aud ?? null,
      }
    } catch {
      return null
    }
  })()
  const env = {
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
  }

  if (!supabaseUrl || !anonKey) {
    res.status(200).json({
      ok: true,
      tokenLen: token.length,
      rest: {
        ok: false,
        status: 0,
        error: 'MISSING_SUPABASE_ENV',
        userId: null,
        email: null,
      },
      jwt,
      supabaseUrl,
      backendSupabaseHost,
      env,
    })
    return
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    })
    const status = response.status
    const bodyText = await response.text()
    let parsed = null
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null
    } catch {
      parsed = null
    }
    const userId = parsed?.id ?? parsed?.user?.id ?? null
    const email = parsed?.email ?? parsed?.user?.email ?? null
    res.status(200).json({
      ok: true,
      tokenLen: token.length,
      rest: {
        ok: response.ok,
        status,
        error: response.ok
          ? null
          : parsed?.error_description || parsed?.message || bodyText || null,
        userId,
        email,
      },
      jwt,
      supabaseUrl,
      backendSupabaseHost,
      env,
    })
  } catch (error) {
    res.status(200).json({
      ok: true,
      tokenLen: token.length,
      rest: {
        ok: false,
        status: 0,
        error: error?.message || 'FETCH_FAILED',
        userId: null,
        email: null,
      },
      jwt,
      supabaseUrl,
      backendSupabaseHost,
      env,
    })
  }
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
    let profiles = []

    if (userIds.length) {
      const balanceRes = await supabaseAdmin
        .from('billing_accounts')
        .select('user_id, balance_pln_grosze, balance_usd_cents')
        .in('user_id', userIds)
      if (balanceRes.error) {
        console.error('[admin][billing_list] billing_accounts failed', balanceRes.error)
        res.status(500).json({ ok: false, error: balanceRes.error.message || 'QUERY_FAILED' })
        return
      }
      balances = balanceRes.data || []
      const profilesRes = await supabaseAdmin
        .from('profiles')
        .select('id, billing_currency')
        .in('id', userIds)
      if (profilesRes.error) {
        console.error('[admin][billing_list] profiles failed', profilesRes.error)
        res.status(500).json({ ok: false, error: profilesRes.error.message || 'QUERY_FAILED' })
        return
      }
      profiles = profilesRes.data || []
    }

    const balanceByUser = new Map(
      balances.map((row) => [
        String(row.user_id),
        {
          pln: Number(row.balance_pln_grosze ?? 0),
          usd: Number(row.balance_usd_cents ?? 0),
        },
      ])
    )
    const currencyByUser = new Map(
      profiles.map((row) => [String(row.id), String(row.billing_currency || '').toUpperCase()])
    )

    const items = pagedUsers.slice(0, limit).map((row) => ({
      userId: row.id,
      email: row.email || null,
      currency: currencyByUser.get(String(row.id)) === 'USD' ? 'USD' : 'PLN',
      balanceMinor:
        (currencyByUser.get(String(row.id)) === 'USD'
          ? balanceByUser.get(String(row.id))?.usd
          : balanceByUser.get(String(row.id))?.pln) ?? 0,
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
    const currencyRaw = String(body?.currency || '').toUpperCase()
    const currency = currencyRaw === 'USD' ? 'USD' : 'PLN'
    const deltaMinor = Number(body?.amountMinor)
    const deltaRaw = Number(body?.deltaPLN)
    if (!targetUserId) {
      res.status(400).json({ ok: false, error: 'MISSING_TARGET_USER' })
      return
    }
    const amountMinor = Number.isFinite(deltaMinor)
      ? deltaMinor
      : Number.isFinite(deltaRaw)
        ? Math.round(deltaRaw * 100)
        : NaN
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      res.status(400).json({ ok: false, error: 'INVALID_DELTA' })
      return
    }
    if (amountMinor / 100 > MAX_DELTA) {
      res.status(400).json({ ok: false, error: 'DELTA_TOO_LARGE' })
      return
    }

    const adminUserId = adminUser?.id || null
    const supabaseAdmin = getSupabaseAdmin()
    const balanceColumn =
      currency === 'USD' ? 'balance_usd_cents' : 'balance_pln_grosze'
    const { data: account, error: accountError } = await supabaseAdmin
      .from('billing_accounts')
      .select(`${balanceColumn}`)
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (accountError) {
      res.status(500).json({ ok: false, error: accountError.message || 'QUERY_FAILED' })
      return
    }
    const currentMinor = Number(account?.[balanceColumn] ?? 0)
    if (!account) {
      const insertRes = await supabaseAdmin
        .from('billing_accounts')
        .insert({
          user_id: targetUserId,
          balance_pln_grosze: currency === 'PLN' ? amountMinor : 0,
          balance_usd_cents: currency === 'USD' ? amountMinor : 0,
          total_paid_pln: 0,
          updated_at: new Date().toISOString(),
        })
      if (insertRes.error) {
        res.status(500).json({ ok: false, error: insertRes.error.message || 'INSERT_FAILED' })
        return
      }
    } else {
      const updateRes = await supabaseAdmin
        .from('billing_accounts')
        .update({ [balanceColumn]: currentMinor + amountMinor, updated_at: new Date().toISOString() })
        .eq('user_id', targetUserId)
      if (updateRes.error) {
        res.status(500).json({ ok: false, error: updateRes.error.message || 'UPDATE_FAILED' })
        return
      }
    }

    const requestId = crypto.randomUUID()
    const balanceAfterMinor = currentMinor + amountMinor
    await supabaseAdmin.from('billing_balance_adjustments').insert({
      admin_user_id: adminUserId,
      target_user_id: targetUserId,
      delta_pln: currency === 'PLN' ? amountMinor / 100 : 0,
      balance_before: currency === 'PLN' ? currentMinor / 100 : 0,
      balance_after: currency === 'PLN' ? balanceAfterMinor / 100 : 0,
      delta_minor: amountMinor,
      balance_before_minor: currentMinor,
      balance_after_minor: balanceAfterMinor,
      currency,
      note: 'admin_topup',
      request_id: requestId ?? null,
    })

    res.status(200).json({
      ok: true,
      currency,
      balance_before_minor: currentMinor,
      balance_after_minor: balanceAfterMinor,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'SERVER_ERROR' })
  }
}

export const handleAdminBillingReset = async (req, res) => {
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
    const targetUserId = String(body?.userId || '').trim()
    if (!targetUserId) {
      res.status(400).json({ ok: false, error: 'MISSING_TARGET_USER' })
      return
    }

    const supabaseAdmin = getSupabaseAdmin()
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('billing_currency')
      .eq('id', targetUserId)
      .maybeSingle()
    if (profileError) {
      res.status(500).json({ ok: false, error: profileError.message || 'QUERY_FAILED' })
      return
    }
    const currency = String(profile?.billing_currency || '').toUpperCase() === 'USD' ? 'USD' : 'PLN'
    const balanceColumn =
      currency === 'USD' ? 'balance_usd_cents' : 'balance_pln_grosze'
    const { data: account, error: accountError } = await supabaseAdmin
      .from('billing_accounts')
      .select(`${balanceColumn}`)
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (accountError) {
      res.status(500).json({ ok: false, error: accountError.message || 'QUERY_FAILED' })
      return
    }
    const currentBalance = Number(account?.[balanceColumn] ?? 0)

    if (!account) {
      const insertRes = await supabaseAdmin
        .from('billing_accounts')
        .insert({
          user_id: targetUserId,
          balance_pln_grosze: currency === 'PLN' ? 0 : 0,
          balance_usd_cents: currency === 'USD' ? 0 : 0,
          total_paid_pln: 0,
          updated_at: new Date().toISOString(),
        })
      if (insertRes.error) {
        res.status(500).json({ ok: false, error: insertRes.error.message || 'INSERT_FAILED' })
        return
      }
    } else {
      const updateRes = await supabaseAdmin
        .from('billing_accounts')
        .update({ [balanceColumn]: 0, updated_at: new Date().toISOString() })
        .eq('user_id', targetUserId)
      if (updateRes.error) {
        res.status(500).json({ ok: false, error: updateRes.error.message || 'UPDATE_FAILED' })
        return
      }
    }

    const requestId = crypto.randomUUID()
    const deltaMinor = Number.isFinite(currentBalance) ? -currentBalance : 0
    await supabaseAdmin.from('billing_balance_adjustments').insert({
      admin_user_id: adminUser.id,
      target_user_id: targetUserId,
      delta_pln: currency === 'PLN' ? deltaMinor / 100 : 0,
      balance_before: currency === 'PLN' ? (Number.isFinite(currentBalance) ? currentBalance / 100 : 0) : 0,
      balance_after: 0,
      delta_minor: deltaMinor,
      balance_before_minor: Number.isFinite(currentBalance) ? currentBalance : 0,
      balance_after_minor: 0,
      currency,
      note: 'admin_reset_to_zero',
      request_id: requestId,
    })

    res.status(200).json({ ok: true, userId: targetUserId, currency, newBalanceMinor: 0 })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'SERVER_ERROR' })
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
