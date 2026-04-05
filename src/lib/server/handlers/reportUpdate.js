import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { chargeUserBalance, normalizeBillingError } from '../billing.js'
import { buildMeta, sendJson } from '../http.js'
import { recordSessionAiUsageEvent, recordSessionBillingEvent } from '../aiCostEvents.js'
import { runLlmTask, createRateLimiter } from '../../../llm/llmRouter.mjs'
import sharp from 'sharp'

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 })
const trizWatermarkAssetUrl = new URL('../../../../logo/logo_makemyideawork_transp.png', import.meta.url)
let trizWatermarkAssetPromise = null

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

const sanitizeReportText = (input) => {
  let value = String(input ?? '')
  const matrixCodeGroup = String.raw`(?:[ABC][123]\s*(?:,\s*[ABC][123]\s*)*)`
  value = value.replace(new RegExp(String.raw`\s*\(\s*${matrixCodeGroup}\)\s*[.;:!?]`, 'g'), '')
  value = value.replace(new RegExp(String.raw`\s*\(\s*${matrixCodeGroup}\)\s*`, 'g'), ' ')
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

const safeParseJson = (value) => {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  try {
    return { parsed: JSON.parse(raw), recovered: false, error: null }
  } catch (error) {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    const sliced = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
    const cleaned = sliced
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/,\s*([}\]])/g, '$1')
      .trim()
    try {
      return { parsed: JSON.parse(cleaned), recovered: true, error }
    } catch (recoveryError) {
      return { parsed: null, recovered: false, error, recoveryError }
    }
  }
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

const isValidTrizPrinciple = (value) => {
  if (!value || typeof value !== 'object') return false
  const item = value
  if (typeof item.name !== 'string' || item.name.trim().length === 0) return false
  if (item.id != null && (!Number.isFinite(Number(item.id)) || Number(item.id) <= 0)) return false
  if (item.rationale != null && typeof item.rationale !== 'string') return false
  if (item.how_to_apply != null && typeof item.how_to_apply !== 'string') return false
  return true
}

const normalizeTrizSolutionImage = (value) => {
  if (!value || typeof value !== 'object') return null
  const image = value
  const status =
    image.status === 'idle' || image.status === 'ready' || image.status === 'failed'
      ? image.status
      : undefined
  const storagePath =
    typeof image.storage_path === 'string' && image.storage_path.trim()
      ? image.storage_path.trim()
      : undefined
  const publicUrl =
    typeof image.public_url === 'string' && image.public_url.trim()
      ? image.public_url.trim()
      : undefined
  const mimeType =
    typeof image.mime_type === 'string' && image.mime_type.trim()
      ? image.mime_type.trim()
      : undefined
  const fileName =
    typeof image.file_name === 'string' && image.file_name.trim()
      ? image.file_name.trim()
      : undefined
  const generatedAt =
    typeof image.generated_at === 'string' && image.generated_at.trim()
      ? image.generated_at.trim()
      : undefined
  const prompt =
    typeof image.prompt === 'string' && image.prompt.trim() ? image.prompt.trim() : undefined
  const errorMessage =
    typeof image.error_message === 'string' && image.error_message.trim()
      ? image.error_message.trim()
      : undefined
  if (
    !status &&
    !storagePath &&
    !publicUrl &&
    !mimeType &&
    !fileName &&
    !generatedAt &&
    !prompt &&
    !errorMessage
  ) {
    return null
  }
  return {
    ...(status ? { status } : {}),
    ...(storagePath ? { storage_path: storagePath } : {}),
    ...(publicUrl ? { public_url: publicUrl } : {}),
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(fileName ? { file_name: fileName } : {}),
    ...(generatedAt ? { generated_at: generatedAt } : {}),
    ...(prompt ? { prompt } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
  }
}

const normalizeTrizSolutionImages = (value) => {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeTrizSolutionImage(item)).filter(Boolean)
}

const normalizeTrizSolution = (value, context = {}) => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    const prompt = buildTrizSketchPrompt({
      solution: { title: text, description: '' },
      contradiction: context,
      reportLang: 'en',
    })
    return {
      title: text,
      description: '',
      ...(prompt ? { sketch_prompt: prompt } : {}),
    }
  }
  if (!value || typeof value !== 'object') return null
  const solution = value
  const title = typeof solution.title === 'string' ? solution.title.trim() : ''
  const description = typeof solution.description === 'string' ? solution.description.trim() : ''
  const sketchPrompt =
    typeof solution.sketch_prompt === 'string' && solution.sketch_prompt.trim()
      ? solution.sketch_prompt.trim()
      : undefined
  const image = normalizeTrizSolutionImage(solution.image)
  const images = normalizeTrizSolutionImages(solution.images)
  const mergedImages = (() => {
    if (image && images.some((item) => item.storage_path && item.storage_path === image.storage_path)) {
      return images
    }
    if (image) return [image, ...images]
    return images
  })()
  if (!title && !description) return null
  const nextSolution = {
    title: title || description,
    description,
    ...(sketchPrompt ? { sketch_prompt: sketchPrompt } : {}),
    ...(image ? { image } : {}),
    ...(mergedImages.length ? { images: mergedImages } : {}),
  }
  if (!nextSolution.sketch_prompt) {
    nextSolution.sketch_prompt = buildTrizSketchPrompt({
      solution: nextSolution,
      contradiction: context,
      reportLang: 'en',
    })
  }
  return {
    ...nextSolution,
  }
}

