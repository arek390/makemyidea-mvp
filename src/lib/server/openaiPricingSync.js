import { getActiveOpenAIModelPrice } from './openaiPricing.js'

const SOURCE_LABEL = 'openai_api_pricing'
const MAX_SYNC_AGE_DAYS = 30

const MODEL_SOURCES = [
  {
    model: 'gpt-4.1-mini',
    modality: 'text',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
    parser: 'text_tokens',
  },
  {
    model: 'gpt-5-mini',
    modality: 'text',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5-mini',
    parser: 'text_tokens',
  },
  {
    model: 'gpt-5-nano',
    modality: 'text',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5-nano',
    parser: 'text_tokens',
  },
  {
    model: 'gpt-image-1',
    modality: 'image',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-image-1',
    parser: 'image_model',
  },
]

const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const normalizeHtmlToText = (html) =>
  String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sliceBetween = (text, startMarker, endMarkers = []) => {
  const startIndex = text.indexOf(startMarker)
  if (startIndex === -1) return text
  const start = startIndex + startMarker.length
  let end = text.length
  endMarkers.forEach((marker) => {
    const markerIndex = text.indexOf(marker, start)
    if (markerIndex !== -1 && markerIndex < end) end = markerIndex
  })
  return text.slice(start, end).trim()
}

const extractPrice = (section, label) => {
  const regex = new RegExp(`${escapeRegex(label)}\\s*\\$\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i')
  const match = section.match(regex)
  return toNumber(match?.[1] ?? null)
}

const parseTextTokenPricing = (normalizedText) => {
  const section = sliceBetween(normalizedText, 'Text tokens', [
    'Quick comparison',
    'Modalities',
    'Endpoints',
  ])
  return {
    input_price_per_1m_usd: extractPrice(section, 'Input'),
    cached_input_price_per_1m_usd: extractPrice(section, 'Cached input'),
    output_price_per_1m_usd: extractPrice(section, 'Output'),
  }
}

const parseImageModelPricing = (normalizedText) => {
  const textSection = sliceBetween(normalizedText, 'Text tokens', ['Image tokens', 'Modalities'])
  const imageSection = sliceBetween(normalizedText, 'Image tokens', [
    'Image generation',
    'Modalities',
    'Endpoints',
  ])
  return {
    // For gpt-image-1 usage in this app we use text prompt tokens as input and image tokens as output.
    input_price_per_1m_usd: extractPrice(textSection, 'Input'),
    cached_input_price_per_1m_usd: extractPrice(textSection, 'Cached input'),
    output_price_per_1m_usd: extractPrice(imageSection, 'Output'),
  }
}

const parsePricingPayload = (config, html) => {
  const normalizedText = normalizeHtmlToText(html)
  const parsed =
    config.parser === 'image_model'
      ? parseImageModelPricing(normalizedText)
      : parseTextTokenPricing(normalizedText)
  return {
    model: config.model,
    modality: config.modality,
    source_url: config.sourceUrl,
    source_label: SOURCE_LABEL,
    raw_payload: {
      parser: config.parser,
      normalized_excerpt: normalizedText.slice(0, 3000),
      parsed,
    },
    ...parsed,
  }
}

const pricesEqual = (left, right) =>
  Number(left?.input_price_per_1m_usd ?? 0) === Number(right?.input_price_per_1m_usd ?? 0) &&
  Number(left?.cached_input_price_per_1m_usd ?? 0) ===
    Number(right?.cached_input_price_per_1m_usd ?? 0) &&
  Number(left?.output_price_per_1m_usd ?? 0) === Number(right?.output_price_per_1m_usd ?? 0)

const fetchPricingSource = async (config) => {
  const response = await fetch(config.sourceUrl, {
    headers: {
      'User-Agent': 'makemyideawork-openai-pricing-sync',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`)
  }
  const html = await response.text()
  return parsePricingPayload(config, html)
}

const buildStatus = ({ foundCount, targetCount, errorCount }) => {
  if (foundCount === 0) return 'failed'
  if (foundCount < targetCount || errorCount > 0) return 'partial_success'
  return 'success'
}

