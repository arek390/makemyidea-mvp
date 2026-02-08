import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { chargeUserBalance, normalizeBillingError } from '../billing.js'
import { sendJson } from '../http.js'
import { runLlmTask, createRateLimiter } from '../../../llm/llmRouter.mjs'

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 })

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

const normalizeReportLang = (value) => {
  if (!value) return null
  const normalized = String(value).toLowerCase().trim()
  if (normalized === 'pl' || normalized === 'polish') return 'pl'
  if (normalized === 'en' || normalized === 'english') return 'en'
  return null
}

const toLlmLanguage = (lang) => (lang === 'en' ? 'English' : 'Polish')

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
    lang: null,
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
  const lang = normalizeReportLang(value.lang)
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
    lang,
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

const isReportGenerated = (summaryJson) => {
  if (!summaryJson || typeof summaryJson !== 'object') return false
  const normalized = validateAndNormalizeReport(summaryJson)
  const summary = normalized.summary || {}
  const hasSummary =
    Boolean(String(summary.today || '').trim()) ||
    Boolean(String(summary.change || '').trim()) ||
    Boolean(String(summary.product || '').trim())
  const hasIdeas = Array.isArray(normalized.ideas) && normalized.ideas.length > 0
  const recs = normalized.recommendations || {}
  const hasRecs =
    Array.isArray(recs.based_on_user_ideas) && recs.based_on_user_ideas.length > 0 ||
    Array.isArray(recs.morphological) && recs.morphological.length > 0 ||
    Array.isArray(recs.market_trends) && recs.market_trends.length > 0
  return hasSummary || hasIdeas || hasRecs
}

