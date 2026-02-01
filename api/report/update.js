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

const normalizeRecommendations = (value) => {
  const defaultRecommendations = {
    based_on_user_ideas: [],
    morphological: [],
    market_trends: [],
  }
  if (!value || typeof value !== 'object') return { ...defaultRecommendations }
  const recs = value
  return {
    based_on_user_ideas: Array.isArray(recs.based_on_user_ideas)
      ? recs.based_on_user_ideas
      : [],
    morphological: Array.isArray(recs.morphological) ? recs.morphological : [],
    market_trends: Array.isArray(recs.market_trends) ? recs.market_trends : [],
  }
}

const validateAndNormalizeReport = (payload) => {
  const empty = {
    summary: { today: '', change: '', product: '' },
    ideas: [],
    items: [],
    recommendations: {
      based_on_user_ideas: [],
      morphological: [],
      market_trends: [],
    },
    source_snapshot: null,
  }
  if (!payload || typeof payload !== 'object') return { ...empty }
  const value = payload
  let summary =
    value.summary && typeof value.summary === 'object'
      ? value.summary
      : typeof value.today === 'string' ||
          typeof value.change === 'string' ||
          typeof value.product === 'string'
        ? { today: value.today, change: value.change, product: value.product }
        : empty.summary
  if (value.summary && typeof value.summary === 'object') {
    const s = value.summary
    summary = {
      today: typeof s.today === 'string' ? s.today : String(s.today ?? ''),
      change: typeof s.change === 'string' ? s.change : String(s.change ?? ''),
      product: typeof s.product === 'string' ? s.product : String(s.product ?? ''),
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
  const items = Array.isArray(value.items) ? value.items : []
  const recommendations = normalizeRecommendations(value.recommendations)
  return {
    summary,
    ideas,
    items,
    recommendations,
    source_snapshot: value.source_snapshot ?? null,
  }
}

const validateRecommendations = (recommendations) => {
  const recs = recommendations
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
    if (recs[key].length !== 2) {
      errors.push(`group_count_invalid:${key}:${recs[key].length}`)
      return
    }
    if (!recs[key].every(isValidItem)) {
      errors.push(`group_invalid_items:${key}`)
    }
  })
  return { ok: errors.length === 0, errors }
}

const logRecommendationCounts = (label, recommendations) => {
  if (!recommendations || typeof recommendations !== 'object') {
    console.log(`[report:update][step3] ${label} recommendations missing`)
    return
  }
  const ideasCount = recommendations.based_on_user_ideas?.length || 0
  const morphCount = recommendations.morphological?.length || 0
  const trendsCount = recommendations.market_trends?.length || 0
  console.log(
    `[report:update][step3] ${label} rec counts: ideas=${ideasCount} morph=${morphCount} trends=${trendsCount}`
  )
}

