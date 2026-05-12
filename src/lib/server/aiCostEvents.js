import { calculateOpenAIUsageCost, resolveFxUsdPln } from './openaiPricing.js'

const toInt = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0
}

const toMoney = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const shouldLogAiCostDiagnostics = () =>
  process.env.AI_COST_DIAGNOSTICS === '1' || process.env.NODE_ENV !== 'production'

const normalizeSupabaseError = (value) => {
  if (!value) return null
  if (value instanceof Error) {
    return {
      code: value.code ?? null,
      message: value.message || 'UNKNOWN_ERROR',
      details: value.details ?? null,
      hint: value.hint ?? null,
    }
  }
  if (typeof value === 'object') {
    return {
      code: value.code ?? null,
      message: value.message ?? 'UNKNOWN_ERROR',
      details: value.details ?? null,
      hint: value.hint ?? null,
    }
  }
  return { code: null, message: String(value), details: null, hint: null }
}

const parseUndefinedColumn = (error) => {
  const message = String(error?.message || '')
  const match = message.match(/column \"([^\"]+)\" .* does not exist/i)
  return match?.[1] ?? null
}

const parsePgrstMissingColumn = (error) => {
  const message = String(error?.message || '')
  // Example: "Could not find the 'model_used' column of 'session_ai_cost_events' in the schema cache"
  const match = message.match(/Could not find the '([^']+)' column of '([^']+)'/i)
  return match?.[1] ?? null
}

const insertWithColumnFallback = async (supabaseAdmin, payload, { label, sessionId }) => {
  const maxAttempts = 6
  let attempt = 0
  let currentPayload = { ...payload }
  while (attempt < maxAttempts) {
    attempt += 1
    const { error } = await supabaseAdmin.schema('public').from('session_ai_cost_events').insert(currentPayload)
    if (!error) return { ok: true, error: null, attempts: attempt, payload: currentPayload }

    const normalized = normalizeSupabaseError(error)
    const missingColumn = (() => {
      if (!normalized) return null
      if (normalized.code === '42703') return parseUndefinedColumn(normalized)
      if (normalized.code === 'PGRST204') return parsePgrstMissingColumn(normalized)
      return parseUndefinedColumn(normalized) || parsePgrstMissingColumn(normalized)
    })()
    if (!missingColumn || !(missingColumn in currentPayload)) {
      return { ok: false, error: normalized, attempts: attempt, payload: currentPayload }
    }
    if (shouldLogAiCostDiagnostics()) {
      console.warn(`[${label}] insert retry (drop column)`, {
        sessionId,
        attempt,
        missingColumn,
        error: normalized,
      })
    }
    const { [missingColumn]: _dropped, ...rest } = currentPayload
    currentPayload = rest
  }
  return {
    ok: false,
    error: { code: 'INSERT_RETRY_EXHAUSTED', message: 'Insert retry exhausted', details: null, hint: null },
    attempts: attempt,
    payload: currentPayload,
  }
}

const buildUsageInsertPayload = ({
  sessionId,
  reportId,
  userId,
  actionKey,
  sourceTask,
  referenceId,
  model,
  modality,
  tokensInput,
  tokensCachedInput,
  tokensOutput,
  tokensTotal,
  pricing,
}) => {
  const costUsd = toMoney(pricing?.cost_usd ?? pricing?.usage_cost_usd ?? 0)
  const costPln = toMoney(pricing?.cost_pln ?? pricing?.usage_cost_pln ?? 0)
  return {
    session_id: sessionId,
    report_id: reportId ? String(reportId) : null,
    user_id: userId ? String(userId) : null,
    event_kind: 'ai_response',
    event_type: 'ai_usage',
    action_key: actionKey ? String(actionKey) : null,
    source_task: sourceTask ? String(sourceTask) : null,
    reference_id: referenceId ? String(referenceId) : null,
    // Model columns (new + legacy)
    model: model ?? null,
    model_used: model ?? null,
    modality: modality ?? null,
    // Tokens columns (new + legacy)
    input_tokens: toInt(tokensInput),
    output_tokens: toInt(tokensOutput),
    total_tokens: toInt(tokensTotal),
    tokens_input: toInt(tokensInput),
    tokens_cached_input: toInt(tokensCachedInput),
    tokens_output: toInt(tokensOutput),
    // Cost columns (new + legacy)
    cost_usd: costUsd,
    cost_pln: costPln,
    usage_cost_usd: costUsd,
    usage_cost_pln: costPln,
    // Billing columns (new + legacy)
    billed_minor: 0,
    billed_cost_grosze: 0,
    billed_currency: null,
    // Optional pricing snapshot columns (may not exist in DB; insert will drop them if needed)
    price_input_per_1m_usd_used: pricing?.price_input_per_1m_usd_used ?? null,
    price_cached_input_per_1m_usd_used: pricing?.price_cached_input_per_1m_usd_used ?? null,
    price_output_per_1m_usd_used: pricing?.price_output_per_1m_usd_used ?? null,
    pricing_snapshot_id: pricing?.pricing_snapshot_id ?? null,
    pricing_source: pricing?.pricing_source ?? null,
    fx_usd_pln: pricing?.fx_usd_pln ?? null,
  }
}

export const recordSessionAiUsageEvent = async (
  supabaseAdmin,
  {
    sessionId,
    reportId = null,
    userId = null,
    actionKey = null,
    sourceTask = null,
    referenceId = null,
    meta,
  }
) => {
  const safeSessionId = String(sessionId || '').trim()
  if (!safeSessionId || !meta) return
  const model = String(meta?.modelUsed || '').trim() || null
  const modality = model === 'gpt-image-1' ? 'image' : 'text'
  const tokensInput =
    toInt(meta?.input_tokens ?? meta?.tokens_input ?? meta?.tokens?.input ?? meta?.tokens?.prompt ?? 0)
  const tokensCachedInput =
    toInt(meta?.cached_input_tokens ?? meta?.tokens_cached_input ?? meta?.tokens?.cached_input ?? 0)
  const tokensOutput =
    toInt(meta?.output_tokens ?? meta?.tokens_output ?? meta?.tokens?.output ?? meta?.tokens?.completion ?? 0)
  const tokensTotal =
    toInt(meta?.total_tokens ?? meta?.tokens?.total ?? (tokensInput + tokensOutput))
  const pricing = await calculateOpenAIUsageCost(supabaseAdmin, {
    model,
    modality,
    tokensInput,
    tokensCachedInput,
    tokensOutput,
    fxUsdPln: resolveFxUsdPln(),
  })
  const costUsd = toMoney(pricing?.cost_usd ?? pricing?.usage_cost_usd ?? 0)
  const costPln = toMoney(pricing?.cost_pln ?? pricing?.usage_cost_pln ?? 0)
  if (!tokensInput && !tokensCachedInput && !tokensOutput && !costUsd && !costPln) return
  const insertPayload = buildUsageInsertPayload({
    sessionId: safeSessionId,
    reportId,
    userId,
    actionKey,
    sourceTask,
    referenceId,
    model,
    modality,
    tokensInput,
    tokensCachedInput,
    tokensOutput,
    tokensTotal,
    pricing,
  })
  if (shouldLogAiCostDiagnostics()) {
    console.log('[session_ai_cost_events][usage] raw input', {
      sessionId: safeSessionId,
      actionKey,
      sourceTask,
      referenceId,
      reportId,
      userId,
      meta,
    })
    console.log('[session_ai_cost_events][usage] insert payload (normalized)', insertPayload)
  }
  const insertResult = await insertWithColumnFallback(supabaseAdmin, insertPayload, {
    label: 'session_ai_cost_events][usage',
    sessionId: safeSessionId,
  })
  if (!insertResult.ok) {
    console.error('[session_ai_cost_events][usage] insert failed', {
      sessionId: safeSessionId,
      actionKey,
      sourceTask,
      model,
      modality,
      attempts: insertResult.attempts,
      error: insertResult.error,
    })
  } else if (shouldLogAiCostDiagnostics()) {
    console.log('[session_ai_cost_events][usage] insert ok', {
      sessionId: safeSessionId,
      attempts: insertResult.attempts,
    })
  }
}

export const recordSessionBillingEvent = async (
  supabaseAdmin,
  {
    sessionId,
    reportId = null,
    userId = null,
    actionKey,
    referenceId = null,
    amountMinor,
    currency,
  }
) => {
  const safeSessionId = String(sessionId || '').trim()
  const safeActionKey = String(actionKey || '').trim()
  const safeCurrency = String(currency || '').toUpperCase().trim()
  const safeEventType = [
    'session_create',
    'report_generate',
    'report_update',
    'image_generate',
    'image_regenerate',
  ].includes(safeActionKey)
    ? safeActionKey
    : null
  if (!safeSessionId || !safeActionKey || !safeCurrency) return
  const insertPayload = {
    session_id: safeSessionId,
    report_id: reportId ? String(reportId) : null,
    user_id: userId ? String(userId) : null,
    event_kind: 'billing',
    event_type: safeEventType,
    action_key: safeActionKey,
    source_task: null,
    model: null,
    model_used: null,
    modality: null,
    reference_id: referenceId ? String(referenceId) : null,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    tokens_input: 0,
    tokens_cached_input: 0,
    tokens_output: 0,
    cost_usd: 0,
    cost_pln: 0,
    usage_cost_usd: 0,
    usage_cost_pln: 0,
    billed_minor: toInt(amountMinor),
    billed_cost_grosze: toInt(amountMinor),
    billed_currency: 'PLN',
    price_input_per_1m_usd_used: null,
    price_cached_input_per_1m_usd_used: null,
    price_output_per_1m_usd_used: null,
    pricing_snapshot_id: null,
    pricing_source: null,
    fx_usd_pln: null,
  }
  if (shouldLogAiCostDiagnostics()) {
    console.log('[session_ai_cost_events][billing] raw input', {
      sessionId: safeSessionId,
      reportId,
      userId,
      actionKey: safeActionKey,
      referenceId,
      amountMinor,
      currency: safeCurrency,
    })
    console.log('[session_ai_cost_events][billing] insert payload (normalized)', insertPayload)
  }
  const insertResult = await insertWithColumnFallback(supabaseAdmin, insertPayload, {
    label: 'session_ai_cost_events][billing',
    sessionId: safeSessionId,
  })
  if (!insertResult.ok) {
    console.error('[session_ai_cost_events][billing] insert failed', {
      sessionId: safeSessionId,
      actionKey: safeActionKey,
      currency: safeCurrency,
      attempts: insertResult.attempts,
      error: insertResult.error,
    })
  } else if (shouldLogAiCostDiagnostics()) {
    console.log('[session_ai_cost_events][billing] insert ok', {
      sessionId: safeSessionId,
      attempts: insertResult.attempts,
    })
  }
}