const normalizeTriz = (value) => {
  const empty = {
    section_title: '',
    section_intro: '',
    contradictions: [],
  }
  if (!value || typeof value !== 'object') return { ...empty }
  const section = value
  const contradictions = Array.isArray(section.contradictions)
    ? section.contradictions
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const contradiction = item
          const principles = Array.isArray(contradiction.principles)
            ? contradiction.principles
                .filter(isValidTrizPrinciple)
                .map((principle) => ({
                  ...(principle.id != null ? { id: Number(principle.id) } : {}),
                  name: String(principle.name).trim(),
                  ...(typeof principle.rationale === 'string' && principle.rationale.trim()
                    ? { rationale: principle.rationale.trim() }
                    : {}),
                  ...(typeof principle.how_to_apply === 'string' && principle.how_to_apply.trim()
                    ? { how_to_apply: principle.how_to_apply.trim() }
                    : {}),
                }))
                .slice(0, 5)
            : []
          const solutions = Array.isArray(contradiction.solutions)
            ? contradiction.solutions
                .map((solution) =>
                  normalizeTrizSolution(solution, {
                    title: contradiction.title,
                    description: contradiction.description,
                  })
                )
                .filter(Boolean)
                .slice(0, 3)
            : []
          const title = typeof contradiction.title === 'string' ? contradiction.title.trim() : ''
          const description =
            typeof contradiction.description === 'string' ? contradiction.description.trim() : ''
          const improving =
            typeof contradiction.improving === 'string' ? contradiction.improving.trim() : ''
          const worsening =
            typeof contradiction.worsening === 'string' ? contradiction.worsening.trim() : ''
          if (!title || !description || !improving || !worsening) return null
          return {
            title,
            description,
            improving,
            worsening,
            principles,
            solutions,
          }
        })
        .filter(Boolean)
        .slice(0, 3)
    : []
  return {
    section_title:
      typeof section.section_title === 'string' ? section.section_title.trim() : '',
    section_intro:
      typeof section.section_intro === 'string' ? section.section_intro.trim() : '',
    contradictions,
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
    triz: {
      section_title: '',
      section_intro: '',
      contradictions: [],
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
  const triz = normalizeTriz(value.triz)
  return {
    lang,
    summary,
    ideas,
    items,
    recommendations,
    triz,
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

const validateTriz = (triz) => {
  if (!triz || typeof triz !== 'object') {
    return { ok: true, errors: [] }
  }
  const contradictions = Array.isArray(triz.contradictions) ? triz.contradictions : []
  const errors = []
  if (contradictions.length > 3) errors.push('triz_too_many_contradictions')
  contradictions.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`triz_invalid_item:${index}`)
      return
    }
    if (!String(item.title || '').trim()) errors.push(`triz_missing_title:${index}`)
    if (!String(item.description || '').trim()) errors.push(`triz_missing_description:${index}`)
    if (!String(item.improving || '').trim()) errors.push(`triz_missing_improving:${index}`)
    if (!String(item.worsening || '').trim()) errors.push(`triz_missing_worsening:${index}`)
    if (!Array.isArray(item.principles)) errors.push(`triz_principles_not_array:${index}`)
    if (!Array.isArray(item.solutions)) errors.push(`triz_solutions_not_array:${index}`)
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
  const hasTriz =
    Array.isArray(normalized.triz?.contradictions) && normalized.triz.contradictions.length > 0
  return hasSummary || hasIdeas || hasRecs || hasTriz
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

const REPORT_SELECT_FIELDS =
  'id,session_id,created_at,updated_at,summary_json,last_summary_text_hash,source_updated_at'

const logTrizImage = (level, stage, meta = null) => {
  if (level === 'log') return
  const logger =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  logger('[triz-image]', stage, meta)
}

const sendTrizImageError = (res, status, code, message) => {
  sendJson(res, status, {
    ok: false,
    code,
    message,
  })
}

const normalizeIndex = (value) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 0) return null
  return numeric
}

const sanitizePathPart = (value, fallback) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || fallback
}

const estimateImagePromptTokens = (value) => Math.max(1, Math.ceil(String(value || '').length / 4))

const estimateImageOutputTokens = (size) => {
  const normalized = String(size || '').trim().toLowerCase()
  if (normalized === '1024x1536' || normalized === '1536x1024') return 1584
  if (normalized === '1024x1024') return 1056
  return 1056
}

const getReportUpdatedAtForMetadataSave = (reportRow) => {
  const reportUpdatedAt = toTimeValue(reportRow?.updated_at)
  const sourceUpdatedAt = toTimeValue(reportRow?.source_updated_at)
  if (sourceUpdatedAt && reportUpdatedAt && sourceUpdatedAt > reportUpdatedAt) {
    return reportRow?.updated_at || new Date(reportUpdatedAt).toISOString()
  }
  return new Date().toISOString()
}

const buildTrizSketchPrompt = ({ solution, contradiction, reportLang }) => {
  const basePrompt =
    'isometric view, pencil sketch, conceptual industrial design sketch, monochrome graphite lines, subtle shading, visible construction lines, transparent background, fully transparent background alpha 0, no background fill, no background scene, not photorealistic, not CAD render, no text labels, no hands'
  const contradictionTitle = String(contradiction?.title || '').trim()
  const contradictionDescription = String(contradiction?.description || '').trim()
  const solutionTitle = String(solution?.title || '').trim()
  const solutionDescription = String(solution?.description || '').trim()
  const promptText =
    solution?.sketch_prompt && typeof solution.sketch_prompt === 'string'
      ? solution.sketch_prompt.trim()
      : ''
  if (promptText) return promptText
  if (reportLang === 'en') {
    return `${basePrompt}. Show a product concept for: ${solutionTitle || solutionDescription}. Context: ${contradictionTitle}. ${contradictionDescription || ''}`.trim()
  }
  return `${basePrompt}. Pokaż koncepcyjny szkic rozwiązania: ${solutionTitle || solutionDescription}. Kontekst sprzeczności: ${contradictionTitle}. ${contradictionDescription || ''}`.trim()
}

const getTrizWatermarkAsset = async () => {
  if (!trizWatermarkAssetPromise) {
    trizWatermarkAssetPromise = readFile(trizWatermarkAssetUrl)
  }
  return trizWatermarkAssetPromise
}

