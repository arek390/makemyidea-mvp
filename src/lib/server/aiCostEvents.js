import { calculateOpenAIUsageCost, resolveFxUsdPln } from './openaiPricing.js'

const toInt = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0
}

const toMoney = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export const recordSessionAiUsageEvent = async (
  supabaseAdmin,
  { sessionId, reportId = null, userId = null, actionKey = null, sourceTask = null, referenceId = null, meta }
) => {
  const safeSessionId = String(sessionId || '').trim()
  if (!safeSessionId || !meta) return
  const model = String(meta?.modelUsed || '').trim() || null
  const modality = model === 'gpt-image-1' ? 'image' : 'text'
  const tokensInput = Number.isFinite(Number(meta?.tokens?.input))
    ? Math.max(0, Math.trunc(Number(meta.tokens.input)))
    : 0
  const tokensCachedInput = Number.isFinite(Number(meta?.tokens?.cached_input))
    ? Math.max(0, Math.trunc(Number(meta.tokens.cached_input)))
    : 0
  const tokensOutput = Number.isFinite(Number(meta?.tokens?.output))
    ? Math.max(0, Math.trunc(Number(meta.tokens.output)))
    : 0
  const pricing = await calculateOpenAIUsageCost(supabaseAdmin, {
    model,
    modality,
    tokensInput,
    tokensCachedInput,
    tokensOutput,
    fxUsdPln: resolveFxUsdPln(),
  })
  if (!tokensInput && !tokensCachedInput && !tokensOutput && !pricing.usage_cost_usd && !pricing.usage_cost_pln) return
  const { error } = await supabaseAdmin.schema('public').from('session_ai_cost_events').insert({
    session_id: safeSessionId,
    report_id: reportId ? String(reportId) : null,
    user_id: userId ? String(userId) : null,
    event_kind: 'ai_response',
    action_key: actionKey ? String(actionKey) : null,
    source_task: sourceTask ? String(sourceTask) : null,
    model,
    modality,
    reference_id: referenceId ? String(referenceId) : null,
    tokens_input: tokensInput,
    tokens_cached_input: tokensCachedInput,
    tokens_output: tokensOutput,
    usage_cost_usd: toMoney(pricing.usage_cost_usd),
    usage_cost_pln: toMoney(pricing.usage_cost_pln),
    billed_cost_grosze: 0,
    billed_currency: null,
    price_input_per_1m_usd_used: pricing.price_input_per_1m_usd_used,
    price_cached_input_per_1m_usd_used: pricing.price_cached_input_per_1m_usd_used,
    price_output_per_1m_usd_used: pricing.price_output_per_1m_usd_used,
    pricing_snapshot_id: pricing.pricing_snapshot_id,
    pricing_source: pricing.pricing_source,
    fx_usd_pln: pricing.fx_usd_pln,
  })
  if (error) {
    console.error('[session_ai_cost_events][usage] insert failed', {
      sessionId: safeSessionId,
      actionKey,
      sourceTask,
      model,
      modality,
      pricingSnapshotId: pricing.pricing_snapshot_id,
      message: error.message ?? null,
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
  if (!safeSessionId || !safeActionKey || !safeCurrency) return
  const { error } = await supabaseAdmin.schema('public').from('session_ai_cost_events').insert({
    session_id: safeSessionId,
    report_id: reportId ? String(reportId) : null,
    user_id: userId ? String(userId) : null,
    event_kind: 'billing',
    action_key: safeActionKey,
    source_task: null,
    model: null,
    modality: null,
    reference_id: referenceId ? String(referenceId) : null,
    tokens_input: 0,
    tokens_cached_input: 0,
    tokens_output: 0,
    usage_cost_usd: 0,
    usage_cost_pln: 0,
    billed_cost_grosze: toInt(amountMinor),
    billed_currency: safeCurrency === 'USD' ? 'USD' : 'PLN',
    price_input_per_1m_usd_used: null,
    price_cached_input_per_1m_usd_used: null,
    price_output_per_1m_usd_used: null,
    pricing_snapshot_id: null,
    pricing_source: null,
    fx_usd_pln: null,
  })
  if (error) {
    console.error('[session_ai_cost_events][billing] insert failed', {
      sessionId: safeSessionId,
      actionKey: safeActionKey,
      currency: safeCurrency,
      message: error.message ?? null,
    })
  }
}
