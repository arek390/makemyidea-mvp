import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import {
  handleReportUpdate,
  handleReportTrizImageGenerate,
  handleReportTrizImageDelete,
} from '../src/lib/server/handlers/reportUpdate.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { normalizeBillingError } from '../src/lib/server/billing.js'
import { recordSessionBillingEvent } from '../src/lib/server/aiCostEvents.js'

const getBearerToken = (req) => {
  const authHeader =
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    (typeof req?.headers?.get === 'function' ? req.headers.get('authorization') : '') ||
    ''
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  return ''
}

const handleBillingError = (res, error) => {
  const normalized = normalizeBillingError(error)
  if (!normalized) return false
  sendJson(res, normalized.status, { ok: false, error: normalized.code })
  return true
}

const normalizeCurrency = (value) => {
  // Billing is PLN-only. Keep accepting legacy inputs, but normalize to PLN.
  return 'PLN'
}

const selectReportFields =
  'id,session_id,created_at,updated_at,summary_json,last_summary_text_hash,source_updated_at'

const isAdminUser = async (supabaseAdmin, userId) => {
  const adminRes = await supabaseAdmin
    .schema('public')
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (adminRes.error) return { ok: false, error: adminRes.error }
  return { ok: true, isAdmin: Boolean(adminRes.data?.user_id) }
}

const resolveSessionAccess = async (supabaseAdmin, sessionId, userId) => {
  const sessionRes = await supabaseAdmin
    .schema('public')
    .from('sessions')
    .select('id,user_id')
    .eq('id', sessionId)
    .limit(1)
    .maybeSingle()
  if (sessionRes.error) {
    return { ok: false, error: sessionRes.error, allowed: false, reason: 'SESSION_LOOKUP_FAILED' }
  }
  const ownerUserId = String(sessionRes.data?.user_id || '')
  const isOwner = Boolean(ownerUserId && ownerUserId === String(userId))
  if (isOwner) return { ok: true, allowed: true, isAdmin: false, ownerUserId }

  const adminCheck = await isAdminUser(supabaseAdmin, userId)
  if (!adminCheck.ok) {
    return { ok: false, error: adminCheck.error, allowed: false, reason: 'ADMIN_LOOKUP_FAILED' }
  }
  return {
    ok: true,
    allowed: Boolean(adminCheck.isAdmin),
    isAdmin: Boolean(adminCheck.isAdmin),
    ownerUserId,
  }
}

const handleReportGenerate = async (req, res) => {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const sessionId = String(body.sessionId || '').trim()
  if (!sessionId) {
    sendJson(res, 400, { ok: false, error: 'MISSING_SESSION_ID' })
    return
  }

  const token = getBearerToken(req)
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
    return
  }

  const supabaseAdmin = getSupabaseAdmin()
  const authRes = await supabaseAdmin.auth.getUser(token)
  const userId = authRes?.data?.user?.id || null
  if (authRes?.error || !userId) {
    sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
    return
  }
  const access = await resolveSessionAccess(supabaseAdmin, sessionId, userId)
  if (!access.ok) {
    sendJson(res, 500, { ok: false, error: access.reason || 'ACCESS_CHECK_FAILED' })
    return
  }
  if (!access.allowed) {
    sendJson(res, 403, { ok: false, error: 'FORBIDDEN' })
    return
  }

  const existingRes = await supabaseAdmin
    .schema('public')
    .from('reports')
    .select(selectReportFields)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (existingRes.error) {
    sendJson(res, 500, { ok: false, error: 'QUERY_FAILED' })
    return
  }
  if (existingRes.data) {
    // Report exists already: do NOT charge `report_generate` again,
    // but ALWAYS rebuild the content via the shared update flow.
    req.reportOptions = { skipBilling: true, returnReport: true, actionKey: 'report_generate' }
    await handleReportUpdate(req, res)
    return
  }

  const profileRes = await supabaseAdmin
    .schema('public')
    .from('profiles')
    .select('billing_currency')
    .eq('id', userId)
    .maybeSingle()
  if (profileRes.error) {
    sendJson(res, 500, { ok: false, error: 'PROFILE_LOOKUP_FAILED' })
    return
  }
  const billingCurrency = normalizeCurrency(profileRes.data?.billing_currency)

  console.log('[report][generate][billing]', {
    userId,
    sessionId,
    currency: billingCurrency,
    actionKey: 'report_generate',
  })

  const billingRes = await supabaseAdmin.rpc('charge_user_balance', {
    p_user_id: userId,
    p_action_key: 'report_generate',
    p_reference_id: sessionId,
    p_currency: billingCurrency,
  })
  if (billingRes.error) {
    if (handleBillingError(res, billingRes.error)) return
    sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
    return
  }

  const insertRes = await supabaseAdmin
    .schema('public')
    .from('reports')
    .insert({
      session_id: sessionId,
      source_updated_at: Date.now(),
      updated_at: new Date().toISOString(),
    })
    .select(selectReportFields)
    .single()

  if (insertRes.error) {
    const retry = await supabaseAdmin
      .schema('public')
      .from('reports')
      .select(selectReportFields)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (retry.data) {
      const billingRow = Array.isArray(billingRes.data) ? billingRes.data[0] : billingRes.data
      await recordSessionBillingEvent(supabaseAdmin, {
        sessionId: retry.data.session_id ?? sessionId,
        reportId: retry.data.id ?? null,
        userId,
        actionKey: 'report_generate',
        referenceId: retry.data.id ?? sessionId,
        amountMinor: billingRow?.amount_minor ?? null,
        currency: billingRow?.currency ?? billingCurrency,
      })
      req.reportOptions = { skipBilling: true, returnReport: true, actionKey: 'report_generate' }
      await handleReportUpdate(req, res)
      return
    }
    sendJson(res, 500, { ok: false, error: 'REPORT_CREATE_FAILED' })
    return
  }

  const billingRow = Array.isArray(billingRes.data) ? billingRes.data[0] : billingRes.data
  await recordSessionBillingEvent(supabaseAdmin, {
    sessionId: insertRes.data?.session_id ?? sessionId,
    reportId: insertRes.data?.id ?? null,
    userId,
    actionKey: 'report_generate',
    referenceId: insertRes.data?.id ?? sessionId,
    amountMinor: billingRow?.amount_minor ?? null,
    currency: billingRow?.currency ?? billingCurrency,
  })
  req.reportOptions = { skipBilling: true, returnReport: true, actionKey: 'report_generate' }
  await handleReportUpdate(req, res)
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action === 'update') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    await handleReportUpdate(req, res)
    return
  }
  if (action === 'generate') {
    await handleReportGenerate(req, res)
    return
  }
  if (action === 'generate-triz-image') {
    await handleReportTrizImageGenerate(req, res)
    return
  }
  if (action === 'delete-triz-image') {
    await handleReportTrizImageDelete(req, res)
    return
  }
  notFound(res)
}