const applyTrizWatermark = async (inputBuffer) => {
  const watermarkBuffer = await getTrizWatermarkAsset()
  const image = sharp(inputBuffer)
  const metadata = await image.metadata()
  const width = Number(metadata.width || 0)
  const height = Number(metadata.height || 0)
  if (!width || !height) return inputBuffer

  const watermarkWidth = Math.max(96, Math.round(Math.min(width * 0.16, 150)))
  const margin = Math.max(18, Math.round(width * 0.02))
  const topOffset = margin
  const leftOffset = Math.max(0, width - watermarkWidth - margin)

  const resizedWatermark = await sharp(watermarkBuffer)
    .resize({ width: watermarkWidth })
    .png()
    .toBuffer()

  return image
    .composite([
      {
        input: resizedWatermark,
        left: leftOffset,
        top: topOffset,
      },
    ])
    .png()
    .toBuffer()
}

const previewPrompt = (value, maxLength = 200) => {
  const prompt = String(value || '').replace(/\s+/g, ' ').trim()
  if (!prompt) return ''
  return prompt.length > maxLength ? `${prompt.slice(0, maxLength)}…` : prompt
}

export const classifyTrizFormatState = (summaryJson, contradictionIndex, solutionIndex) => {
  const summary = summaryJson && typeof summaryJson === 'object' ? summaryJson : null
  const triz = summary?.triz
  if (triz != null && typeof triz !== 'object') {
    return { ok: false, reason: 'triz_not_object' }
  }
  const contradictions = Array.isArray(triz?.contradictions) ? triz.contradictions : null
  if (triz && triz.contradictions != null && !contradictions) {
    return { ok: false, reason: 'contradictions_not_array' }
  }
  if (!contradictions) return { ok: true, rawSolution: null, legacy: false }
  const contradiction = contradictions[contradictionIndex]
  if (!contradiction || typeof contradiction !== 'object') {
    return { ok: true, rawSolution: null, legacy: false }
  }
  const solutions = Array.isArray(contradiction.solutions) ? contradiction.solutions : null
  if (contradiction.solutions != null && !solutions) {
    return { ok: false, reason: 'solutions_not_array' }
  }
  const rawSolution = solutions?.[solutionIndex] ?? null
  return {
    ok: true,
    rawSolution,
    legacy: typeof rawSolution === 'string',
  }
}

export const buildTrizImageRollbackUpdate = (reportRow) => ({
  summary_json: reportRow?.summary_json ?? null,
  updated_at: reportRow?.updated_at ?? null,
})

const generateTrizImage = async ({ prompt, apiKey }) => {
  if (!apiKey) {
    const error = new Error('OPENAI_KEY_MISSING')
    error.code = 'OPENAI_KEY_MISSING'
    throw error
  }
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      prompt,
      size: process.env.OPENAI_IMAGE_SIZE || '1024x1024',
      background: 'transparent',
      output_format: 'png',
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = new Error(`OPENAI_IMAGE_FAILED:${response.status}`)
    error.code = 'OPENAI_IMAGE_FAILED'
    error.status = response.status
    error.detail = detail
    throw error
  }
  const payload = await response.json()
  const imageData = Array.isArray(payload?.data) ? payload.data[0] : null
  const b64 = typeof imageData?.b64_json === 'string' ? imageData.b64_json : ''
  if (!b64) {
    const error = new Error('OPENAI_IMAGE_EMPTY')
    error.code = 'OPENAI_IMAGE_EMPTY'
    throw error
  }
  return {
    buffer: Buffer.from(b64, 'base64'),
    mimeType: 'image/png',
    usage: payload?.usage ?? null,
  }
}

