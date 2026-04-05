const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export const resolveFxUsdPln = () => {
  const raw = Number(process.env.FX_USD_PLN || 0)
  return Number.isFinite(raw) && raw > 0 ? raw : 4.0
}

export const getActiveOpenAIModelPrice = async (supabaseAdmin, model, modality = 'text') => {
  const safeModel = String(model || '').trim()
  const safeModality = String(modality || 'text').trim() || 'text'
  if (!safeModel) return null
  const { data, error } = await supabaseAdmin
    .schema('public')
    .from('openai_model_price_snapshots')
    .select('*')
    .eq('model', safeModel)
    .eq('modality', safeModality)
    .eq('is_active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[openai-pricing] active snapshot query failed', {
      model: safeModel,
      modality: safeModality,
      message: error.message ?? null,
    })
    return null
  }
  if (!data) {
    console.warn('[openai-pricing] active snapshot missing', {
      model: safeModel,
      modality: safeModality,
    })
    return null
  }
  return data
}

export const calculateOpenAIUsageCost = async (
  supabaseAdmin,
  { model, modality = 'text', tokensInput = 0, tokensCachedInput = 0, tokensOutput = 0, fxUsdPln }
) => {
  const snapshot = await getActiveOpenAIModelPrice(supabaseAdmin, model, modality)
  const resolvedFx = toNumber(fxUsdPln) ?? resolveFxUsdPln()
  const input = Number.isFinite(Number(tokensInput)) ? Math.max(0, Math.trunc(Number(tokensInput))) : 0
  const cachedInput = Number.isFinite(Number(tokensCachedInput))
    ? Math.max(0, Math.trunc(Number(tokensCachedInput)))
    : 0
  const output = Number.isFinite(Number(tokensOutput)) ? Math.max(0, Math.trunc(Number(tokensOutput))) : 0
  const inputPrice = toNumber(snapshot?.input_price_per_1m_usd) ?? 0
  const cachedInputPrice = toNumber(snapshot?.cached_input_price_per_1m_usd) ?? 0
  const outputPrice = toNumber(snapshot?.output_price_per_1m_usd) ?? 0
  const usageCostUsd =
    (input / 1_000_000) * inputPrice +
    (cachedInput / 1_000_000) * cachedInputPrice +
    (output / 1_000_000) * outputPrice
  return {
    usage_cost_usd: usageCostUsd,
    usage_cost_pln: usageCostUsd * resolvedFx,
    pricing_snapshot_id: snapshot?.id ?? null,
    pricing_source: snapshot?.source_label ?? (snapshot ? null : 'missing_snapshot'),
    price_input_per_1m_usd_used: snapshot?.input_price_per_1m_usd ?? null,
    price_cached_input_per_1m_usd_used: snapshot?.cached_input_price_per_1m_usd ?? null,
    price_output_per_1m_usd_used: snapshot?.output_price_per_1m_usd ?? null,
    fx_usd_pln: resolvedFx,
  }
}
