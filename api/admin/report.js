import { createSupabaseServerClient } from '../_lib/supabaseServer.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

const ADMIN_EMAIL = 'arektest8@gmail.com'

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