export const handleReportTrizImageGenerate = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const sessionId = String(body.sessionId || '').trim()
    const contradictionIndex = normalizeIndex(body.contradictionIndex)
    const solutionIndex = normalizeIndex(body.solutionIndex)
    logTrizImage('log', 'request_start', {
      sessionId,
      contradictionIndex,
      solutionIndex,
    })
    if (!sessionId) {
      sendTrizImageError(res, 400, 'SESSION_ID_REQUIRED', 'Missing session id.')
      return
    }
    if (contradictionIndex == null || solutionIndex == null) {
      sendTrizImageError(res, 400, 'INVALID_TRIZ_INDEX', 'Invalid TRIZ indices.')
      return
    }
    const token = getBearerToken(req)
    if (!token) {
      sendTrizImageError(res, 401, 'AUTH_REQUIRED', 'Authentication required.')
      return
    }
    const requestedLang = normalizeReportLang(body.lang || body.language || body.reportLanguage)
    const supabaseAdmin = getSupabaseAdmin()
    const authRes = await supabaseAdmin.auth.getUser(token)
    const userId = authRes?.data?.user?.id || null
    if (authRes?.error || !userId) {
      sendTrizImageError(res, 401, 'AUTH_REQUIRED', 'Authentication required.')
      return
    }
    const access = await resolveSessionAccess(supabaseAdmin, sessionId, userId)
    if (!access.ok) {
      logTrizImage('error', 'access_check_failed', {
        sessionId,
        reason: access.reason || 'ACCESS_CHECK_FAILED',
      })
      sendTrizImageError(res, 500, access.reason || 'ACCESS_CHECK_FAILED', 'Unable to verify access.')
      return
    }
    if (!access.allowed) {
      sendTrizImageError(res, 403, 'FORBIDDEN', 'Access denied.')
      return
    }
    const reportRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .select(REPORT_SELECT_FIELDS)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (reportRes.error) {
      logTrizImage('error', 'report_lookup_failed', {
        sessionId,
        message: reportRes.error.message ?? null,
      })
      sendTrizImageError(res, 500, 'REPORT_LOOKUP_FAILED', 'Unable to load report.')
      return
    }
    if (!reportRes.data) {
      sendTrizImageError(res, 404, 'REPORT_NOT_FOUND', 'Report not found.')
      return
    }
    logTrizImage('log', 'report_found', {
      reportId: reportRes.data.id,
      sessionId,
    })
    const formatState = classifyTrizFormatState(
      reportRes.data.summary_json ?? null,
      contradictionIndex,
      solutionIndex
    )
    if (!formatState.ok) {
      logTrizImage('warn', 'invalid_report_format', {
        reportId: reportRes.data.id,
        reason: formatState.reason,
      })
      sendTrizImageError(
        res,
        409,
        'TRIZ_IMAGE_INVALID_REPORT_FORMAT',
        'TRIZ section format is not compatible with image generation.'
      )
      return
    }
    const normalizedReport = validateAndNormalizeReport(reportRes.data.summary_json ?? null)
    const reportLang = normalizeReportLang(normalizedReport.lang) || requestedLang || 'pl'
    const contradiction = normalizedReport?.triz?.contradictions?.[contradictionIndex]
    if (!contradiction) {
      logTrizImage('warn', 'contradiction_not_found', {
        reportId: reportRes.data.id,
        contradictionIndex,
      })
      sendTrizImageError(
        res,
        404,
        'TRIZ_IMAGE_SOLUTION_NOT_FOUND',
        'Requested TRIZ solution was not found.'
      )
      return
    }
    const solution = contradiction.solutions?.[solutionIndex]
    if (!solution) {
      logTrizImage('warn', 'solution_not_found', {
        reportId: reportRes.data.id,
        contradictionIndex,
        solutionIndex,
      })
      sendTrizImageError(
        res,
        404,
        'TRIZ_IMAGE_SOLUTION_NOT_FOUND',
        'Requested TRIZ solution was not found.'
      )
      return
    }
    logTrizImage('log', 'solution_resolved', {
      reportId: reportRes.data.id,
      contradictionIndex,
      solutionIndex,
      legacySolution: Boolean(formatState.legacy),
      hasImageReady: Boolean(solution?.image?.status === 'ready' && solution?.image?.public_url),
    })
    const prompt = buildTrizSketchPrompt({
      solution,
      contradiction,
      reportLang,
    })
    if (!prompt || !String(prompt).trim()) {
      logTrizImage('warn', 'prompt_missing', {
        reportId: reportRes.data.id,
        contradictionIndex,
        solutionIndex,
      })
      sendTrizImageError(
        res,
        400,
        'TRIZ_IMAGE_PROMPT_MISSING',
        'Missing sketch prompt for selected solution.'
      )
      return
    }
    const hasExistingReadyImage = Boolean(
      solution?.image?.status === 'ready' && (solution?.image?.storage_path || solution?.image?.public_url)
    )
    const actionKey = hasExistingReadyImage ? 'image_regenerate' : 'image_generate'
    logTrizImage('log', 'prompt_ready', {
      reportId: reportRes.data.id,
      contradictionIndex,
      solutionIndex,
      actionKey,
      promptLength: String(prompt).trim().length,
      promptPreview: previewPrompt(prompt),
    })

    const attemptId = `${Date.now()}-${randomUUID()}`
    const fileName = `${sanitizePathPart(sessionId, 'session')}-triz-${contradictionIndex + 1}-${solutionIndex + 1}-${attemptId}.png`
    const bucket = process.env.REPORT_IMAGE_BUCKET || 'report-images'
    const storagePath = `reports/${sanitizePathPart(sessionId, 'session')}/${sanitizePathPart(
      reportRes.data.id,
      'report'
    )}/triz/${contradictionIndex}/${solutionIndex}/${attemptId}/${fileName}`
    const previousImage = solution?.image && typeof solution.image === 'object' ? solution.image : null
    let imageUsageMeta = buildMeta({
      aiSupportEnabled: true,
      modelUsed: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      tokens: { input: 0, output: 0, total: 0 },
      escalated: false,
    })

    try {
      logTrizImage('log', 'provider_start', {
        reportId: reportRes.data.id,
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      })
      const generated = await generateTrizImage({
        prompt,
        apiKey: process.env.OPENAI_API_KEY,
      })
      const watermarkedBuffer = await applyTrizWatermark(generated.buffer)
      const estimatedInputTokens = estimateImagePromptTokens(prompt)
      const estimatedOutputTokens = estimateImageOutputTokens(
        process.env.OPENAI_IMAGE_SIZE || '1024x1024'
      )
      const inputTokens =
        generated.usage?.input_tokens ??
        generated.usage?.prompt_tokens ??
        generated.usage?.input ??
        estimatedInputTokens
      const outputTokens =
        generated.usage?.output_tokens ??
        generated.usage?.completion_tokens ??
        generated.usage?.output ??
        estimatedOutputTokens
      imageUsageMeta = buildMeta({
        aiSupportEnabled: true,
        modelUsed: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total:
            generated.usage?.total_tokens ??
            generated.usage?.total ??
            Number(inputTokens) + Number(outputTokens),
        },
        escalated: false,
      })
      await recordSessionAiUsageEvent(supabaseAdmin, {
        sessionId: reportRes.data.session_id ?? sessionId,
        reportId: reportRes.data.id ?? null,
        userId,
        actionKey,
        sourceTask: 'image-generate',
        referenceId: reportRes.data.id ?? null,
        meta: imageUsageMeta,
      })
      logTrizImage('log', 'provider_success', {
        reportId: reportRes.data.id,
        mimeType: generated.mimeType,
        payloadBytes: watermarkedBuffer?.byteLength ?? generated.buffer?.byteLength ?? 0,
        hasBinary: Boolean(watermarkedBuffer?.byteLength ?? generated.buffer?.byteLength),
        usage: imageUsageMeta.tokens,
      })
      logTrizImage('log', 'upload_start', {
        reportId: reportRes.data.id,
        bucket,
        storagePath,
      })
      const uploadRes = await supabaseAdmin.storage.from(bucket).upload(storagePath, watermarkedBuffer, {
        contentType: generated.mimeType,
        upsert: false,
        cacheControl: '31536000',
      })
      if (uploadRes.error) {
        logTrizImage('error', 'upload_failed', {
          reportId: reportRes.data.id,
          bucket,
          storagePath,
          message: uploadRes.error.message ?? null,
        })
        sendTrizImageError(
          res,
          502,
          'TRIZ_IMAGE_UPLOAD_FAILED',
          'Unable to upload generated image.'
        )
        return
      }
      logTrizImage('log', 'upload_success', {
        reportId: reportRes.data.id,
        bucket,
        storagePath,
      })
      const publicUrlRes = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath)
      const publicUrl = publicUrlRes?.data?.publicUrl || ''
      if (!publicUrl) {
        logTrizImage('error', 'public_url_failed', {
          reportId: reportRes.data.id,
          bucket,
          storagePath,
        })
        await supabaseAdmin.storage.from(bucket).remove([storagePath]).catch(() => {})
        sendTrizImageError(
          res,
          500,
          'TRIZ_IMAGE_PUBLIC_URL_FAILED',
          'Unable to resolve image URL.'
        )
        return
      }
      logTrizImage('log', 'public_url_success', {
        reportId: reportRes.data.id,
        bucket,
        storagePath,
        publicUrlPreview: previewPrompt(publicUrl, 120),
      })
      logTrizImage('log', 'billing_start', {
        reportId: reportRes.data.id,
        actionKey,
      })
      try {
        const billingResult = await chargeUserBalance(userId, actionKey, randomUUID(), supabaseAdmin)
        await recordSessionBillingEvent(supabaseAdmin, {
          sessionId: reportRes.data.session_id ?? sessionId,
          reportId: reportRes.data.id ?? null,
          userId,
          actionKey,
          referenceId: reportRes.data.id ?? null,
          amountMinor: billingResult.amountMinor,
          currency: billingResult.currency,
        })
        logTrizImage('log', 'billing_success', {
          reportId: reportRes.data.id,
          actionKey,
          currency: billingResult.currency,
          amountMinor: billingResult.amountMinor,
          balanceAfterMinor: billingResult.balanceAfterMinor,
        })
      } catch (error) {
        const billingNormalized = normalizeBillingError(error)
        logTrizImage('error', 'billing_failed', {
          reportId: reportRes.data.id,
          actionKey,
          code: billingNormalized?.code || error?.code || null,
          message: error?.message || null,
        })
        const removeRes = await supabaseAdmin.storage.from(bucket).remove([storagePath])
        logTrizImage('warn', 'billing_rollback_result', {
          reportId: reportRes.data.id,
          summaryRollbackOk: true,
          storageRollbackOk: !removeRes.error,
        })
        if (billingNormalized?.code === 'INSUFFICIENT_BALANCE') {
          sendTrizImageError(
            res,
            402,
            'INSUFFICIENT_BALANCE',
            'Insufficient balance for image generation.'
          )
          return
        }
        sendTrizImageError(
          res,
          500,
          'TRIZ_IMAGE_BILLING_FAILED',
          'Unable to charge image generation.'
        )
        return
      }
      const nextImage = {
        status: 'ready',
        storage_path: storagePath,
        public_url: publicUrl,
        mime_type: generated.mimeType,
        file_name: fileName,
        generated_at: new Date().toISOString(),
        prompt,
      }
      const existingImages = Array.isArray(solution.images)
        ? solution.images.filter((item) => item && typeof item === 'object')
        : solution.image
          ? [solution.image]
          : []
      const mergedImagesBase = [
        ...existingImages.filter(
          (item) =>
            item?.storage_path !== nextImage.storage_path && item?.public_url !== nextImage.public_url
        ),
        nextImage,
      ]
      const currentPrimaryImage =
        solution?.image &&
        typeof solution.image === 'object' &&
        solution.image.status === 'ready' &&
        (solution.image.storage_path || solution.image.public_url)
          ? solution.image
          : null
      const mergedImages = currentPrimaryImage
        ? [
            currentPrimaryImage,
            ...mergedImagesBase.filter(
              (item) =>
                item?.storage_path !== currentPrimaryImage.storage_path ||
                item?.public_url !== currentPrimaryImage.public_url
            ),
          ]
        : mergedImagesBase
      contradiction.solutions[solutionIndex] = {
        ...solution,
        ...(solution.description ? { description: solution.description } : {}),
        ...(prompt ? { sketch_prompt: prompt } : {}),
        image: currentPrimaryImage || nextImage,
        images: mergedImages,
      }
      const nextSummary = sanitizeReportPayload(normalizedReport)
      logTrizImage('log', 'metadata_save_start', {
        reportId: reportRes.data.id,
        contradictionIndex,
        solutionIndex,
        previousStoragePath: previousImage?.storage_path || null,
        nextStoragePath: storagePath,
      })
      const updateRes = await supabaseAdmin
        .schema('public')
        .from('reports')
        .update({
          summary_json: nextSummary,
          updated_at: getReportUpdatedAtForMetadataSave(reportRes.data),
        })
        .eq('session_id', sessionId)
        .select(REPORT_SELECT_FIELDS)
        .maybeSingle()
      if (updateRes.error) {
        logTrizImage('error', 'metadata_save_failed', {
          reportId: reportRes.data.id,
          message: updateRes.error.message ?? null,
        })
        await supabaseAdmin.storage.from(bucket).remove([storagePath]).catch(() => {})
        sendTrizImageError(
          res,
          500,
          'TRIZ_IMAGE_METADATA_SAVE_FAILED',
          'Unable to save image metadata to report.'
        )
        return
      }
      logTrizImage('log', 'metadata_save_success', {
        reportId: reportRes.data.id,
        savedReportId: updateRes.data?.id ?? null,
        previousStoragePath: previousImage?.storage_path || null,
        activeStoragePath: storagePath,
      })
      logTrizImage('log', 'response_success', {
        reportId: reportRes.data.id,
        actionKey,
        activeStoragePath: storagePath,
      })
      sendJson(res, 200, { ok: true, report: updateRes.data ?? null, meta: imageUsageMeta })
      return
    } catch (error) {
      const providerCode =
        error?.code === 'OPENAI_IMAGE_EMPTY'
          ? 'TRIZ_IMAGE_EMPTY_PROVIDER_RESPONSE'
          : 'TRIZ_IMAGE_PROVIDER_FAILED'
      const providerMessage =
        error?.code === 'OPENAI_IMAGE_EMPTY'
          ? 'Image provider returned no image payload.'
          : 'Image provider failed to generate a sketch.'
      logTrizImage('error', 'provider_failed', {
        reportId: reportRes.data.id,
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || null,
        detailPreview: previewPrompt(error?.detail || '', 200),
      })
      sendTrizImageError(
        res,
        error?.code === 'OPENAI_IMAGE_EMPTY' ? 502 : 502,
        providerCode,
        providerMessage
      )
      return
    }
  } catch (error) {
    logTrizImage('error', 'handler_exception', {
      message: error?.message ?? 'Unknown error',
    })
    sendTrizImageError(res, 500, 'TRIZ_IMAGE_HANDLER_FAILED', 'Unexpected image generation error.')
  }
}