export const getLatestOpenAIPriceSyncLog = async (supabaseAdmin) => {
  const { data, error } = await supabaseAdmin
    .schema('public')
    .from('openai_model_price_sync_log')
    .select('*')
    .order('sync_started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data || null
}

export const getOpenAIModelPricingStatus = async (supabaseAdmin) => {
  const latestSync = await getLatestOpenAIPriceSyncLog(supabaseAdmin)
  const { data: snapshots, error } = await supabaseAdmin
    .schema('public')
    .from('openai_model_price_snapshots')
    .select('id,model,modality,source_url,source_label,fetched_at')
    .eq('is_active', true)
    .order('fetched_at', { ascending: false })
  if (error) {
    return {
      latestSync,
      activeSnapshots: [],
      latestFetchedAt: null,
      sourceLabel: SOURCE_LABEL,
      sourceUrl: null,
      isFresh: false,
    }
  }
  const latestFetchedAt = snapshots?.[0]?.fetched_at ?? null
  const sourceUrl = snapshots?.[0]?.source_url ?? latestSync?.source_url ?? null
  const diffMs = latestFetchedAt ? Date.now() - new Date(latestFetchedAt).getTime() : Number.POSITIVE_INFINITY
  return {
    latestSync,
    activeSnapshots: snapshots || [],
    latestFetchedAt,
    sourceLabel: snapshots?.[0]?.source_label ?? latestSync?.source_label ?? SOURCE_LABEL,
    sourceUrl,
    isFresh: Number.isFinite(diffMs) && diffMs <= MAX_SYNC_AGE_DAYS * 24 * 60 * 60 * 1000,
  }
}

export const syncOpenAIModelPricing = async (supabaseAdmin, options = {}) => {
  const startedAt = new Date().toISOString()
  const triggerReason = String(options.reason || 'manual').trim() || 'manual'
  const sourceUrl = 'https://developers.openai.com/api/docs/models/all'
  const runningLogRes = await supabaseAdmin
    .schema('public')
    .from('openai_model_price_sync_log')
    .insert({
      status: 'running',
      source_url: sourceUrl,
      source_label: SOURCE_LABEL,
      raw_payload: { trigger_reason: triggerReason },
    })
    .select('id')
    .single()
  const syncLogId = runningLogRes.data?.id ?? null

  let foundCount = 0
  let updatedCount = 0
  let insertedCount = 0
  const errors = []
  const results = []

  try {
    for (const config of MODEL_SOURCES) {
      try {
        const parsed = await fetchPricingSource(config)
        const hasRequiredPrices =
          parsed.input_price_per_1m_usd != null && parsed.output_price_per_1m_usd != null
        if (!hasRequiredPrices) {
          errors.push({ model: config.model, message: 'PRICE_PARSE_INCOMPLETE' })
          continue
        }
        foundCount += 1
        results.push(parsed)

        const active = await getActiveOpenAIModelPrice(supabaseAdmin, config.model, config.modality)
        if (active && pricesEqual(active, parsed)) {
          continue
        }

        if (active?.id) {
          const { error: deactivateError } = await supabaseAdmin
            .schema('public')
            .from('openai_model_price_snapshots')
            .update({
              is_active: false,
              effective_to: startedAt,
            })
            .eq('id', active.id)
          if (deactivateError) {
            errors.push({ model: config.model, message: deactivateError.message || 'DEACTIVATE_FAILED' })
            continue
          }
          updatedCount += 1
        }

        const { error: insertError } = await supabaseAdmin
          .schema('public')
          .from('openai_model_price_snapshots')
          .insert({
            model: parsed.model,
            modality: parsed.modality,
            input_price_per_1m_usd: parsed.input_price_per_1m_usd,
            cached_input_price_per_1m_usd: parsed.cached_input_price_per_1m_usd,
            output_price_per_1m_usd: parsed.output_price_per_1m_usd,
            source_url: parsed.source_url,
            source_label: parsed.source_label,
            fetched_at: startedAt,
            effective_from: startedAt,
            effective_to: null,
            is_active: true,
            raw_payload: parsed.raw_payload,
          })
        if (insertError) {
          errors.push({ model: config.model, message: insertError.message || 'INSERT_FAILED' })
          continue
        }
        insertedCount += 1
      } catch (error) {
        errors.push({ model: config.model, message: error?.message || 'FETCH_FAILED' })
      }
    }

    const status = buildStatus({
      foundCount,
      targetCount: MODEL_SOURCES.length,
      errorCount: errors.length,
    })

    if (syncLogId) {
      await supabaseAdmin
        .schema('public')
        .from('openai_model_price_sync_log')
        .update({
          sync_finished_at: new Date().toISOString(),
          status,
          models_found_count: foundCount,
          models_updated_count: updatedCount,
          models_inserted_count: insertedCount,
          error_message: errors.length ? JSON.stringify(errors) : null,
          raw_payload: {
            trigger_reason: triggerReason,
            results,
            errors,
          },
        })
        .eq('id', syncLogId)
    }

    return {
      ok: status !== 'failed',
      status,
      modelsFoundCount: foundCount,
      modelsUpdatedCount: updatedCount,
      modelsInsertedCount: insertedCount,
      errors,
      results,
    }
  } catch (error) {
    if (syncLogId) {
      await supabaseAdmin
        .schema('public')
        .from('openai_model_price_sync_log')
        .update({
          sync_finished_at: new Date().toISOString(),
          status: 'failed',
          models_found_count: foundCount,
          models_updated_count: updatedCount,
          models_inserted_count: insertedCount,
          error_message: error?.message || 'SYNC_FAILED',
          raw_payload: {
            trigger_reason: triggerReason,
            results,
            errors,
          },
        })
        .eq('id', syncLogId)
    }
    return {
      ok: false,
      status: 'failed',
      modelsFoundCount: foundCount,
      modelsUpdatedCount: updatedCount,
      modelsInsertedCount: insertedCount,
      errors: [...errors, { message: error?.message || 'SYNC_FAILED' }],
      results,
    }
  }
}

export const ensureOpenAIModelPricingFresh = async (supabaseAdmin, options = {}) => {
  const maxAgeDays =
    Number.isFinite(Number(options.maxAgeDays)) && Number(options.maxAgeDays) > 0
      ? Number(options.maxAgeDays)
      : MAX_SYNC_AGE_DAYS
  const status = await getOpenAIModelPricingStatus(supabaseAdmin)
  const latestSuccessAt =
    status.latestSync?.status === 'success' || status.latestSync?.status === 'partial_success'
      ? status.latestSync.sync_finished_at || status.latestSync.sync_started_at
      : null
  const ageMs = latestSuccessAt ? Date.now() - new Date(latestSuccessAt).getTime() : Number.POSITIVE_INFINITY
  const isFresh = Number.isFinite(ageMs) && ageMs <= maxAgeDays * 24 * 60 * 60 * 1000
  if (isFresh && status.activeSnapshots.length > 0) {
    return { synced: false, status }
  }
  const syncResult = await syncOpenAIModelPricing(supabaseAdmin, {
    reason: options.reason || 'stale_refresh',
  })
  const refreshedStatus = await getOpenAIModelPricingStatus(supabaseAdmin)
  return {
    synced: true,
    syncResult,
    status: refreshedStatus,
  }
}