const handleBillingError = (res, error) => {
  const normalized = normalizeBillingError(error)
  if (!normalized) return false
  if (normalized.code === 'INSUFFICIENT_BALANCE') {
    sendJson(res, 402, { ok: false, error: 'INSUFFICIENT_BALANCE' })
    return true
  }
  sendJson(res, normalized.status || 500, {
    ok: false,
    error: normalized.code || 'BILLING_FAILED',
  })
  return true
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

const logSummaryLengths = (label, summary) => {
  const todayLen = typeof summary?.today === 'string' ? summary.today.length : 0
  const changeLen = typeof summary?.change === 'string' ? summary.change.length : 0
  const productLen = typeof summary?.product === 'string' ? summary.product.length : 0
  console.log(
    `[report:update][step3] ${label} summary lengths: today=${todayLen} change=${changeLen} product=${productLen}`
  )
}

const logLlmMeta = (label, result) => {
  const meta = result?.meta || null
  if (!meta) return
  console.log(`[report:update][step3] ${label} llm`, {
    model: meta.modelUsed ?? null,
    escalated: meta.escalated ?? false,
    tokens: meta.tokens ?? null,
  })
}

const validateSummary = (summary, itemsCount, lang = 'pl') => {
  const errors = []
  if (!summary || typeof summary !== 'object') {
    return { ok: false, errors: ['summary_missing'] }
  }
  const today = typeof summary.today === 'string' ? summary.today.trim() : ''
  const change = typeof summary.change === 'string' ? summary.change.trim() : ''
  const product = typeof summary.product === 'string' ? summary.product.trim() : ''
  if (itemsCount >= 3) {
    if (today.length < 30) errors.push('summary_today_too_short')
    if (change.length < 30) errors.push('summary_change_too_short')
    if (!product) errors.push('summary_product_empty')
    const insufficientPatterns =
      lang === 'en'
        ? [
            /not enough data/i,
            /insufficient data/i,
            /no (direct )?information/i,
            /no entries/i,
            /cannot generate/i,
          ]
        : [
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

export const handleReportUpdate = async (req, res) => {
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
    const token = getBearerToken(req)
    if (!token) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' })
      return
    }
    const requestedLang = normalizeReportLang(body.lang || body.language || body.reportLanguage)
    const supabaseAdmin = getSupabaseAdmin()
    const authRes = await supabaseAdmin.auth.getUser(token)
    const userId = authRes?.data?.user?.id || null
    if (authRes?.error || !userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' })
      return
    }
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
    try {
      const requestId = randomUUID()
      await chargeUserBalance(userId, 'report_update', requestId, supabaseAdmin)
    } catch (error) {
      if (handleBillingError(res, error)) return
      sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
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
    const reportLang = normalizeReportLang(existingNormalized.lang) || requestedLang || 'pl'
    const llmLanguage = toLlmLanguage(reportLang)

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
      lang: reportLang,
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
        .map((item) => {
          const question =
            reportLang === 'en'
              ? item.question_text_en || item.question_text_pl || ''
              : item.question_text_pl || item.question_text_en || ''
          return {
            text: String(item.text ?? '').trim(),
            label: item.label ?? '',
            question: String(question).trim() || '',
          }
        })
        .filter((item) => item.text)
        .slice(0, 25)

      const preprocessInput = JSON.stringify({
        lang: reportLang,
        session_id: sessionId,
        items: representativeItems,
      })

      let analysisJson = null
      try {
        const preprocessTaskInstructions =
          reportLang === 'en'
            ? 'Return ONLY valid JSON. No markdown. Schema: { "lang":"pl|en","topic":"1-2 sentences","key_themes":["3-6 short phrases"],"tensions_or_opportunities":["3-6 short bullets"],"representative_items":[{"quote":"...","label":"","question":""}],"user_intent":"optional 1 sentence" }. Do NOT include matrix codes A1..C3. Output must be in English.'
            : 'Zwróć WYŁĄCZNIE poprawny JSON. Bez markdown. Schemat: { "lang":"pl|en","topic":"1-2 sentences","key_themes":["3-6 short phrases"],"tensions_or_opportunities":["3-6 short bullets"],"representative_items":[{"quote":"...","label":"","question":""}],"user_intent":"optional 1 sentence" }. Nie używaj kodów A1..C3. Całość po polsku.'
        const preprocessResult = await runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-preprocess',
          input: preprocessInput,
          sessionId,
          language: llmLanguage,
          taskInstructions: preprocessTaskInstructions,
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

      const summaryNotes =
        reportLang === 'en'
          ? [
              'Always fill summary.today and summary.change. If entries >= 3, do not return empty fields or "Not enough data...".',
              'Always return summary.product as a string; never omit the field.',
              'In the "Summary" section, write in 2nd person singular, like a facilitator addressing the user. Use forms like "You plan…", "You want…", "You care about…". Do not use 3rd person ("The user", "The author").',
              'Output must be written in English.',
            ]
          : [
              'Zawsze wypełnij summary.today i summary.change. Jeśli liczba wpisów >= 3, nie wolno zwrócić pustych pól ani tekstu "Brak wystarczających danych...".',
              'Zawsze zwróć summary.product jako string; nie pomijaj pola.',
              'W sekcji "Podsumowanie" pisz zawsze w 2. osobie liczby pojedynczej, jak facylitator zwracający się do użytkownika. Używaj form: "Planujesz…", "Chcesz…", "Masz…", "Zależy Ci…". Nie używaj 3. osoby ("Użytkownik", "Autor", "Osoba").',
              'Całość musi być napisana po polsku.',
            ]

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
            'The JSON MUST include "recommendations" as an OBJECT (never null, never string).',
            'It MUST contain exactly these keys: based_on_user_ideas, morphological, market_trends.',
            'Each array MUST contain exactly 2 items.',
            'Each item MUST have non-empty fields: title, rationale, how_to_test.',
            'If session data is sparse, create minimal but still concrete items (not generic).',
            'Do not output matrix codes A1..C3 anywhere.',
            'Exactly 2 items per group.',
            'Rationale should reference analysis_json themes/representative_items briefly (no long quotes).',
            ...summaryNotes,
          ],
        },
        session_items: representativeItems,
      })

      const defaultTaskInstructions =
        reportLang === 'en'
          ? 'Return ONLY valid JSON with keys summary and recommendations. Do not include items. recommendations must be an object with 3 arrays; each array min 1 item; items must include title, rationale, how_to_test; never output A1..C3. Output must be in English.'
          : 'Zwróć WYŁĄCZNIE poprawny JSON z kluczami summary i recommendations. Nie dodawaj items. recommendations musi być obiektem z 3 tablicami; każda tablica min 1 element; elementy muszą mieć title, rationale, how_to_test; nie wypisuj A1..C3. Całość po polsku.'

      const runDefault = async (modelOverride, validationErrors) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-summary-recs',
          input: JSON.stringify({
            prompt: defaultPrompt,
            validation_errors: validationErrors || null,
          }),
          sessionId,
          language: llmLanguage,
          taskInstructions: defaultTaskInstructions,
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
      let summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length, reportLang)
      let recValidation = validateRecommendations(recommendationsCandidate)
      logSummaryLengths('existing', phaseASanitized.summary)

      const applyGenerated = (generated) => {
        if (!generated || typeof generated !== 'object') return
        if (generated.summary && typeof generated.summary === 'object') {
          summaryCandidate = generated.summary
          summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length, reportLang)
        }
        if (generated.recommendations && typeof generated.recommendations === 'object') {
          recommendationsCandidate = normalizeRecommendations(generated.recommendations)
          recValidation = validateRecommendations(recommendationsCandidate)
        }
      }

      let defaultResult = await runDefault()
      if (defaultResult.ok && defaultResult.data) {
        logLlmMeta('default', defaultResult)
        applyGenerated(defaultResult.data)
        logRecommendationCounts('default', recommendationsCandidate)
        console.log('[report:update][step3] summary validation', summaryValidation.errors)
        console.log('[report:update][step3] validation errors', recValidation.errors)
        if (!recValidation.ok || !summaryValidation.ok) {
          validationErrors = recValidation.errors.concat(summaryValidation.errors || [])
          if (recValidation.errors.some((err) => err.startsWith('group_count_invalid'))) {
            validationErrors.push('wrong_item_count_return_exactly_2_per_list')
          }
          console.log('[report:update][step3] retry default')
          defaultResult = await runDefault(undefined, validationErrors)
          if (defaultResult.ok && defaultResult.data) {
            logLlmMeta('retry', defaultResult)
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
          logLlmMeta('escalation', escalationResult)
          applyGenerated(escalationResult.data)
          logRecommendationCounts('escalation', recommendationsCandidate)
          console.log('[report:update][step3] escalation validation errors', recValidation.errors)
          console.log('[report:update][step3] escalation summary validation', summaryValidation.errors)
        }
      }

      logSummaryLengths('generated', summaryCandidate)

      const fallbackSummary = (() => {
        const topic = typeof analysisJson?.topic === 'string' ? analysisJson.topic.trim() : ''
        if (reportLang === 'en') {
          const topicSuffix = topic ? ` about: ${topic}.` : '.'
          return {
            today: `You have ${itemsFromDb.length} entries${topicSuffix}`,
            change: 'Add more detail or refine your criteria to get a richer summary.',
            product: '',
          }
        }
        const topicSuffix = topic ? ` dotyczących: ${topic}.` : '.'
        return {
          today: `Masz ${itemsFromDb.length} wpisów${topicSuffix}`,
          change:
            'Dodaj więcej szczegółów lub doprecyzuj kryteria, aby uzyskać pełniejsze podsumowanie.',
          product: '',
        }
      })()
      const insufficientSummaryPattern =
        reportLang === 'en'
          ? /not enough data|insufficient data|no (direct )?information|no entries|cannot generate/i
          : /brak wystarczających danych|brak informacji|brak wpisów|zbyt mało informacji/i
      const hasUsableExistingSummary =
        typeof phaseASanitized.summary?.today === 'string' &&
        phaseASanitized.summary.today.trim().length >= 30 &&
        typeof phaseASanitized.summary?.change === 'string' &&
        phaseASanitized.summary.change.trim().length >= 30 &&
        !insufficientSummaryPattern.test(phaseASanitized.summary.today) &&
        !insufficientSummaryPattern.test(phaseASanitized.summary.change)
      const finalSummary = summaryValidation.ok
        ? summaryCandidate
        : hasUsableExistingSummary
          ? phaseASanitized.summary
          : fallbackSummary
      if (!summaryValidation.ok) {
        console.log('[report:update][step3] summary fallback', summaryValidation.errors)
      }
      logSummaryLengths('final', finalSummary)
      console.log(
        '[report:update][step3] summary overwrite',
        summaryValidation.ok ? 'generated' : hasUsableExistingSummary ? 'existing' : 'fallback'
      )
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
      res.status(200).json({ ok: false })
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