export const handleReportTrizImageDelete = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const sessionId = String(body.sessionId || '').trim()
    const contradictionIndex = normalizeIndex(body.contradictionIndex)
    const solutionIndex = normalizeIndex(body.solutionIndex)
    const storagePath = String(body.storagePath || '').trim()
    const publicUrl = String(body.publicUrl || '').trim()
    logTrizImage('log', 'delete_request_start', {
      sessionId,
      contradictionIndex,
      solutionIndex,
      storagePath: storagePath || null,
      publicUrl: publicUrl ? previewPrompt(publicUrl, 120) : null,
    })
    if (!sessionId) {
      sendTrizImageError(res, 400, 'SESSION_ID_REQUIRED', 'Missing session id.')
      return
    }
    if (contradictionIndex == null || solutionIndex == null) {
      sendTrizImageError(res, 400, 'INVALID_TRIZ_INDEX', 'Invalid TRIZ indices.')
      return
    }
    if (!storagePath && !publicUrl) {
      sendTrizImageError(res, 400, 'TRIZ_IMAGE_REFERENCE_REQUIRED', 'Missing image reference.')
      return
    }
    const token = getBearerToken(req)
    if (!token) {
      sendTrizImageError(res, 401, 'AUTH_REQUIRED', 'Authentication required.')
      return
    }
    const supabaseAdmin = getSupabaseAdmin()
    const authRes = await supabaseAdmin.auth.getUser(token)
    const userId = authRes?.data?.user?.id || null
    if (authRes?.error || !userId) {
      sendTrizImageError(res, 401, 'AUTH_REQUIRED', 'Authentication required.')
      return
    }
    const access = await resolveSessionAccess(supabaseAdmin, sessionId, userId)
    if (!access.ok) {
      logTrizImage('error', 'delete_access_check_failed', {
        sessionId,
        reason: access.reason || 'ACCESS_CHECK_FAILED',
      })
      sendTrizImageError(res, 500, access.reason || 'ACCESS_CHECK_FAILED', 'Unable to verify access.')
      return
    }
    if (!access.allowed) {
      sendTrizImageError(res, 403, 'FORBIDDEN', 'Access denied.')
      return
    }
    const reportRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .select(REPORT_SELECT_FIELDS)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (reportRes.error) {
      logTrizImage('error', 'delete_report_lookup_failed', {
        sessionId,
        message: reportRes.error.message ?? null,
      })
      sendTrizImageError(res, 500, 'REPORT_LOOKUP_FAILED', 'Unable to load report.')
      return
    }
    if (!reportRes.data) {
      sendTrizImageError(res, 404, 'REPORT_NOT_FOUND', 'Report not found.')
      return
    }
    const formatState = classifyTrizFormatState(
      reportRes.data.summary_json ?? null,
      contradictionIndex,
      solutionIndex
    )
    if (!formatState.ok) {
      sendTrizImageError(
        res,
        409,
        'TRIZ_IMAGE_INVALID_REPORT_FORMAT',
        'TRIZ section format is not compatible with image deletion.'
      )
      return
    }
    const normalizedReport = validateAndNormalizeReport(reportRes.data.summary_json ?? null)
    const contradiction = normalizedReport?.triz?.contradictions?.[contradictionIndex]
    if (!contradiction) {
      sendTrizImageError(
        res,
        404,
        'TRIZ_IMAGE_SOLUTION_NOT_FOUND',
        'Requested TRIZ solution was not found.'
      )
      return
    }
    const solution = contradiction.solutions?.[solutionIndex]
    if (!solution || typeof solution !== 'object') {
      sendTrizImageError(
        res,
        404,
        'TRIZ_IMAGE_SOLUTION_NOT_FOUND',
        'Requested TRIZ solution was not found.'
      )
      return
    }
    const solutionImages = Array.isArray(solution.images)
      ? solution.images.filter((item) => item && typeof item === 'object')
      : solution.image
        ? [solution.image]
        : []
    const targetImage = solutionImages.find((item) => {
      const storageMatches = storagePath && item?.storage_path === storagePath
      const publicMatches = publicUrl && item?.public_url === publicUrl
      return storageMatches || publicMatches
    })
    if (!targetImage) {
      sendTrizImageError(res, 404, 'TRIZ_IMAGE_NOT_FOUND', 'Requested image was not found.')
      return
    }
    const remainingImages = solutionImages.filter((item) => item !== targetImage)
    const nextPrimaryImage =
      remainingImages.find(
        (item) => item?.status === 'ready' && (item?.storage_path || item?.public_url)
      ) ||
      remainingImages[0] ||
      null
    contradiction.solutions[solutionIndex] = {
      ...solution,
      ...(solution.description ? { description: solution.description } : {}),
      ...(solution.sketch_prompt ? { sketch_prompt: solution.sketch_prompt } : {}),
      image: nextPrimaryImage,
      images: remainingImages,
    }
    const nextSummary = sanitizeReportPayload(normalizedReport)
    const updateRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .update({
        summary_json: nextSummary,
        updated_at: getReportUpdatedAtForMetadataSave(reportRes.data),
      })
      .eq('session_id', sessionId)
      .select(REPORT_SELECT_FIELDS)
      .maybeSingle()
    if (updateRes.error) {
      logTrizImage('error', 'delete_metadata_save_failed', {
        reportId: reportRes.data.id,
        message: updateRes.error.message ?? null,
      })
      sendTrizImageError(
        res,
        500,
        'TRIZ_IMAGE_DELETE_FAILED',
        'Unable to remove image from report.'
      )
      return
    }
    const bucket = process.env.REPORT_IMAGE_BUCKET || 'report-images'
    if (targetImage.storage_path) {
      const removeRes = await supabaseAdmin.storage.from(bucket).remove([targetImage.storage_path])
      if (removeRes.error) {
        logTrizImage('warn', 'delete_storage_cleanup_failed', {
          reportId: reportRes.data.id,
          storagePath: targetImage.storage_path,
          message: removeRes.error.message ?? null,
        })
      } else {
        logTrizImage('log', 'delete_storage_cleanup_success', {
          reportId: reportRes.data.id,
          storagePath: targetImage.storage_path,
        })
      }
    }
    logTrizImage('log', 'delete_response_success', {
      reportId: reportRes.data.id,
      deletedStoragePath: targetImage.storage_path || null,
      deletedPublicUrl: targetImage.public_url ? previewPrompt(targetImage.public_url, 120) : null,
    })
    sendJson(res, 200, { ok: true, report: updateRes.data ?? null })
  } catch (error) {
    logTrizImage('error', 'delete_handler_exception', {
      message: error?.message ?? 'Unknown error',
    })
    sendTrizImageError(res, 500, 'TRIZ_IMAGE_DELETE_FAILED', 'Unexpected image deletion error.')
  }
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
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const internalOptions =
      req && typeof req === 'object' && req.reportOptions && typeof req.reportOptions === 'object'
        ? req.reportOptions
        : {}
    const skipBilling = internalOptions.skipBilling === true
    const returnReport = internalOptions.returnReport === true
    const reportActionKey =
      typeof internalOptions.actionKey === 'string' && internalOptions.actionKey.trim()
        ? internalOptions.actionKey.trim()
        : 'report_update'
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
    const access = await resolveSessionAccess(supabaseAdmin, sessionId, userId)
    if (!access.ok) {
      res.status(500).json({ ok: false, error: access.reason || 'ACCESS_CHECK_FAILED' })
      return
    }
    if (!access.allowed) {
      res.status(403).json({ ok: false, error: 'FORBIDDEN' })
      return
    }
    const reportRes = await supabaseAdmin
      .schema('public')
      .from('reports')
      .select('id,session_id,created_at,updated_at,summary_json,source_updated_at,last_summary_text_hash')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (reportRes.error) {
      res.status(500).json({ ok: false, error: reportRes.error })
      return
    }
    if (!reportRes.data) {
      res.status(404).json({ ok: false, error: 'REPORT_NOT_FOUND' })
      return
    }
    if (!skipBilling) {
      try {
        const requestId = randomUUID()
        const billingResult = await chargeUserBalance(userId, 'report_update', requestId, supabaseAdmin)
        await recordSessionBillingEvent(supabaseAdmin, {
          sessionId: reportRes.data.session_id ?? sessionId,
          reportId: reportRes.data.id ?? null,
          userId,
          actionKey: 'report_update',
          referenceId: reportRes.data.id ?? requestId,
          amountMinor: billingResult.amountMinor,
          currency: billingResult.currency,
        })
      } catch (error) {
        if (handleBillingError(res, error)) return
        sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
        return
      }
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
        if (preprocessResult?.meta) {
          await recordSessionAiUsageEvent(supabaseAdmin, {
            sessionId: reportRes.data.session_id ?? sessionId,
            reportId: reportRes.data.id ?? null,
            userId,
            actionKey: reportActionKey,
            sourceTask: 'report-preprocess',
            referenceId: reportRes.data.id ?? null,
            meta: preprocessResult.meta,
          })
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
            'Return exactly one valid JSON object and nothing else.',
            'The JSON must contain only: summary, recommendations.',
            'No markdown. No prose outside JSON. No commentary before or after JSON. No trailing text.',
            'Do not include items or source_snapshot.',
            'The JSON MUST include "recommendations" as an OBJECT (never null, never string).',
            'It MUST contain exactly these keys: based_on_user_ideas, morphological, market_trends.',
            'Each array MUST contain exactly 2 items.',
            'Each item MUST have non-empty fields: title, rationale, how_to_test.',
            'Keep all strings concise. If unsure, return shorter content rather than longer content.',
            'If session data is sparse, create minimal but still concrete items.',
            'Do not output matrix codes A1..C3 anywhere.',
            'Exactly 2 items per group.',
            'Rationale should reference analysis_json briefly; no long quotes.',
            'Keep summary subsections brief.',
            'Keep recommendation title, rationale, and how_to_test concise.',
            'Synthesize from the board data; do not copy entries verbatim.',
            ...summaryNotes,
          ],
        },
        session_items: representativeItems,
      })

      const defaultTaskInstructions =
        reportLang === 'en'
          ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Keys: summary, recommendations. Keep all strings concise. Prefer fewer complete items over verbose output. recommendations must be an object with 3 arrays; each array min 1 item; items must include title, rationale, how_to_test. Output must be in English.'
          : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucze: summary, recommendations. Pisz zwięźle. Lepiej zwrócić mniej pełnych elementów niż długi, rozwlekły wynik. recommendations musi być obiektem z 3 tablicami; każda tablica min 1 element; elementy muszą mieć title, rationale, how_to_test. Całość po polsku.'

      const trizPrompt = JSON.stringify({
        existing_triz: phaseASanitized.triz ?? null,
        analysis_json: analysisJson,
        requirements: {
          output_schema: {
            section_title: 'string',
            section_intro: 'string',
            contradictions: [
              {
                title: 'string',
                description: 'string',
                improving: 'string',
                worsening: 'string',
                principles: [
                  {
                    id: 'optional number',
                    name: 'string',
                    rationale: 'optional string',
                    how_to_apply: 'optional string',
                  },
                ],
                solutions: ['string'],
              },
            ],
          },
          notes: [
            'Return exactly one valid JSON object and nothing else.',
            'The JSON must contain only: section_title, section_intro, contradictions.',
            'No markdown. No prose outside JSON. No commentary before or after JSON. No trailing text.',
            'Return at most 3 contradictions.',
            'Prefer 1 or 2 strong contradictions over many weak ones.',
            'A contradiction means improving one aspect worsens another aspect.',
            'Detect contradictions not only from explicit opposites, but also from implicit trade-offs across multiple entries.',
            'Prefer concrete product and engineering tensions such as lightweight vs strength or durability, small or portable vs long reach, simple construction vs robustness, material choice conflicts, ambidextrous use vs ergonomic optimization, safety vs effectiveness.',
            'Every contradiction must include: title, description, improving, worsening, principles, solutions.',
            'principles and solutions must be arrays, but may be empty.',
            'Keep title, description, principles, and solutions concise.',
            'Do not invent contradictions not grounded in the material.',
            reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
          ],
        },
        session_items: representativeItems,
      })

      const trizTaskInstructions =
        reportLang === 'en'
          ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Keys: section_title, section_intro, contradictions. Find implicit contradictions across entries when needed. Prefer 1 or 2 strong contradictions. Each contradiction must contain title, description, improving, worsening, principles, solutions. Keep strings concise. Output must be in English.'
          : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucze: section_title, section_intro, contradictions. Wnioskuj także sprzeczności ukryte w wielu wpisach. Preferuj 1 lub 2 mocne sprzeczności. Każda sprzeczność musi zawierać title, description, improving, worsening, principles, solutions. Pisz zwięźle. Całość po polsku.'

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
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            return parsed && typeof parsed === 'object' ? parsed : null
          },
          fallbackData: null,
          models: {
            default: modelOverride || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 1800,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })
      console.log('[report:update] itemsCount', itemsFromDb.length)
      let validationErrors = []
      let summaryCandidate = phaseASanitized.summary
      let recommendationsCandidate = normalizeRecommendations(phaseASanitized.recommendations)
      let trizCandidate = normalizeTriz(phaseASanitized.triz)
      let summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length, reportLang)
      let recValidation = validateRecommendations(recommendationsCandidate)
      let trizValidation = validateTriz(trizCandidate)
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
        if (defaultResult?.meta) {
          await recordSessionAiUsageEvent(supabaseAdmin, {
            sessionId: reportRes.data.session_id ?? sessionId,
            reportId: reportRes.data.id ?? null,
            userId,
            actionKey: reportActionKey,
            sourceTask: 'report-summary-recs',
            referenceId: reportRes.data.id ?? null,
            meta: defaultResult.meta,
          })
        }
        applyGenerated(defaultResult.data)
        logRecommendationCounts('default', recommendationsCandidate)
        console.log('[report:update][step3] summary validation', summaryValidation.errors)
        console.log('[report:update][step3] validation errors', recValidation.errors)
        if (!recValidation.ok || !summaryValidation.ok) {
          validationErrors = recValidation.errors
            .concat(summaryValidation.errors || [])
          if (recValidation.errors.some((err) => err.startsWith('group_count_invalid'))) {
            validationErrors.push('wrong_item_count_return_exactly_2_per_list')
          }
          console.log('[report:update][step3] retry default')
          defaultResult = await runDefault(undefined, validationErrors)
          if (defaultResult.ok && defaultResult.data) {
            logLlmMeta('retry', defaultResult)
            if (defaultResult?.meta) {
              await recordSessionAiUsageEvent(supabaseAdmin, {
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-summary-recs',
                referenceId: reportRes.data.id ?? null,
                meta: defaultResult.meta,
              })
            }
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
          if (escalationResult?.meta) {
            await recordSessionAiUsageEvent(supabaseAdmin, {
              sessionId: reportRes.data.session_id ?? sessionId,
              reportId: reportRes.data.id ?? null,
              userId,
              actionKey: reportActionKey,
              sourceTask: 'report-summary-recs',
              referenceId: reportRes.data.id ?? null,
              meta: escalationResult.meta,
            })
          }
          applyGenerated(escalationResult.data)
          logRecommendationCounts('escalation', recommendationsCandidate)
          console.log('[report:update][step3] escalation validation errors', recValidation.errors)
          console.log('[report:update][step3] escalation summary validation', summaryValidation.errors)
        }
      }

      const runTrizOnly = async (modelOverride) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-triz',
          input: trizPrompt,
          sessionId,
          language: llmLanguage,
          taskInstructions: trizTaskInstructions,
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const rawTriz = parsed?.triz && typeof parsed.triz === 'object' ? parsed.triz : parsed
            return rawTriz && typeof rawTriz === 'object' ? rawTriz : null
          },
          fallbackData: null,
          models: {
            default: modelOverride || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 900,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })

      try {
        const trizOnlyResult = await runTrizOnly()
        if (trizOnlyResult?.meta) {
          await recordSessionAiUsageEvent(supabaseAdmin, {
            sessionId: reportRes.data.session_id ?? sessionId,
            reportId: reportRes.data.id ?? null,
            userId,
            actionKey: reportActionKey,
            sourceTask: 'report-triz',
            referenceId: reportRes.data.id ?? null,
            meta: trizOnlyResult.meta,
          })
        }
        if (trizOnlyResult.ok && trizOnlyResult.data) {
          trizCandidate = normalizeTriz(trizOnlyResult.data)
          trizValidation = validateTriz(trizCandidate)
        }
      } catch (error) {
        console.error('[report:update] triz-only generation exception:', error)
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
      const finalTriz = trizValidation.ok
        ? trizCandidate
        : normalizeTriz(phaseASanitized.triz)
      if (!trizValidation.ok) {
        console.log('[report:update][step3] triz fallback', trizValidation.errors)
      }

      const nextPayload = {
        ...phaseASanitized,
        summary: finalSummary,
        recommendations: finalRecommendations,
        triz: finalTriz,
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
      if (returnReport) {
        const finalReportRes = await supabaseAdmin
          .schema('public')
          .from('reports')
          .select('id,session_id,created_at,updated_at,summary_json,last_summary_text_hash,source_updated_at')
          .eq('session_id', sessionId)
          .maybeSingle()
        if (finalReportRes.error) {
          res.status(500).json({ ok: false, error: finalReportRes.error })
          return
        }
        res.status(200).json({ ok: true, report: finalReportRes.data ?? null })
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