const validateSummary = (summary, itemsCount) => {
  const errors = []
  if (!summary || typeof summary !== 'object') {
    return { ok: false, errors: ['summary_missing'] }
  }
  const today = typeof summary.today === 'string' ? summary.today.trim() : ''
  const change = typeof summary.change === 'string' ? summary.change.trim() : ''
  if (itemsCount >= 3) {
    if (today.length < 30) errors.push('summary_today_too_short')
    if (change.length < 30) errors.push('summary_change_too_short')
    const insufficientPatterns = [
      /brak wystarczających danych/i,
      /brak informacji/i,
      /brak wpisów/i,
      /zbyt mało informacji/i,
    ]
    if (insufficientPatterns.some((pattern) => pattern.test(today) || pattern.test(change))) {
      errors.push('summary_insufficient')
    }
  } else if (!today || !change) {
    errors.push('summary_empty')
  }
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
      .select(
        'id,created_at,updated_at,text,label,question_text_pl,question_text_en,matrix_row,matrix_col,question_id'
      )
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

    const itemsFromDb = items.map((item) => ({
      id: item.id,
      text: item.text,
      label: item.label ?? '',
      matrixRow: item.matrix_row ?? null,
      matrixCol: item.matrix_col ?? null,
      questionId: item.question_id ?? null,
      questionTextPl: item.question_text_pl ?? null,
      questionTextEn: item.question_text_en ?? null,
    }))
    const phaseAReport = {
      ...existingNormalized,
      items: itemsFromDb,
      recommendations: normalizeRecommendations(existingNormalized.recommendations),
      source_snapshot: {
        ...(existingNormalized.source_snapshot || {}),
        board_items_count: items.length,
        latest_board_item_at: latestBoardItemAt,
        content_hash: contentHash,
      },
    }
    const phaseASanitized = sanitizeReportPayload(phaseAReport)
    const reportItemsCount = Array.isArray(phaseASanitized.items) ? phaseASanitized.items.length : 0
    console.log(
      '[report:update] db_items',
      items.length,
      'report_items',
      reportItemsCount
    )
    if (reportItemsCount !== items.length) {
      console.log('[report:update] items_count_mismatch', {
        db: items.length,
        report: reportItemsCount,
      })
    }
    const phaseAUpdateRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .update({
        summary_json: phaseASanitized,
        last_summary_text_hash: contentHash,
        source_updated_at: latestBoardItemAt || Date.now(),
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
    if (phaseAUpdateRes.error) {
      res.status(500).json({ ok: false, error: phaseAUpdateRes.error })
      return
    }

    try {
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
      const themeCount = Array.isArray(analysisJson?.key_themes) ? analysisJson.key_themes.length : 0
      console.log('[report:update][step3] preprocess themes', themeCount)

      const defaultPrompt = JSON.stringify({
        existing_summary: phaseASanitized.summary ?? null,
        analysis_json: analysisJson,
        requirements: {
          output_schema: {
            summary: { today: 'string', change: 'string', product: 'string' },
            recommendations: {
              based_on_user_ideas: [
                {
                  title: 'string',
                  rationale: 'string',
                  how_to_test: 'string',
                  methods: ['string'],
                  confidence: 'low|med|high',
                },
              ],
              morphological: [
                {
                  title: 'string',
                  rationale: 'string',
                  how_to_test: 'string',
                  methods: ['string'],
                  confidence: 'low|med|high',
                },
              ],
              market_trends: [
                {
                  title: 'string',
                  rationale: 'string',
                  how_to_test: 'string',
                  methods: ['string'],
                  confidence: 'low|med|high',
                },
              ],
            },
          },
          notes: [
            'You MUST return a single valid JSON object with ONLY: summary, recommendations.',
            'No markdown. No commentary. Do not include items or source_snapshot.',
            'Zawsze wypełnij summary.today i summary.change. Jeśli liczba wpisów >= 3, nie wolno zwrócić pustych pól ani tekstu "Brak wystarczających danych...".',
            'W sekcji "Podsumowanie" pisz zawsze w 2. osobie liczby pojedynczej, jak facylitator zwracający się do użytkownika. Używaj form: "Planujesz…", "Chcesz…", "Masz…", "Zależy Ci…". Nie używaj 3. osoby ("Użytkownik", "Autor", "Osoba").',
            'The JSON MUST include "recommendations" as an OBJECT (never null, never string).',
            'It MUST contain exactly these keys: based_on_user_ideas, morphological, market_trends.',
          'Each array MUST contain exactly 2 items.',
            'Each item MUST have non-empty fields: title, rationale, how_to_test.',
            'If session data is sparse, create minimal but still concrete items (not generic).',
            'Do not output matrix codes A1..C3 anywhere.',
          'Exactly 2 items per group.',
            'Rationale should reference analysis_json themes/representative_items briefly (no long quotes).',
          ],
        },
        session_items: representativeItems,
      })

      const runDefault = async (modelOverride, validationErrors) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-summary-recs',
          input: JSON.stringify({
            prompt: defaultPrompt,
            validation_errors: validationErrors || null,
          }),
          language: 'Polish',
          taskInstructions:
            'Return ONLY valid JSON with keys summary and recommendations. Do not include items. recommendations must be an object with 3 arrays; each array min 1 item; items must include title, rationale, how_to_test; never output A1..C3.',
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

      console.log('[report:update] itemsCount', itemsFromDb.length)
      let validationErrors = []
      let summaryCandidate = phaseASanitized.summary
      let recommendationsCandidate = normalizeRecommendations(phaseASanitized.recommendations)
      let summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length)
      let recValidation = validateRecommendations(recommendationsCandidate)

      const applyGenerated = (generated) => {
        if (!generated || typeof generated !== 'object') return
        if (generated.summary && typeof generated.summary === 'object') {
          summaryCandidate = generated.summary
          summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length)
        }
        if (generated.recommendations && typeof generated.recommendations === 'object') {
          recommendationsCandidate = normalizeRecommendations(generated.recommendations)
          recValidation = validateRecommendations(recommendationsCandidate)
        }
      }

      let defaultResult = await runDefault()
      if (defaultResult.ok && defaultResult.data) {
        applyGenerated(defaultResult.data)
        logRecommendationCounts('default', recommendationsCandidate)
        console.log('[report:update][step3] summary validation', summaryValidation.errors)
        console.log('[report:update][step3] validation errors', recValidation.errors)
        if (!recValidation.ok || !summaryValidation.ok) {
          validationErrors = recValidation.errors.concat(summaryValidation.errors || [])
          console.log('[report:update][step3] retry default')
          defaultResult = await runDefault(undefined, validationErrors)
          if (defaultResult.ok && defaultResult.data) {
            applyGenerated(defaultResult.data)
            logRecommendationCounts('retry', recommendationsCandidate)
            console.log('[report:update][step3] retry validation errors', recValidation.errors)
            console.log('[report:update][step3] retry summary validation', summaryValidation.errors)
          }
        }
      }
      if (!recValidation.ok || !summaryValidation.ok) {
        console.log('[report:update][step3] escalation')
        const escalationResult = await runDefault(
          process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          validationErrors
        )
        if (escalationResult.ok && escalationResult.data) {
          applyGenerated(escalationResult.data)
          logRecommendationCounts('escalation', recommendationsCandidate)
          console.log('[report:update][step3] escalation validation errors', recValidation.errors)
          console.log('[report:update][step3] escalation summary validation', summaryValidation.errors)
        }
      }

      const summaryLength = {
        today:
          typeof summaryCandidate?.today === 'string' ? summaryCandidate.today.length : 0,
        change:
          typeof summaryCandidate?.change === 'string' ? summaryCandidate.change.length : 0,
      }
      console.log(
        '[report:update] summary',
        `today_len=${summaryLength.today}`,
        `change_len=${summaryLength.change}`
      )

      const fallbackSummary = (() => {
        const topic = typeof analysisJson?.topic === 'string' ? analysisJson.topic.trim() : ''
        const topicSuffix = topic ? ` dotyczących: ${topic}.` : '.'
        return {
          today: `Masz ${itemsFromDb.length} wpisów${topicSuffix}`,
          change:
            'Dodaj więcej szczegółów lub doprecyzuj kryteria, aby uzyskać pełniejsze podsumowanie.',
          product: '',
        }
      })()
      const hasUsableExistingSummary =
        typeof phaseASanitized.summary?.today === 'string' &&
        phaseASanitized.summary.today.trim().length >= 30 &&
        typeof phaseASanitized.summary?.change === 'string' &&
        phaseASanitized.summary.change.trim().length >= 30 &&
        !/brak wystarczających danych/i.test(phaseASanitized.summary.today) &&
        !/brak wystarczających danych/i.test(phaseASanitized.summary.change)
      const finalSummary = summaryValidation.ok
        ? summaryCandidate
        : hasUsableExistingSummary
          ? phaseASanitized.summary
          : fallbackSummary
      if (!summaryValidation.ok) {
        console.log('[report:update][step3] summary fallback', summaryValidation.errors)
      }
      const finalRecommendations = recValidation.ok
        ? recommendationsCandidate
        : { based_on_user_ideas: [], morphological: [], market_trends: [] }
      if (!recValidation.ok) {
        console.log('[report:update][step3] recommendations fallback', recValidation.errors)
      }

      const nextPayload = {
        ...phaseASanitized,
        summary: finalSummary,
        recommendations: finalRecommendations,
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
      return
    } catch (error) {
      console.log('[report:update][step3] phaseB failed', error?.message ?? 'unknown error')
      res.status(200).json({ ok: true })
      return
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: {
        message: error?.message ?? 'Unknown error',
      },
    })
  }
}
