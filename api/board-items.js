import { readJsonBody, sendJson, methodNotAllowed, notFound } from '../src/lib/server/http.js'
import { resolveAction } from '../src/lib/server/router.js'
import { getSupabaseAdmin } from '../src/lib/server/supabaseAdmin.js'
import { chargeUserBalance, normalizeBillingError } from '../src/lib/server/billing.js'

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

const shouldIncludeDiagnostics = (req) => {
  const header =
    req?.headers?.['x-diagnostics'] ||
    req?.headers?.['X-Diagnostics'] ||
    (typeof req?.headers?.get === 'function' ? req.headers.get('x-diagnostics') : '') ||
    ''
  return String(header).trim() === '1'
}

const safeErrorDetails = (error) => ({
  message: error?.message ?? null,
  pgcode: error?.code ?? null,
  hint: error?.hint ?? null,
})

export default async function handler(req, res) {
  const body = req.method === 'GET' ? null : await readJsonBody(req)
  if (req.method !== 'GET' && body === null) {
    sendJson(res, 400, { ok: false, error: 'INVALID_JSON' })
    return
  }
  if (body) req.body = body

  const action = resolveAction(req, body)
  if (action !== 'upsert') {
    notFound(res)
    return
  }
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
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

  const payload = body && typeof body === 'object' ? body : {}
  const sessionId = String(payload.sessionId || '').trim()
  if (!sessionId) {
    sendJson(res, 400, { ok: false, error: 'SESSION_ID_REQUIRED' })
    return
  }

  const itemId = payload.itemId ? String(payload.itemId).trim() : ''
  const isInsert = !itemId
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (isInsert && !text) {
    sendJson(res, 400, { ok: false, error: 'TEXT_REQUIRED' })
    return
  }

  try {
    const charge = await chargeUserBalance(
      userId,
      'session_item_add_or_edit',
      sessionId,
      supabaseAdmin
    )

    if (isInsert) {
      const insertPayload = {
        id: payload.itemId || undefined,
        user_id: userId,
        session_id: sessionId,
        text,
        label: payload.label ?? null,
        matrix_row: payload.matrixRow ?? null,
        matrix_col: payload.matrixCol ?? null,
        question_id: payload.questionId ?? null,
        question_text_pl: payload.questionTextPl ?? null,
        question_text_en: payload.questionTextEn ?? null,
        entry_type: payload.entryType ?? null,
        prompt_type: payload.promptType ?? null,
        created_at: payload.createdAt ?? Date.now(),
      }
      const { data, error } = await supabaseAdmin
        .from('board_items')
        .insert(insertPayload)
        .select('*')
        .single()
      if (error) {
        sendJson(res, 500, { ok: false, error: error.message || 'INSERT_FAILED' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        item: data,
        balance_after_grosze: charge.balanceAfterGrosze,
        balance_after_pln:
          charge.balanceAfterPln ?? (charge.balanceAfterGrosze != null ? charge.balanceAfterGrosze / 100 : null),
      })
      return
    }

    const patch = {}
    if (payload.text !== undefined) patch.text = text
    if (payload.label !== undefined) patch.label = payload.label ?? null
    if (payload.matrixRow !== undefined) patch.matrix_row = payload.matrixRow ?? null
    if (payload.matrixCol !== undefined) patch.matrix_col = payload.matrixCol ?? null
    if (payload.questionId !== undefined) patch.question_id = payload.questionId ?? null
    if (payload.questionTextPl !== undefined) patch.question_text_pl = payload.questionTextPl ?? null
    if (payload.questionTextEn !== undefined) patch.question_text_en = payload.questionTextEn ?? null
    if (payload.entryType !== undefined) patch.entry_type = payload.entryType ?? null
    if (payload.promptType !== undefined) patch.prompt_type = payload.promptType ?? null

    if (!Object.keys(patch).length) {
      sendJson(res, 400, { ok: false, error: 'NOTHING_TO_UPDATE' })
      return
    }

    const { data, error } = await supabaseAdmin
      .from('board_items')
      .update(patch)
      .eq('id', itemId)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .select('*')
      .single()
    if (error) {
      sendJson(res, 500, { ok: false, error: error.message || 'UPDATE_FAILED' })
      return
    }
    sendJson(res, 200, {
      ok: true,
      item: data,
      balance_after_grosze: charge.balanceAfterGrosze,
      balance_after_pln:
        charge.balanceAfterPln ?? (charge.balanceAfterGrosze != null ? charge.balanceAfterGrosze / 100 : null),
    })
  } catch (error) {
    console.error('[board-items][billing] charge failed', {
      message: error?.message ?? null,
      code: error?.code ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    })
    if (handleBillingError(res, error)) return
    const payload = { ok: false, error: 'BILLING_FAILED' }
    if (shouldIncludeDiagnostics(req)) {
      payload.details = safeErrorDetails(error)
    }
    sendJson(res, 500, payload)
  }
}
