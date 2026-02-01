import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { runLlmTask, createRateLimiter } from '../../llm/llmRouter.mjs'

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 })

const sanitizeReportText = (input) => {
  let value = String(input ?? '')
  value = value.replace(/\(\s*(?:[ABC][123]\s*(?:,\s*[ABC][123]\s*)*)\)/g, '')
  value = value.replace(
    /(^|[\s\u00A0])([ABC][123])(?=([\s\u00A0]*[.,;:!?)]|[\s\u00A0]*$))/g,
    '$1'
  )
  value = value.replace(/\(\s*\)/g, '')
  value = value.replace(/\s+/g, ' ').replace(/\s+([.,;:!?\)])/g, '$1').trim()
  return value
}

const sanitizeReportPayload = (payload) => {
  if (payload == null) return payload
  if (typeof payload === 'string') return sanitizeReportText(payload)
  if (Array.isArray(payload)) return payload.map((item) => sanitizeReportPayload(item))
  if (typeof payload === 'object') {
    const next = {}
    Object.entries(payload).forEach(([key, value]) => {
      next[key] = sanitizeReportPayload(value)
    })
    return next
  }
  return payload
}

const validateAndNormalizeReport = (payload) => {
  const empty = {
    summary: { today: '', change: '', product: '' },
    ideas: [],
    recommendations: null,
    source_snapshot: null,
  }
  if (!payload || typeof payload !== 'object') return { ...empty }
  const value = payload
  let summary = empty.summary
  if (value.summary && typeof value.summary === 'object') {
    const s = value.summary
    summary = {
      today: typeof s.today === 'string' ? s.today : '',
      change: typeof s.change === 'string' ? s.change : '',
      product: typeof s.product === 'string' ? s.product : '',
    }
  } else if (
    typeof value.today === 'string' ||
    typeof value.change === 'string' ||
    typeof value.product === 'string'
  ) {
    summary = {
      today: typeof value.today === 'string' ? value.today : '',
      change: typeof value.change === 'string' ? value.change : '',
      product: typeof value.product === 'string' ? value.product : '',
    }
  }
  const ideas = Array.isArray(value.ideas) ? value.ideas : []
  return {
    summary,
    ideas,
    recommendations: value.recommendations ?? null,
    source_snapshot: value.source_snapshot ?? null,
  }
}

const validateRecommendationsSection = (payload) => {
  const recs = payload?.recommendations
  if (!recs || typeof recs !== 'object') {
    return { ok: false, errors: ['recommendations_missing'] }
  }
  const groups = ['based_on_user_ideas', 'morphological', 'market_trends']
  const errors = []
  const isValidItem = (item) =>
    item &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0 &&
    typeof item.rationale === 'string' &&
    item.rationale.trim().length > 0 &&
    typeof item.how_to_test === 'string' &&
    item.how_to_test.trim().length > 0 &&
    (!item.methods || Array.isArray(item.methods)) &&
    (!item.confidence || ['low', 'med', 'high'].includes(item.confidence))
  groups.forEach((key) => {
    if (!Array.isArray(recs[key])) {
      errors.push(`group_not_array:${key}`)
      return
    }
    if (!recs[key].length) {
      errors.push(`group_empty:${key}`)
      return
    }
    if (!recs[key].every(isValidItem)) {
      errors.push(`group_invalid_items:${key}`)
    }
  })
  return { ok: errors.length === 0, errors }
}

const toTimeValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const asNumber = Number(value)
    if (!Number.isNaN(asNumber)) return asNumber
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const buildContentHash = (items) => {
  const parts = items
    .map((item) => ({
      id: String(item.id ?? ''),
      updated_at: String(item.updated_at ?? item.created_at ?? ''),
      text: String(item.text ?? ''),
      label: String(item.label ?? ''),
      question_text_pl: String(item.question_text_pl ?? ''),
      question_text_en: String(item.question_text_en ?? ''),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (item) =>
        `${item.id}|${item.updated_at}|${item.text}|${item.label}|${item.question_text_pl}|${item.question_text_en}`
    )
    .join('||')
  let hash = 0
  for (let i = 0; i < parts.length; i += 1) {
    hash = (hash << 5) - hash + parts.charCodeAt(i)
    hash |= 0
  }
  return String(hash)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }
  console.log('[report:update] step3')
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const sessionId = String(body.sessionId || '').trim()
    if (!sessionId) {
      res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' })
      return
    }
    const supabaseAdmin = getSupabaseAdmin()
    const reportRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .select('summary_json,source_updated_at,last_summary_text_hash')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (reportRes.error) {
      res.status(500).json({ ok: false, error: reportRes.error })
      return
    }
    const boardRes = await supabaseAdmin
      .schema('public')
      .from('board_items')
      .select('id,created_at,updated_at,text,label,question_text_pl,question_text_en')
      .eq('session_id', sessionId)
    if (boardRes.error) {
      res.status(500).json({ ok: false, error: boardRes.error })
      return
    }
    const items = boardRes.data || []
    const latestBoardItemAt = items.reduce(
      (max, item) =>
        Math.max(max, toTimeValue(item.updated_at || item.created_at || 0)),
      0
    )
    const contentHash = buildContentHash(items)
    const existingNormalized = validateAndNormalizeReport(reportRes.data?.summary_json ?? null)
    const existingSanitized = sanitizeReportPayload(existingNormalized)

    const representativeItems = items
      .slice(0, 25)
      .map((item) => ({
        text: String(item.text ?? '').trim(),
        label: item.label ?? '',
        question:
          String(item.question_text_pl || item.question_text_en || '').trim() || '',
      }))
      .filter((item) => item.text)
      .slice(0, 25)

    const preprocessInput = JSON.stringify({
      lang: 'pl',
      session_id: sessionId,
      items: representativeItems,
    })

    let analysisJson = null
    try {
      const preprocessResult = await runLlmTask({
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        task: 'report-preprocess',
        input: preprocessInput,
        language: 'Polish',
        taskInstructions:
          'Return ONLY valid JSON. No markdown. Schema: { "lang":"pl|en","topic":"1-2 sentences","key_themes":["3-6 short phrases"],"tensions_or_opportunities":["3-6 short bullets"],"representative_items":[{"quote":"...","label":"","question":""}],"user_intent":"optional 1 sentence" }. Do NOT include matrix codes A1..C3.',
        parseResponse: (value) => {
          try {
            const parsed = JSON.parse(value)
            if (!parsed || typeof parsed !== 'object') return null
            if (!Array.isArray(parsed.key_themes)) return null
            if (!Array.isArray(parsed.tensions_or_opportunities)) return null
            if (!Array.isArray(parsed.representative_items)) return null
            return parsed
          } catch {
            return null
          }
        },
        fallbackData: null,
        models: {
          default: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
          preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
          escalation: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
        },
        maxOutputTokens: 300,
        rateLimiter: limiter,
        rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      })
      if (preprocessResult.ok && preprocessResult.data) {
        analysisJson = preprocessResult.data
      }
    } catch {
      analysisJson = null
    }

    const defaultPrompt = JSON.stringify({
      existing_summary_json: existingSanitized,
      analysis_json: analysisJson,
      requirements: {
        recommendations_groups: ['based_on_user_ideas', 'morphological', 'market_trends'],
        item_schema: {
          title: 'string',
          rationale: 'string',
          how_to_test: 'string',
          methods: ['string'],
          confidence: 'low|med|high',
        },
        notes: [
          'Return ONLY valid JSON. No markdown.',
          'Preserve all existing keys/sections; update recommendations in-place.',
          'Do not output matrix codes A1..C3 anywhere.',
          '3–5 items per group max.',
        ],
      },
      session_items: representativeItems,
    })

    const runDefault = async (modelOverride, validationErrors) =>
      runLlmTask({
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        task: 'report-full',
        input: JSON.stringify({
          prompt: defaultPrompt,
          validation_errors: validationErrors || null,
        }),
        language: 'Polish',
        taskInstructions:
          'Return ONLY valid JSON. No markdown. Update existing report JSON; update existing recommendations section in-place.',
        parseResponse: (value) => {
          try {
            const parsed = JSON.parse(value)
            if (!parsed || typeof parsed !== 'object') return null
            return parsed
          } catch {
            return null
          }
        },
        fallbackData: null,
        models: {
          default: modelOverride || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
          preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
          escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
        },
        maxOutputTokens: 1200,
        rateLimiter: limiter,
        rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      })

    let updatedReport = null
    let validationErrors = []
    let defaultResult = await runDefault()
    if (defaultResult.ok && defaultResult.data) {
      const validated = validateAndNormalizeReport(defaultResult.data)
      const recValidation = validateRecommendationsSection(validated)
      if (recValidation.ok) {
        updatedReport = validated
      } else {
        validationErrors = recValidation.errors
        defaultResult = await runDefault(undefined, validationErrors)
        if (defaultResult.ok && defaultResult.data) {
          const validatedRetry = validateAndNormalizeReport(defaultResult.data)
          const recValidationRetry = validateRecommendationsSection(validatedRetry)
          if (recValidationRetry.ok) {
            updatedReport = validatedRetry
          }
        }
      }
    }
    if (!updatedReport) {
      const escalationResult = await runDefault(
        process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
        validationErrors
      )
      if (escalationResult.ok && escalationResult.data) {
        const validatedEscalation = validateAndNormalizeReport(escalationResult.data)
        const recValidationEscalation = validateRecommendationsSection(validatedEscalation)
        if (recValidationEscalation.ok) {
          updatedReport = validatedEscalation
        }
      }
    }

    let nextPayload = updatedReport || existingSanitized
    if (!updatedReport) {
      nextPayload = {
        ...existingSanitized,
        recommendations: existingSanitized.recommendations ?? null,
      }
    }
    nextPayload = {
      ...nextPayload,
      source_snapshot: {
        ...(nextPayload.source_snapshot || {}),
        board_items_count: items.length,
        latest_board_item_at: latestBoardItemAt,
        content_hash: contentHash,
      },
    }
    const sanitized = sanitizeReportPayload(nextPayload)
    const updateRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .update({
        summary_json: sanitized,
        last_summary_text_hash: contentHash,
        source_updated_at: latestBoardItemAt || Date.now(),
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
    if (updateRes.error) {
      res.status(500).json({ ok: false, error: updateRes.error })
      return
    }
    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: {
        message: error?.message ?? 'Unknown error',
      },
    })
  }
}
