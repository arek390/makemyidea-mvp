import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { chargeUserBalance, normalizeBillingError } from '../billing.js'
import { buildMeta, sendJson } from '../http.js'
import { recordSessionAiUsageEvent, recordSessionBillingEvent } from '../aiCostEvents.js'
import { runLlmTask, createRateLimiter } from '../../../llm/llmRouter.mjs'
import sharp from 'sharp'

const REPORT_LLM_TIMEOUT_MS = 45_000
const REPORT_TRIZ_TIMEOUT_MS = 60_000
const REPORT_TRIZ_ESCALATION_TIMEOUT_MS = 75_000
const REPORT_TRIZ_MAX_OUTPUT_TOKENS = 1400

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 })
const trizWatermarkAssetUrl = new URL('../../../../logo/logo_makemyideawork_transp.png', import.meta.url)
let trizWatermarkAssetPromise = null

const MAX_TRIZ_CONTRADICTIONS = 5
const PREFERRED_TRIZ_CONTRADICTIONS = 3
const MAX_TRIZ_SOLUTION_DIRECTIONS = 4
const MAX_TRIZ_REFLECTIONS = 3
const MAX_TRIZ_APPROACHES = 4
const MAX_TRIZ_LEGACY_SOLUTIONS = 3
const MAX_TRIZ_PRINCIPLES = 5
const MAX_TRIZ_INPUT_ITEMS = 40
const MIN_TRIZ_SUPPORT_MATCHES = 2
const TRIZ_SUPPORT_TERM_LIMIT = 10

const TARGET_TRIZ_CONTRADICTIONS = 3
const TARGET_EXEC_PRIORITIES = 4
const TARGET_EXEC_ACTION_PLAN = 4
const TARGET_EXEC_DECISIONS = 3
const TARGET_EXEC_VALIDATION = 3
const MAX_EXEC_ACTION_PLAN_ITEMS = 60

const TRIZ_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'bo',
  'by',
  'czy',
  'dla',
  'do',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'is',
  'jak',
  'jest',
  'lub',
  'na',
  'nie',
  'o',
  'of',
  'or',
  'po',
  'przez',
  'the',
  'to',
  'w',
  'with',
  'z',
  'za',
  'ze',
])

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

export const resolveReportLang = (existingLang, requestedLang, fallback = 'pl') =>
  requestedLang || normalizeReportLang(existingLang) || fallback

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

const isEnvEnabled = (value) => value === true || /^(1|true|yes|on)$/i.test(String(value || '').trim())

const previewDiagnosticText = (value, maxChars) => String(value ?? '').slice(0, maxChars)

const looksLikeTruncatedJson = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return false
  const last = raw[raw.length - 1]
  return last !== '}' && last !== ']'
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

const normalizeTrizDirections = (value, limit = MAX_TRIZ_SOLUTION_DIRECTIONS) => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, limit)
}

const normalizeTrizMatchText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const extractTrizSupportTerms = (value, limit = TRIZ_SUPPORT_TERM_LIMIT) => {
  const tokens = normalizeTrizMatchText(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !TRIZ_STOPWORDS.has(token))
  return [...new Set(tokens)].slice(0, limit)
}

const buildTrizSupportText = ({ items, analysisJson }) => {
  const itemText = Array.isArray(items)
    ? items
        .map((item) =>
          [item?.text, item?.label, item?.question]
            .map((part) => String(part || '').trim())
            .filter(Boolean)
            .join(' ')
        )
        .filter(Boolean)
        .join(' \n ')
    : ''
  const analysisText = [
    analysisJson?.topic,
    ...(Array.isArray(analysisJson?.key_themes) ? analysisJson.key_themes : []),
    ...(Array.isArray(analysisJson?.tensions_or_opportunities) ? analysisJson.tensions_or_opportunities : []),
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' \n ')
  return normalizeTrizMatchText(`${itemText} \n ${analysisText}`)
}

const getTrizContradictionMatchText = (item) =>
  [
    item?.title,
    item?.explanation,
    item?.description,
    item?.improving,
    item?.worsening,
    ...(Array.isArray(item?.solution_directions) ? item.solution_directions : []),
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' \n ')

const areTrizContradictionsSimilar = (left, right) => {
  const leftTitle = normalizeTrizMatchText(left?.title)
  const rightTitle = normalizeTrizMatchText(right?.title)
  if (leftTitle && rightTitle && (leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle))) {
    return true
  }
  const leftTerms = extractTrizSupportTerms(getTrizContradictionMatchText(left), 12)
  const rightTerms = extractTrizSupportTerms(getTrizContradictionMatchText(right), 12)
  if (!leftTerms.length || !rightTerms.length) return false
  const overlap = leftTerms.filter((term) => rightTerms.includes(term)).length
  const threshold = Math.max(2, Math.ceil(Math.min(leftTerms.length, rightTerms.length) * 0.5))
  return overlap >= threshold
}

const isTrizContradictionStillSupported = (item, supportText) => {
  if (!item || typeof item !== 'object') return false
  const title = normalizeTrizMatchText(item.title)
  if (title && supportText.includes(title)) return true
  const terms = extractTrizSupportTerms(getTrizContradictionMatchText(item))
  if (!terms.length) return false
  const matches = terms.filter((term) => supportText.includes(term)).length
  return matches >= Math.min(MIN_TRIZ_SUPPORT_MATCHES, terms.length)
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
          const explanation =
            typeof contradiction.explanation === 'string' ? contradiction.explanation.trim() : ''
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
                .slice(0, MAX_TRIZ_PRINCIPLES)
            : []
          const approaches = Array.isArray(contradiction.approaches)
            ? contradiction.approaches
                .map((approach) =>
                  normalizeTrizSolution(approach, {
                    title: contradiction.title,
                    description: contradiction.explanation || contradiction.description,
                  })
                )
                .filter(Boolean)
                .slice(0, MAX_TRIZ_APPROACHES)
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
                .slice(0, MAX_TRIZ_LEGACY_SOLUTIONS)
            : approaches
          const solutionDirections = normalizeTrizDirections(
            contradiction.solution_directions,
            MAX_TRIZ_SOLUTION_DIRECTIONS
          )
          const reflections = normalizeTrizDirections(
            contradiction.reflections,
            MAX_TRIZ_REFLECTIONS
          )
          const title = typeof contradiction.title === 'string' ? contradiction.title.trim() : ''
          const description =
            typeof contradiction.description === 'string' ? contradiction.description.trim() : ''
          const improving =
            typeof contradiction.improving === 'string' ? contradiction.improving.trim() : ''
          const worsening =
            typeof contradiction.worsening === 'string' ? contradiction.worsening.trim() : ''
          const hasNewShape = Boolean(title && explanation)
          const hasOldShape = Boolean(title && description && improving && worsening)
          if (!hasNewShape && !hasOldShape) return null
          const renderedApproaches = approaches.length ? approaches : solutions
          const selectedIndicesRaw = Array.isArray(contradiction.selected_approach_indices)
            ? contradiction.selected_approach_indices
            : []
          const selectedIndicesFromLegacy = (() => {
            const legacyRaw =
              typeof contradiction.selected_approach_index === 'number'
                ? contradiction.selected_approach_index
                : typeof contradiction.selected_approach_index === 'string'
                  ? Number(contradiction.selected_approach_index)
                  : NaN
            return Number.isFinite(legacyRaw) ? [Math.max(0, Math.floor(legacyRaw))] : []
          })()
          const selectedIndices = Array.from(
            new Set(
              [...selectedIndicesRaw, ...selectedIndicesFromLegacy]
                .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
                .filter((entry) => Number.isFinite(entry))
                .map((entry) => Math.max(0, Math.floor(entry)))
                .filter((entry) => entry >= 0 && entry < renderedApproaches.length)
            )
          )
          const selectedTitlesRaw = Array.isArray(contradiction.selected_approach_titles)
            ? contradiction.selected_approach_titles
            : []
          const selectedTitleLegacy =
            typeof contradiction.selected_approach_title === 'string' &&
            contradiction.selected_approach_title.trim()
              ? [contradiction.selected_approach_title.trim()]
              : []
          const selectedTitles = Array.from(
            new Set(
              [...selectedTitlesRaw, ...selectedTitleLegacy]
                .filter((entry) => typeof entry === 'string')
                .map((entry) => String(entry).trim())
                .filter(Boolean)
            )
          )
          return {
            title,
            ...(explanation ? { explanation } : {}),
            ...(solutionDirections.length ? { solution_directions: solutionDirections } : {}),
            ...(approaches.length ? { approaches } : {}),
            ...(selectedIndices.length ? { selected_approach_indices: selectedIndices } : {}),
            ...(selectedTitles.length ? { selected_approach_titles: selectedTitles } : {}),
            ...(reflections.length ? { reflections } : {}),
            ...(description ? { description } : {}),
            ...(improving ? { improving } : {}),
            ...(worsening ? { worsening } : {}),
            principles,
            solutions,
          }
        })
        .filter(Boolean)
        .slice(0, MAX_TRIZ_CONTRADICTIONS)
    : []
  return {
    section_title:
      typeof section.section_title === 'string' ? section.section_title.trim() : '',
    section_intro:
      typeof section.section_intro === 'string' ? section.section_intro.trim() : '',
    contradictions,
  }
}

const mergeTrizKeepingSupportedExisting = ({ existingTriz, generatedTriz, supportText }) => {
  const existing = normalizeTriz(existingTriz)
  const generated = normalizeTriz(generatedTriz)
  const mergedContradictions = [...generated.contradictions]

  existing.contradictions.forEach((existingItem) => {
    const matchIndex = mergedContradictions.findIndex((generatedItem) =>
      areTrizContradictionsSimilar(existingItem, generatedItem)
    )
    if (matchIndex >= 0) {
      const generatedItem = mergedContradictions[matchIndex]
      const existingTitles = Array.isArray(existingItem?.selected_approach_titles)
        ? existingItem.selected_approach_titles
        : []
      const existingLegacyTitle =
        typeof existingItem?.selected_approach_title === 'string' &&
        existingItem.selected_approach_title.trim()
          ? [existingItem.selected_approach_title.trim()]
          : []
      const desiredTitles = Array.from(
        new Set(
          [...existingTitles, ...existingLegacyTitle]
            .filter((entry) => typeof entry === 'string')
            .map((entry) => String(entry).trim())
            .filter(Boolean)
        )
      )
      const alreadySelected =
        (Array.isArray(generatedItem?.selected_approach_indices) &&
          generatedItem.selected_approach_indices.length > 0) ||
        (Array.isArray(generatedItem?.selected_approach_titles) &&
          generatedItem.selected_approach_titles.length > 0) ||
        generatedItem?.selected_approach_index != null ||
        generatedItem?.selected_approach_title
      if (desiredTitles.length && !alreadySelected) {
        const renderedApproaches =
          Array.isArray(generatedItem?.approaches) && generatedItem.approaches.length
            ? generatedItem.approaches
            : Array.isArray(generatedItem?.solutions)
              ? generatedItem.solutions
              : []
        const indices = desiredTitles
          .map((title) => {
            const normalizedTitle = normalizeTrizMatchText(title)
            if (!normalizedTitle) return null
            const idx = renderedApproaches.findIndex(
              (approach) => normalizeTrizMatchText(approach?.title) === normalizedTitle
            )
            return idx >= 0 ? idx : null
          })
          .filter((idx) => idx != null)
        const nextIndices = Array.from(new Set(indices))
        mergedContradictions[matchIndex] = {
          ...generatedItem,
          selected_approach_titles: desiredTitles,
          ...(nextIndices.length ? { selected_approach_indices: nextIndices } : {}),
        }
      }
      return
    }
    if (!isTrizContradictionStillSupported(existingItem, supportText)) return
    mergedContradictions.push(existingItem)
  })

  return normalizeTriz({
    section_title: generated.section_title || existing.section_title,
    section_intro: generated.section_intro || existing.section_intro,
    contradictions: mergedContradictions.slice(0, MAX_TRIZ_CONTRADICTIONS),
  })
}

const normalizeExecutionList = (value, itemNormalizer, limit = 5) => {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => itemNormalizer(item, index)).filter(Boolean).slice(0, limit)
}

const normalizeExecutionText = (value) => (typeof value === 'string' ? value.trim() : '')

const normalizeExecutionImpact = (value) =>
  value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'

const normalizeExecutionSelectedOption = (value) =>
  value === 'a' || value === 'b' ? value : null

const EXECUTION_PLACEHOLDER_PATTERNS = [
  /this priority affects the next product decisions around/i,
  /if ignored, the team may keep moving without clarity around/i,
  /define a small test or observation to verify/i,
  /the current direction gains support and can move forward/i,
  /the direction should be adjusted before more effort is invested/i,
  /prefer the simpler or lower-risk path/i,
  /prefer the more ambitious or higher-upside path/i,
  /choose the safer path when/i,
  /choose the bolder path when/i,
]

const normalizeQualityKey = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const countDistinctNonEmpty = (values) => {
  const normalized = (Array.isArray(values) ? values : [])
    .map((item) => normalizeQualityKey(item))
    .filter(Boolean)
  return new Set(normalized).size
}

const isExecutionPlaceholderText = (value) => {
  const normalized = normalizeExecutionText(value)
  if (!normalized) return false
  return EXECUTION_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
}

const sanitizeExecutionDetailText = (value) => {
  const normalized = normalizeExecutionText(value)
  if (!normalized) return ''
  return isExecutionPlaceholderText(normalized) ? '' : normalized
}

const EXECUTION_ACTION_STATUSES = ['pending', 'in_progress', 'completed']

const normalizeExecutionStatus = (value) => {
  const v = typeof value === 'string' ? value.trim() : ''
  return v === 'pending' || v === 'in_progress' || v === 'completed' ? v : 'pending'
}

const normalizeExecutionTechnologyOptions = (value) => {
  if (!Array.isArray(value)) return []
  const items = value
    .map((x) => normalizeExecutionText(x))
    .filter(Boolean)
    .slice(0, 3)
  return items
}

// NOTE: Action plan readability depends on preserving natural LLM wording.
// Keep normalization minimal for any user-facing plan text; avoid forcing rigid verbs,
// truncating titles, or inventing placeholder "done_when"/tags that flatten the output.

export const sanitizeExecutionActionStep = (rawStep, reportLang) => {
  const lang = reportLang === 'pl' ? 'pl' : 'en'
  let value = normalizeExecutionText(rawStep)
  if (!value) return ''

  // Remove leaked English meta-prefixes in Polish locale.
  if (lang === 'pl') {
    value = value.replace(/^(define|design|build|test|action|task)\s+/i, '')
    if (value && value[0] === value[0].toLowerCase()) {
      value = `${value[0].toUpperCase()}${value.slice(1)}`
    }
    // If the step already starts with a Polish imperative verb, keep it.
    if (startsWithImperativeVerb(value, 'pl')) return value
    // If it starts with an English imperative verb, drop it (we want Polish-only).
    value = value.replace(/^(design|build|test|compare|select|estimate|define|validate)\s+/i, '')
    if (value && value[0] === value[0].toLowerCase()) {
      value = `${value[0].toUpperCase()}${value.slice(1)}`
    }
    return value
  }

  // English locale: keep as-is (verb enforcement happens elsewhere).
  return value
}

const diagnoseExecutionActionPlan = (actionPlan, reportLang) => {
  const lang = reportLang === 'en' ? 'en' : 'pl'
  const items = Array.isArray(actionPlan) ? actionPlan : []
  const inProgressCount = items.filter((x) => x && typeof x === 'object' && x.status === 'in_progress').length
  const defineLeaks = items
    .filter((x) => x && typeof x === 'object')
    .map((x, idx) => ({ idx, step: String(x.step || '') }))
    .filter(({ step }) => /^(define|action|task)\s+/i.test(step.trim()))
  const mixedLanguage = lang === 'pl'
    ? items
        .filter((x) => x && typeof x === 'object')
        .map((x, idx) => ({ idx, step: String(x.step || '') }))
        .filter(({ step }) => /\b(define|design|build|test)\b/i.test(step) && /\b(zaprojektuj|zbuduj|przetestuj|dobierz|oszacuj|zweryfikuj|zdefiniuj)\b/i.test(step))
    : []
  return {
    inProgressCount,
    defineLeakCount: defineLeaks.length,
    defineLeaks,
    mixedLanguageCount: mixedLanguage.length,
    mixedLanguage,
  }
}

const ensureSingleInProgress = (items, options = {}) => {
  const allowCompleted = options.allowCompleted === true
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : []
  if (list.length === 0) return []

  const sanitized = list.map((item) => {
    const rawStatus = normalizeExecutionStatus(item.status)
    const status = allowCompleted ? rawStatus : rawStatus === 'completed' ? 'pending' : rawStatus
    return { ...item, status }
  })

  const inProgressIndices = sanitized
    .map((item, idx) => (item.status === 'in_progress' ? idx : -1))
    .filter((idx) => idx >= 0)

  if (inProgressIndices.length === 1) return sanitized

  if (inProgressIndices.length > 1) {
    const keep = inProgressIndices[0]
    return sanitized.map((item, idx) =>
      idx === keep ? item : item.status === 'in_progress' ? { ...item, status: 'pending' } : item
    )
  }

  // None in progress => pick first non-completed; otherwise first item.
  const firstNonCompleted = sanitized.findIndex((item) => item.status !== 'completed')
  const target = firstNonCompleted >= 0 ? firstNonCompleted : 0
  return sanitized.map((item, idx) => (idx === target ? { ...item, status: 'in_progress' } : { ...item, status: 'pending' }))
}

const initializeActionPlanStatuses = (items, options = {}) => {
  const allowCompleted = options.allowCompleted === true
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : []
  if (list.length === 0) return []
  const normalized = list.map((item) => ({
    ...item,
    status: allowCompleted ? normalizeExecutionStatus(item.status) : normalizeExecutionStatus(item.status) === 'completed' ? 'pending' : normalizeExecutionStatus(item.status),
  }))
  // New-plan policy: first in progress, rest pending (unless completed allowed and already present).
  if (!allowCompleted) {
    return normalized.map((item, idx) => ({ ...item, status: idx === 0 ? 'in_progress' : 'pending' }))
  }
  // If completed exists, do not override; just ensure single in_progress.
  return ensureSingleInProgress(normalized, { allowCompleted })
}

const startsWithImperativeVerb = (text, lang) => {
  const value = normalizeExecutionText(text)
  if (!value) return false
  const first = value.split(/\s+/).filter(Boolean)[0] || ''
  if (!first) return false
  if (lang === 'en') {
    const verbs = [
      'Design',
      'Build',
      'Test',
      'Compare',
      'Select',
      'Estimate',
      'Define',
      'Validate',
      'Set',
      'Narrow',
      'Evaluate',
      'Analyze',
      'Choose',
      'Plan',
      'Prepare',
      'Write',
      'Draft',
      'Prototype',
      'Implement',
      'Instrument',
      'Measure',
      'Run',
      'Create',
      'Document',
      'Review',
    ]
    return verbs.includes(first)
  }
  const verbs = [
    'Zaprojektuj',
    'Zbuduj',
    'Przetestuj',
    'Przeprowadź',
    'Sformułuj',
    'Wyznacz',
    'Sprawdź',
    'Oceń',
    'Porównaj',
    'Dobierz',
    'Oszacuj',
    'Zdefiniuj',
    'Zweryfikuj',
    'Ustal',
    'Określ',
    'Wybierz',
    'Zaplanuj',
    'Napisz',
    'Przygotuj',
    'Prototypuj',
    'Wdroż',
    'Zmierz',
    'Uruchom',
    'Stwórz',
    'Opisz',
    'Przejrzyj',
  ]
  return verbs.includes(first)
}

const isLikelyTradeoffTitle = (text) => {
  const value = normalizeExecutionText(text)
  if (!value) return false
  if (!/\bvs\.\b|\bvs\b/i.test(value)) return false
  if (startsWithImperativeVerb(value, 'pl') || startsWithImperativeVerb(value, 'en')) return false
  return true
}

const stripLeadingMetaPrefixes = (text, lang) => {
  let value = normalizeExecutionText(text)
  if (!value) return ''
  value = value.replace(/^(define|design|build|test|action|task)\s+/i, '')
  if (lang === 'pl') {
    value = value.replace(
      /^zdefiniuj\s+(przeprowadź|sformułuj|wyznacz|ustal|określ|przygotuj|sprawdź|oceń|zmierz|porównaj|zbuduj|zaprojektuj|dobierz|oszacuj|zweryfikuj)\b/i,
      (_, verb) => `${verb[0].toUpperCase()}${verb.slice(1)}`
    )
  }
  return value.trim()
}

const looksLikeNounPhrase = (text, lang) => {
  const value = normalizeExecutionText(text)
  if (!value) return false
  if (startsWithImperativeVerb(value, lang)) return false
  // Heuristic: starts with a noun-like Polish/English token, often capitalized only at start, no verb.
  // We treat "Prototyp ..." and "Projekt ..." as noun-phrase topics.
  const first = value.split(/\s+/).filter(Boolean)[0] || ''
  if (!first) return false
  const nounStartersEn = ['Prototype', 'Design', 'Project', 'Implementation', 'Testing', 'Evaluation']
  const nounStartersPl = ['Prototyp', 'Projekt', 'Testy', 'Test', 'Wycena', 'Analiza', 'Dobór']
  return lang === 'en' ? nounStartersEn.includes(first) : nounStartersPl.includes(first)
}

export const rewriteNounPhraseActionStep = (step, details, lang) => {
  const rawStep = normalizeExecutionText(step)
  if (!rawStep) return ''
  const rawDetails = normalizeExecutionText(details)
  const text = `${rawStep} ${rawDetails}`.toLowerCase()

  const pickVerb = () => {
    if (lang === 'en') {
      if (/\b(test|testing|validate|verification|trial)\b/.test(text)) return 'Test'
      if (/\b(prototype|build|assemble|fabricate)\b/.test(text)) return 'Build'
      if (/\b(compare|evaluate|trade-off)\b/.test(text)) return 'Compare'
      if (/\b(select|material|aluminum|aluminium|composite|carbon|steel|nylon)\b/.test(text)) return 'Select'
      if (/\b(cost|production|manufactur|scalab)\b/.test(text)) return 'Estimate'
      if (/\b(scale|marking|markings|indicator)\b/.test(text)) return 'Design'
      if (/\b(mechanism|system|mount|mounting|lock|latch)\b/.test(text)) return 'Design'
      return ''
    }
    // pl
    if (/\b(test|testy|przetest|zweryfik|sprawdź)\b/.test(text)) return 'Przetestuj'
    if (/\b(prototyp|zbuduj|wydruk|złóż|montaż)\b/.test(text)) return 'Zbuduj prototyp'
    if (/\b(porównaj|porównanie)\b/.test(text)) return 'Porównaj'
    if (/\b(dobierz|materiał|material|aluminium|aluminum|kompozyt|węgl|stal|nylon)\b/.test(text)) {
      return /\b(porównaj|porównanie)\b/.test(text) ? 'Porównaj' : 'Dobierz'
    }
    if (/\b(koszt|produkcj|wykonalno|skalowalno)\b/.test(text)) return 'Oszacuj'
    if (/\b(skala|oznaczen|wskaźnik)\b/.test(text)) return 'Zaprojektuj'
    if (/\b(mechanizm|system|mocowan|blokad|zatrzask)\b/.test(text)) return 'Zaprojektuj'
    return ''
  }

  const verb = pickVerb()
  if (!verb) return ''

  const cleaned = rawStep.replace(/[.。!]+$/g, '').trim()
  const suffix =
    lang === 'pl' && verb.toLowerCase().includes('prototyp')
      ? cleaned.replace(/^prototyp\s+/i, '').trim()
      : cleaned

  const normalizedSuffix =
    lang === 'pl' && suffix && suffix[0] === suffix[0].toUpperCase()
      ? `${suffix[0].toLowerCase()}${suffix.slice(1)}`
      : suffix

  return `${verb} ${normalizedSuffix}`.trim()
}

export const validatePolishedActionPlan = (original, polished, reportLang) => {
  const lang = reportLang === 'pl' ? 'pl' : 'en'
  const originalList = Array.isArray(original) ? original.filter((x) => x && typeof x === 'object') : []
  const polishedList = Array.isArray(polished) ? polished.filter((x) => x && typeof x === 'object') : []
  const errors = []

  if (originalList.length !== polishedList.length) {
    errors.push('length_mismatch')
    return { ok: false, errors }
  }

  const hasExactlyOneInProgress =
    originalList.filter((x) => normalizeExecutionStatus(x?.status) === 'in_progress').length === 1

  const forbidMetaPrefixes =
    lang === 'pl'
      ? /^(define|design|build|test|action|task)\s+/i
      : /^(action|task)\s+/i

  for (let i = 0; i < originalList.length; i += 1) {
    const originalItem = originalList[i]
    const candidate = polishedList[i]

    const originalStatus = normalizeExecutionStatus(originalItem?.status)
    const candidateStatus = normalizeExecutionStatus(candidate?.status)
    if (candidateStatus !== originalStatus) errors.push(`status_changed:${i}`)

    const step = sanitizeExecutionActionStep(normalizeExecutionText(candidate?.step), lang)
    const details = sanitizeExecutionDetailText(candidate?.details)
    const done_when = sanitizeExecutionDetailText(candidate?.done_when)
    const technology_options = normalizeExecutionTechnologyOptions(candidate?.technology_options)

    if (!step) errors.push(`missing_step:${i}`)
    if (!done_when) errors.push(`missing_done_when:${i}`)

    if (step && forbidMetaPrefixes.test(step)) errors.push(`meta_prefix:${i}`)
    if (step && !startsWithImperativeVerb(step, lang)) errors.push(`not_imperative:${i}`)

    const wordCount = step ? step.split(/\s+/).filter(Boolean).length : 0
    if (wordCount > 10) errors.push(`step_too_long:${i}`)

    if (technology_options.length > 3) errors.push(`technology_options_too_many:${i}`)
    if (technology_options.some((x) => typeof x !== 'string' || !normalizeExecutionText(x))) {
      errors.push(`technology_options_invalid:${i}`)
    }

    // Ensure we don't create mixed-language "Define zaprojektuj..." leaks.
    if (
      lang === 'pl' &&
      step &&
      /\b(define|design|build|test)\b/i.test(step) &&
      /\b(zaprojektuj|zbuduj|przetestuj|dobierz|oszacuj|zweryfikuj|zdefiniuj|przeprowadź|sformułuj|wyznacz)\b/i.test(
        step
      )
    ) {
      errors.push(`mixed_language:${i}`)
    }
  }

  if (
    hasExactlyOneInProgress &&
    polishedList.filter((x) => normalizeExecutionStatus(x?.status) === 'in_progress').length !== 1
  ) {
    errors.push('in_progress_count_changed')
  }

  return { ok: errors.length === 0, errors }
}

const rewriteStepToImperative = (step, lang) => {
  const value = normalizeExecutionText(step)
  if (!value) return ''
  const stripped = stripLeadingMetaPrefixes(value, lang)
  if (startsWithImperativeVerb(stripped, lang)) return stripped
  // Strip any leaked English meta-prefixes before rewriting (common failure: "Define zaprojektuj ...").
  const withoutMetaPrefix = stripped.replace(/^(define|design|build|test|action|task)\s+/i, '')
  if (withoutMetaPrefix !== value && startsWithImperativeVerb(withoutMetaPrefix, 'pl')) {
    return withoutMetaPrefix
  }
  if (withoutMetaPrefix !== value && startsWithImperativeVerb(withoutMetaPrefix, 'en')) {
    return withoutMetaPrefix
  }
  const lower = value.toLowerCase()
  const mappingsEn = [
    [/^prototype\b/i, 'Build'],
    [/^design\b/i, 'Design'],
    [/^testing\b/i, 'Test'],
    [/^test\b/i, 'Test'],
    [/^evaluation\b/i, 'Evaluate'],
    [/^analysis\b/i, 'Analyze'],
    [/^implementation\b/i, 'Implement'],
    [/^project\b/i, 'Define'],
  ]
  const mappingsPl = [
    [/^prototyp\b/i, 'Zbuduj prototyp'],
    [/^projekt\b/i, 'Zaprojektuj'],
    [/^testy\b/i, 'Przetestuj'],
    [/^test\b/i, 'Przetestuj'],
    [/^analiza\b/i, 'Przeanalizuj'],
    [/^wycena\b/i, 'Oszacuj'],
    [/^dobór\b/i, 'Dobierz'],
  ]
  const mappings = lang === 'en' ? mappingsEn : mappingsPl
  for (const [re, verb] of mappings) {
    if (re.test(value)) {
      const rest = value.replace(re, '').trim()
      return rest ? `${verb} ${rest}` : verb
    }
  }
  if (looksLikeNounPhrase(value, lang)) {
    const rewritten = rewriteNounPhraseActionStep(value, '', lang)
    if (rewritten && startsWithImperativeVerb(rewritten, lang)) return rewritten
  }
  if (lang === 'pl') {
    const tokens = withoutMetaPrefix.split(/\s+/).filter(Boolean)
    if (tokens.length >= 2) {
      const second = tokens[1] || ''
      const candidate = `${second} ${tokens.slice(2).join(' ')}`.trim()
      if (startsWithImperativeVerb(candidate, 'pl')) return candidate
    }
  }
  // Fallback: prefix with a neutral imperative verb.
  return lang === 'en' ? `Design ${lower}` : `Zdefiniuj ${lower}`
}

const coerceExecutionActionPlanItem = (item, lang) => {
  if (!item || typeof item !== 'object') return null

  // New shape
  const rawStep = normalizeExecutionText(item.step)
  const rawDetails = normalizeExecutionText(item.details)
  const rawDoneWhen = normalizeExecutionText(item.done_when || item.doneWhen)
  const rawStatus = normalizeExecutionStatus(item.status)
  const rawTech = normalizeExecutionTechnologyOptions(item.technology_options || item.technologyOptions)

  // Old shape fallbacks (backward compatibility)
  const oldTitle = normalizeExecutionText(item.title || item.action || item.task || item.krok)
  const oldWhat = normalizeExecutionText(item.what_to_do || item.what || item.do)
  const oldExpected = normalizeExecutionText(item.expected_result || item.expectedResult || item.success_criteria || item.successCriteria)

  const stepCandidate = rawStep || oldTitle || oldWhat
  const detailsCandidate = rawDetails || oldWhat
  const doneWhenCandidate = rawDoneWhen || oldExpected

  if (!stepCandidate && !detailsCandidate && !doneWhenCandidate) return null

  // Preserve natural phrasing from the LLM/user as much as possible.
  // We only remove leaked meta-prefixes and keep optional fields optional.
  let step = sanitizeExecutionActionStep(stepCandidate, lang)
  step = stripLeadingMetaPrefixes(step, lang)
  if (isLikelyTradeoffTitle(step) || isLikelyTradeoffTitle(stepCandidate)) return null
  const details = sanitizeExecutionDetailText(detailsCandidate)
  const done_when = sanitizeExecutionDetailText(doneWhenCandidate)

  const trimDangling = (value, locale) => {
    const text = normalizeExecutionText(value)
    if (!text) return ''
    const stopwords =
      locale === 'en'
        ? ['and', 'or', 'to', 'with', 'of', 'in', 'at', 'for', 'on', 'from']
        : ['i', 'oraz', 'albo', 'po', 'do', 'z', 'ze', 'w', 'we', 'na', 'od', 'dla']
    const parts = text.split(/\s+/).filter(Boolean)
    while (parts.length > 2) {
      const last = (parts[parts.length - 1] || '').toLowerCase()
      if (!stopwords.includes(last)) break
      parts.pop()
    }
    return parts.join(' ')
  }

  step = trimDangling(step, lang)
  step = sanitizeExecutionActionStep(step, lang)
  step = stripLeadingMetaPrefixes(step, lang)
  if (!step) return null

  // Preserve meta fields for UI grouping if present; they are not part of the contract but harmless for storage/display.
  const source_type =
    item.source_type === 'decision' || item.source_type === 'triz' || item.source_type === 'analysis'
      ? item.source_type
      : null
  const source_ref = typeof item.source_ref === 'string' && item.source_ref.trim() ? item.source_ref.trim() : null
  const derived_from_user_choice =
    typeof item.derived_from_user_choice === 'boolean' ? item.derived_from_user_choice : null

  return {
    step,
    status: rawStatus,
    details,
    technology_options: rawTech,
    done_when,
    ...(source_type ? { source_type } : {}),
    ...(source_ref ? { source_ref } : {}),
    ...(typeof derived_from_user_choice === 'boolean' ? { derived_from_user_choice } : {}),
  }
}

const MAX_EXEC_ROADMAP_PHASES = 6

const isGenericRoadmapPhaseTitle = (value) => {
  const key = normalizeQualityKey(value)
  if (!key) return true
  if (/^(etap|faza)(\s+\d+)?$/.test(key)) return true
  if (/^(phase|stage)(\s+\d+)?$/.test(key)) return true
  return false
}

const coerceExecutionRoadmapPhase = (value, lang, index = 0) => {
  if (!value || typeof value !== 'object') return null
  const rawTitle = normalizeExecutionText(value.phase_title || value.title || value.name)
  const why_this_phase_matters = sanitizeExecutionDetailText(
    value.why_this_phase_matters || value.why || value.why_it_matters || value.reason || value.narrative
  )
  const key_risk_or_tradeoff = sanitizeExecutionDetailText(
    value.key_risk_or_tradeoff ||
      value.risks_reduced ||
      value.risks ||
      value.uncertainty_reduced ||
      value.tradeoff
  )
  const validation_or_test = sanitizeExecutionDetailText(
    value.validation_or_test || value.validation || value.test || value.exit_criteria
  )
  const decision_unlocked = sanitizeExecutionDetailText(
    value.decision_unlocked || value.decision || value.exit || value.gate
  )
  const actionsRaw = Array.isArray(value.concrete_actions)
    ? value.concrete_actions
    : Array.isArray(value.actions)
      ? value.actions
      : []
  const concrete_actions = actionsRaw
    .map((a) => {
      if (typeof a === 'string') return sanitizeExecutionDetailText(a)
      if (!a || typeof a !== 'object') return ''
      const text = sanitizeExecutionDetailText(a.text || a.action || a.step)
      const gate = sanitizeExecutionDetailText(a.validation_gate || a.validation || a.gate)
      return [text, gate].filter(Boolean).join(' — ')
    })
    .filter(Boolean)
    .slice(0, 12)

  const hasSourceContent =
    Boolean(rawTitle && !isGenericRoadmapPhaseTitle(rawTitle)) ||
    Boolean(why_this_phase_matters) ||
    Boolean(key_risk_or_tradeoff) ||
    Boolean(validation_or_test) ||
    Boolean(decision_unlocked) ||
    concrete_actions.length > 0
  if (!hasSourceContent) return null

  const phaseTitleFromContext = (() => {
    const source = key_risk_or_tradeoff || why_this_phase_matters || validation_or_test || concrete_actions[0] || ''
    const words = normalizeExecutionText(source).split(/\s+/).filter(Boolean).slice(0, 9).join(' ')
    if (!words) return lang === 'pl' ? `Etap ${index + 1} — ogranicz kluczową niewiadomą` : `Phase ${index + 1} — reduce the key uncertainty`
    return lang === 'pl' ? `Etap ${index + 1} — ${words}` : `Phase ${index + 1} — ${words}`
  })()
  const phase_title = isGenericRoadmapPhaseTitle(rawTitle) ? phaseTitleFromContext : rawTitle

  return {
    phase_title,
    why_this_phase_matters,
    key_risk_or_tradeoff,
    concrete_actions,
    validation_or_test,
    decision_unlocked,
  }
}

const normalizeExecutionReport = (value, reportLang = 'en') => {
  const empty = {
    stage: null,
    headline: '',
    goal: '',
    map_context: {
      coverage_summary: '',
      strongest_area: null,
      weakest_area: null,
      decision_risk_note: null,
    },
    priorities: [],
    roadmap_phases: [],
    action_plan: [],
    decisions: [],
    validation_loop: [],
    next_session_focus: '',
    supporting_items: [],
    source_snapshot: null,
  }
  if (!value || typeof value !== 'object') return { ...empty }
  const report = value
  const inferredStage = (() => {
    const rawStage = typeof report.stage === 'string' ? report.stage.trim() : ''
    if (rawStage === 'awaiting_decisions' || rawStage === 'plan_generated') return rawStage
    const hasPlan =
      (Array.isArray(report.priorities) && report.priorities.length > 0) ||
      (Array.isArray(report.roadmap_phases) && report.roadmap_phases.length > 0) ||
      (Array.isArray(report.roadmapPhases) && report.roadmapPhases.length > 0) ||
      (Array.isArray(report.action_plan) && report.action_plan.length > 0) ||
      (Array.isArray(report.validation_loop) && report.validation_loop.length > 0) ||
      normalizeExecutionText(report.next_session_focus || report.nextSessionFocus).length > 0
    return hasPlan ? 'plan_generated' : 'awaiting_decisions'
  })()
  return {
    stage: inferredStage,
    headline: normalizeExecutionText(report.headline),
    goal: normalizeExecutionText(report.goal || report.objective || report.primary_goal),
    map_context: report.map_context && typeof report.map_context === 'object'
      ? {
          coverage_summary:
            normalizeExecutionText(
              report.map_context.coverage_summary ||
                report.map_context.coverageSummary ||
                report.map_context.summary
            ),
          strongest_area:
            normalizeExecutionText(
              report.map_context.strongest_area || report.map_context.strongestArea
            )
              ? normalizeExecutionText(
                  report.map_context.strongest_area || report.map_context.strongestArea
                )
              : null,
          weakest_area:
            normalizeExecutionText(
              report.map_context.weakest_area || report.map_context.weakestArea
            )
              ? normalizeExecutionText(
                  report.map_context.weakest_area || report.map_context.weakestArea
                )
              : null,
          decision_risk_note:
            normalizeExecutionText(
              report.map_context.decision_risk_note || report.map_context.decisionRiskNote
            )
              ? normalizeExecutionText(
                  report.map_context.decision_risk_note || report.map_context.decisionRiskNote
                )
              : null,
        }
      : empty.map_context,
	    priorities: normalizeExecutionList(report.priorities, (item) => {
      if (typeof item === 'string') {
        const title = item.trim()
        if (!title) return null
        return {
          title,
          why_it_matters: '',
          impact: 'medium',
          risk_of_ignoring: '',
        }
      }
      if (!item || typeof item !== 'object') return null
      const title = normalizeExecutionText(item.title || item.priority || item.focus)
      if (!title) return null
      return {
        title,
        why_it_matters: '',
        impact: normalizeExecutionImpact(item.impact),
        risk_of_ignoring: '',
      }
	    }),
	    roadmap_phases: normalizeExecutionList(
	      report.roadmap_phases || report.roadmapPhases,
	      (item, index) => coerceExecutionRoadmapPhase(item, reportLang === 'pl' ? 'pl' : 'en', index),
	      MAX_EXEC_ROADMAP_PHASES
	    ),
	    action_plan: normalizeExecutionList(
	      report.action_plan,
	      (item) => {
        if (typeof item === 'string') {
          const text = item.trim()
          if (!text) return null
          return coerceExecutionActionPlanItem(
            { step: text, status: 'pending', details: '', technology_options: [], done_when: '' },
            reportLang
          )
        }
        return coerceExecutionActionPlanItem(item, reportLang)
      },
      MAX_EXEC_ACTION_PLAN_ITEMS
    ),
    decisions: normalizeExecutionList(report.decisions, (item) => {
      if (typeof item === 'string') {
        const tradeoff = item.trim()
        if (!tradeoff) return null
        return {
          tradeoff,
          option_a: '',
          option_b: '',
          consequence_a: '',
          consequence_b: '',
          choose_a_when: '',
          choose_b_when: '',
          selected_option: null,
        }
      }
      if (!item || typeof item !== 'object') return null
      const tradeoff = normalizeExecutionText(item.tradeoff || item.title || item.decision || item.decyzja)
      const contradictionIndexRaw = Number(item.contradiction_index ?? item.contradictionIndex ?? NaN)
      const contradiction_index = Number.isFinite(contradictionIndexRaw)
        ? Math.max(0, Math.floor(contradictionIndexRaw))
        : null
      const optionA = sanitizeExecutionDetailText(item.option_a || item.optionA || item.a)
      const optionB = sanitizeExecutionDetailText(item.option_b || item.optionB || item.b)
      const consequenceA = sanitizeExecutionDetailText(
        item.consequence_a || item.konsekwencja_a
      )
      const consequenceB = sanitizeExecutionDetailText(
        item.consequence_b || item.konsekwencja_b
      )
      if (!tradeoff) return null
      return {
        contradiction_index,
        tradeoff,
        option_a: optionA,
        option_b: optionB,
        consequence_a: consequenceA,
        consequence_b: consequenceB,
        choose_a_when: '',
        choose_b_when: '',
        selected_option: normalizeExecutionSelectedOption(item.selected_option),
      }
    }),
    validation_loop: normalizeExecutionList(report.validation_loop, (item) => {
      if (typeof item === 'string') {
        const check = item.trim()
        if (!check) return null
        return {
          check,
          how_to_check: '',
          positive_result_means: '',
          negative_result_means: '',
        }
      }
      if (!item || typeof item !== 'object') return null
      const check = normalizeExecutionText(item.check || item.title || item.cel)
      if (!check) return null
      return {
        check,
        how_to_check: '',
        positive_result_means: '',
        negative_result_means: '',
      }
    }),
    next_session_focus:
      normalizeExecutionText(report.next_session_focus || report.nextSessionFocus),
    supporting_items: Array.isArray(report.supporting_items)
      ? report.supporting_items.filter((item) => item && typeof item === 'object').slice(0, 8)
      : [],
    source_snapshot: report.source_snapshot && typeof report.source_snapshot === 'object'
      ? report.source_snapshot
      : null,
  }
}

const assessExecutionReportQuality = (report) => {
  const priorities = Array.isArray(report?.priorities) ? report.priorities : []
  const roadmapPhases = Array.isArray(report?.roadmap_phases)
    ? report.roadmap_phases
    : Array.isArray(report?.roadmapPhases)
      ? report.roadmapPhases
      : []
  const actionPlan = Array.isArray(report?.action_plan) ? report.action_plan : []
  const decisions = Array.isArray(report?.decisions) ? report.decisions : []
  const validationLoop = Array.isArray(report?.validation_loop) ? report.validation_loop : []
  const countMeaningful = (items, keys) =>
    items.filter((item) => {
      if (!item || typeof item !== 'object') return false
      return keys.every((key) => normalizeExecutionText(item[key]).length > 0)
    }).length

  const prioritiesComplete = countMeaningful(priorities, ['title'])
	  const roadmapComplete = roadmapPhases.filter((phase) => {
	    if (!phase || typeof phase !== 'object') return false
    const titleOk = normalizeExecutionText(phase.phase_title || phase.title).length > 0
    const narrativeOk =
      normalizeExecutionText(
        phase.why_this_phase_matters ||
          phase.key_risk_or_tradeoff ||
          phase.validation_or_test ||
          phase.decision_unlocked ||
          phase.narrative ||
          phase.why ||
          phase.risks_reduced
      ).length > 0
    const actions = Array.isArray(phase.concrete_actions)
      ? phase.concrete_actions
      : Array.isArray(phase.actions)
        ? phase.actions
        : []
    const actionsOk = actions.some((a) => normalizeExecutionText(a?.text || a).length > 0)
	    return titleOk && (narrativeOk || actionsOk)
	  }).length
  const actionPlanComplete = countMeaningful(actionPlan, ['step'])
  const decisionsComplete = decisions.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return normalizeExecutionText(item.tradeoff).length > 0
  }).length
  const validationComplete = countMeaningful(validationLoop, ['check'])

  const prioritiesDistinct = countDistinctNonEmpty(priorities.map((item) => item?.title))
  const roadmapDistinct = countDistinctNonEmpty(roadmapPhases.map((p) => p?.title))
  const actionPlanDistinct = countDistinctNonEmpty(actionPlan.map((item) => item?.step || item?.title))
  const decisionsDistinct = countDistinctNonEmpty(decisions.map((item) => item?.tradeoff))
  const validationDistinct = countDistinctNonEmpty(validationLoop.map((item) => item?.check))

  const countTooShort = (items, key, minLen) =>
    items.filter((item) => normalizeExecutionText(item?.[key]).length > 0 && normalizeExecutionText(item?.[key]).length < minLen)
      .length
  const prioritiesTooShort = countTooShort(priorities, 'title', 12)
  const actionPlanTooShort = countTooShort(actionPlan, 'step', 12)
  const decisionsTooShort = countTooShort(decisions, 'tradeoff', 16)
  const validationTooShort = countTooShort(validationLoop, 'check', 12)

  const placeholderDecisions = decisions.filter((item) =>
    isExecutionPlaceholderText(item?.option_a) ||
    isExecutionPlaceholderText(item?.option_b) ||
    isExecutionPlaceholderText(item?.consequence_a) ||
    isExecutionPlaceholderText(item?.consequence_b)
  ).length
  const placeholderOptions = decisions.filter((item) =>
    sanitizeExecutionDetailText(item?.option_a) === '' && normalizeExecutionText(item?.option_a)
  ).length

  const countUnderTargetSections = [
    prioritiesComplete < Math.min(TARGET_EXEC_PRIORITIES, 2),
    Math.max(actionPlanComplete, roadmapComplete) < Math.min(TARGET_EXEC_ACTION_PLAN, 2),
    decisionsComplete < Math.min(TARGET_EXEC_DECISIONS, 1),
    validationComplete < Math.min(TARGET_EXEC_VALIDATION, 1),
  ].filter(Boolean).length

  const sectionsWithContent = [
    prioritiesComplete > 0,
    actionPlanComplete > 0 || roadmapComplete > 0,
    decisionsComplete > 0,
    validationComplete > 0,
  ].filter(Boolean).length

  const duplicatePenalty = [
    prioritiesDistinct < Math.min(prioritiesComplete, 2),
    Math.max(actionPlanDistinct, roadmapDistinct) < Math.min(Math.max(actionPlanComplete, roadmapComplete), 2),
    decisionsDistinct < Math.min(decisionsComplete, 2),
    validationDistinct < Math.min(validationComplete, 2),
  ].filter(Boolean).length

  const tooShortPenalty =
    Math.min(2, prioritiesTooShort) +
    Math.min(2, actionPlanTooShort) +
    Math.min(2, decisionsTooShort) +
    Math.min(2, validationTooShort)

  const placeholderPenalty =
    Math.min(2, placeholderDecisions) + Math.min(1, placeholderOptions)

  const qualityScore = sectionsWithContent * 3 + Math.min(4, prioritiesComplete) + Math.min(4, Math.max(actionPlanComplete, roadmapComplete)) +
    Math.min(3, decisionsComplete) + Math.min(3, validationComplete) -
    (duplicatePenalty * 2 + Math.min(4, tooShortPenalty) + placeholderPenalty + Math.min(2, countUnderTargetSections))

  const lowSubstance =
    sectionsWithContent < 3 ||
    duplicatePenalty > 0 ||
    tooShortPenalty >= 3 ||
    placeholderPenalty >= 2 ||
    (prioritiesComplete + actionPlanComplete + decisionsComplete + validationComplete) < 6

  return {
    prioritiesComplete,
    actionPlanComplete,
    decisionsComplete,
    validationComplete,
    sectionsWithContent,
    prioritiesDistinct,
    actionPlanDistinct,
    decisionsDistinct,
    validationDistinct,
    prioritiesTooShort,
    actionPlanTooShort,
    decisionsTooShort,
    validationTooShort,
    placeholderDecisions,
    qualityScore,
    mostlyEmpty: sectionsWithContent < 2,
    lowSubstance,
  }
}

const assessTrizQuality = (triz) => {
  const normalized = normalizeTriz(triz)
  const contradictions = Array.isArray(normalized?.contradictions) ? normalized.contradictions : []
  const titles = contradictions.map((c) => String(c?.title || '').trim())
  const explanations = contradictions.map((c) => String(c?.explanation || '').trim())
  const hasEnough = contradictions.length >= 2
  const distinctTitles = countDistinctNonEmpty(titles)
  const thinExplanations = explanations.filter((e) => e && e.length < 40).length
  return {
    contradictionCount: contradictions.length,
    distinctTitles,
    hasEnough,
    thinExplanations,
    mostlyEmpty: contradictions.length === 0,
    lowSubstance:
      contradictions.length < 2 ||
      distinctTitles < Math.min(contradictions.length, 2) ||
      thinExplanations >= Math.ceil(Math.max(1, contradictions.length) * 0.6),
  }
}

const assessDecisionTrizAlignment = ({ triz, executionReport }) => {
  const normalizedTriz = normalizeTriz(triz)
  const contradictions = Array.isArray(normalizedTriz?.contradictions)
    ? normalizedTriz.contradictions.filter((item) => String(item?.title || '').trim())
    : []
  const decisions = Array.isArray(executionReport?.decisions) ? executionReport.decisions : []
  if (contradictions.length < 2 || decisions.length === 0) return []

  const reasons = []
  const expectedCount = contradictions.length
  if (decisions.length < expectedCount) {
    reasons.push('decision_count_not_aligned_with_triz')
  }

  const normalizedTitles = contradictions.map((c) => normalizeTrizMatchText(c.title))
  const matchesAnyTitle = (tradeoff) => {
    const normalizedTradeoff = normalizeTrizMatchText(tradeoff)
    if (!normalizedTradeoff) return false
    return normalizedTitles.some((title) => title && (normalizedTradeoff.includes(title) || title.includes(normalizedTradeoff)))
  }

  const compareCount = Math.min(expectedCount, decisions.length)
  for (let index = 0; index < compareCount; index += 1) {
    const decisionTradeoff = String(decisions[index]?.tradeoff || '').trim()
    const contradictionTitle = String(contradictions[index]?.title || '').trim()
    if (!decisionTradeoff || !contradictionTitle) continue
    const normDecision = normalizeTrizMatchText(decisionTradeoff)
    const normContradiction = normalizeTrizMatchText(contradictionTitle)
    const alignedByPosition =
      normDecision && normContradiction && (normDecision.includes(normContradiction) || normContradiction.includes(normDecision))
    if (alignedByPosition) continue
    if (!matchesAnyTitle(decisionTradeoff)) {
      reasons.push('decision_tradeoffs_not_aligned_with_triz')
      break
    }
  }

  return reasons
}

const isExecutionReportUsable = (report) => {
  if (!report || typeof report !== 'object') return false
  const priorities = Array.isArray(report.priorities) ? report.priorities : []
  const roadmapPhases = Array.isArray(report.roadmap_phases) ? report.roadmap_phases : []
  const actionPlan = Array.isArray(report.action_plan) ? report.action_plan : []
  const decisions = Array.isArray(report.decisions) ? report.decisions : []
  const validationLoop = Array.isArray(report.validation_loop) ? report.validation_loop : []
  const hasMeaningfulItem = (items, primaryKeys) =>
    items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        primaryKeys.some((key) => normalizeExecutionText(item[key]).length > 0)
    )
  const sectionsWithMeaningfulContent = [
    hasMeaningfulItem(priorities, ['title', 'why_it_matters', 'risk_of_ignoring']),
    roadmapPhases.some(
      (phase) =>
        phase &&
        typeof phase === 'object' &&
        (
          normalizeExecutionText(phase.phase_title || phase.title).length > 0 ||
          normalizeExecutionText(
            phase.why_this_phase_matters ||
              phase.key_risk_or_tradeoff ||
              phase.validation_or_test ||
              phase.decision_unlocked ||
              phase.narrative
          ).length > 0 ||
          (
            Array.isArray(phase.concrete_actions) &&
            phase.concrete_actions.some((action) => normalizeExecutionText(action?.text || action).length > 0)
          ) ||
          (
            Array.isArray(phase.actions) &&
            phase.actions.some((action) => normalizeExecutionText(action?.text || action).length > 0)
          )
        )
    ),
    hasMeaningfulItem(actionPlan, ['step', 'details', 'done_when']),
    hasMeaningfulItem(decisions, ['tradeoff', 'option_a', 'option_b']),
    hasMeaningfulItem(validationLoop, ['check', 'how_to_check', 'positive_result_means', 'negative_result_means']),
  ].filter(Boolean).length
  return sectionsWithMeaningfulContent > 0
}

const getExecutionReportPersistableStats = (report) => {
  if (!report || typeof report !== 'object') {
    return {
      hasGoal: false,
      hasCoverageSummary: false,
      sectionsWithMeaningfulContent: 0,
      persistable: false,
    }
  }
  const priorities = Array.isArray(report.priorities) ? report.priorities : []
  const roadmapPhases = Array.isArray(report.roadmap_phases) ? report.roadmap_phases : []
  const actionPlan = Array.isArray(report.action_plan) ? report.action_plan : []
  const decisions = Array.isArray(report.decisions) ? report.decisions : []
  const validationLoop = Array.isArray(report.validation_loop) ? report.validation_loop : []
  const hasMeaningfulItem = (items, primaryKeys) =>
    items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        primaryKeys.some((key) => normalizeExecutionText(item[key]).length > 0)
    )
  const sectionsWithMeaningfulContent = [
    hasMeaningfulItem(priorities, ['title', 'why_it_matters', 'risk_of_ignoring']),
    roadmapPhases.some(
      (phase) =>
        phase &&
        typeof phase === 'object' &&
        (
          normalizeExecutionText(phase.phase_title || phase.title).length > 0 ||
          normalizeExecutionText(
            phase.why_this_phase_matters ||
              phase.key_risk_or_tradeoff ||
              phase.validation_or_test ||
              phase.decision_unlocked ||
              phase.narrative
          ).length > 0 ||
          (
            Array.isArray(phase.concrete_actions) &&
            phase.concrete_actions.some((action) => normalizeExecutionText(action?.text || action).length > 0)
          ) ||
          (
            Array.isArray(phase.actions) &&
            phase.actions.some((action) => normalizeExecutionText(action?.text || action).length > 0)
          )
        )
    ),
    hasMeaningfulItem(actionPlan, ['step', 'details', 'done_when']),
    hasMeaningfulItem(decisions, ['tradeoff', 'option_a', 'option_b']),
    hasMeaningfulItem(validationLoop, ['check', 'how_to_check', 'positive_result_means', 'negative_result_means']),
  ].filter(Boolean).length
  const hasGoal = normalizeExecutionText(report.goal).length > 0
  const hasCoverageSummary = normalizeExecutionText(report.map_context?.coverage_summary).length > 0
  const hasHeadline = normalizeExecutionText(report.headline).length > 0
  return {
    hasHeadline,
    hasGoal,
    hasCoverageSummary,
    sectionsWithMeaningfulContent,
    persistable: hasGoal && hasCoverageSummary && sectionsWithMeaningfulContent >= 2,
  }
}

const countDecisionOptions = (report) => {
  const decisions = Array.isArray(report?.decisions) ? report.decisions : []
  return {
    optionA: decisions.filter((item) => normalizeExecutionText(item?.option_a)).length,
    optionB: decisions.filter((item) => normalizeExecutionText(item?.option_b)).length,
    consequenceA: decisions.filter((item) => normalizeExecutionText(item?.consequence_a)).length,
    consequenceB: decisions.filter((item) => normalizeExecutionText(item?.consequence_b)).length,
  }
}

const mergeDecisionConsequences = (baseReport, enrichedDecisions, reportLang = 'en') => {
  const report = normalizeExecutionReport(baseReport, reportLang)
  const normalizedEnriched = normalizeExecutionList(
    enrichedDecisions,
    (item) => {
      if (typeof item === 'string') return null
      if (!item || typeof item !== 'object') return null
      const tradeoff = normalizeExecutionText(item.tradeoff || item.decyzja || item.title)
      const consequenceA = sanitizeExecutionDetailText(
        item.consequence_a || item.konsekwencja_a
      )
      const consequenceB = sanitizeExecutionDetailText(
        item.consequence_b || item.konsekwencja_b
      )
      if (!tradeoff) return null
      if (!consequenceA && !consequenceB) return null
      return {
        tradeoff,
        consequence_a: consequenceA,
        consequence_b: consequenceB,
      }
    },
    8
  )
  if (!normalizedEnriched.length) return report

  const byTradeoff = new Map(
    normalizedEnriched.map((item) => [normalizeTrizMatchText(item.tradeoff), item])
  )
  const mergedDecisions = (Array.isArray(report.decisions) ? report.decisions : []).map((item, index) => {
    const directMatch = normalizedEnriched[index]
    const mappedMatch = byTradeoff.get(normalizeTrizMatchText(item?.tradeoff))
    const match =
      mappedMatch && normalizeTrizMatchText(mappedMatch.tradeoff) === normalizeTrizMatchText(item?.tradeoff)
        ? mappedMatch
        : directMatch && normalizeTrizMatchText(directMatch.tradeoff) === normalizeTrizMatchText(item?.tradeoff)
          ? directMatch
          : null
    if (!match) return item
    return {
      ...item,
      consequence_a:
        sanitizeExecutionDetailText(match.consequence_a) ||
        sanitizeExecutionDetailText(item?.consequence_a),
      consequence_b:
        sanitizeExecutionDetailText(match.consequence_b) ||
        sanitizeExecutionDetailText(item?.consequence_b),
    }
  })

  return normalizeExecutionReport({
    ...report,
    decisions: mergedDecisions,
  })
}

const validateAndNormalizeReport = (payload) => {
  const empty = {
    lang: null,
    summary: { headline: '', narrative: '', today: '', change: '', product: '' },
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
    execution_report: normalizeExecutionReport(null, 'en'),
    source_snapshot: null,
  }
  if (!payload || typeof payload !== 'object') return { ...empty }
  const value = payload
  const lang = normalizeReportLang(value.lang)
  let summary =
    value.summary && typeof value.summary === 'object'
      ? value.summary
      : typeof value.headline === 'string' ||
          typeof value.narrative === 'string' ||
          typeof value.today === 'string' ||
          typeof value.change === 'string' ||
          typeof value.product === 'string'
        ? {
            headline: value.headline,
            narrative: value.narrative,
            today: value.today,
            change: value.change,
            product: value.product,
          }
      : typeof value.today === 'string' ||
          typeof value.change === 'string' ||
          typeof value.product === 'string'
        ? { today: value.today, change: value.change, product: value.product }
        : empty.summary
  if (value.summary && typeof value.summary === 'object') {
    const s = value.summary
    summary = {
      headline: typeof s.headline === 'string' ? s.headline : String(s.headline ?? ''),
      narrative: typeof s.narrative === 'string' ? s.narrative : String(s.narrative ?? ''),
      today: typeof s.today === 'string' ? s.today : String(s.today ?? ''),
      change: typeof s.change === 'string' ? s.change : String(s.change ?? ''),
      product: typeof s.product === 'string' ? s.product : String(s.product ?? ''),
    }
  } else if (
    typeof value.headline === 'string' ||
    typeof value.narrative === 'string' ||
    typeof value.today === 'string' ||
    typeof value.change === 'string' ||
    typeof value.product === 'string'
  ) {
    summary = {
      headline: typeof value.headline === 'string' ? value.headline : '',
      narrative: typeof value.narrative === 'string' ? value.narrative : '',
      today: typeof value.today === 'string' ? value.today : '',
      change: typeof value.change === 'string' ? value.change : '',
      product: typeof value.product === 'string' ? value.product : '',
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
  const execution_report = normalizeExecutionReport(value.execution_report, lang || 'pl')
  return {
    lang,
    summary,
    ideas,
    items,
    recommendations,
    triz,
    execution_report,
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
  if (contradictions.length > MAX_TRIZ_CONTRADICTIONS) errors.push('triz_too_many_contradictions')
  contradictions.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`triz_invalid_item:${index}`)
      return
    }
    if (!String(item.title || '').trim()) errors.push(`triz_missing_title:${index}`)
    const hasNewShape = Boolean(String(item.explanation || '').trim())
    const hasOldShape = Boolean(
      String(item.description || '').trim() &&
        String(item.improving || '').trim() &&
        String(item.worsening || '').trim()
    )
    if (!hasNewShape && !hasOldShape) errors.push(`triz_missing_content:${index}`)
    if (item.solution_directions != null && !Array.isArray(item.solution_directions)) {
      errors.push(`triz_solution_directions_not_array:${index}`)
    }
    if (item.approaches != null && !Array.isArray(item.approaches)) {
      errors.push(`triz_approaches_not_array:${index}`)
    }
    if (item.reflections != null && !Array.isArray(item.reflections)) {
      errors.push(`triz_reflections_not_array:${index}`)
    }
    if (item.principles != null && !Array.isArray(item.principles)) {
      errors.push(`triz_principles_not_array:${index}`)
    }
    if (item.solutions != null && !Array.isArray(item.solutions)) {
      errors.push(`triz_solutions_not_array:${index}`)
    }
  })
  return { ok: errors.length === 0, errors }
}

const coerceTrizToValid = (triz) => {
  const normalized = normalizeTriz(triz)
  if (!normalized || typeof normalized !== 'object') return normalized
  const contradictions = Array.isArray(normalized.contradictions) ? normalized.contradictions : []
  const filtered = contradictions
    .filter((item) => {
      if (!item || typeof item !== 'object') return false
      if (!String(item.title || '').trim()) return false
      const hasNewShape = Boolean(String(item.explanation || '').trim())
      const hasOldShape = Boolean(
        String(item.description || '').trim() &&
          String(item.improving || '').trim() &&
          String(item.worsening || '').trim()
      )
      return hasNewShape || hasOldShape
    })
    .slice(0, MAX_TRIZ_CONTRADICTIONS)
  return { ...normalized, contradictions: filtered }
}

const ensureExecutionNextSessionFocus = (report, reportLang) => {
  if (!report || typeof report !== 'object') return report
  const existing = normalizeExecutionText(report.next_session_focus)
  if (existing) return report
  const firstAction = Array.isArray(report.action_plan)
    ? normalizeExecutionText(report.action_plan?.[0]?.step || report.action_plan?.[0]?.title)
    : ''
  const firstPriority = Array.isArray(report.priorities)
    ? normalizeExecutionText(report.priorities?.[0]?.title)
    : ''
  const anchor = firstAction || firstPriority
  const fallback = reportLang === 'en'
    ? anchor
      ? `Focus next on: ${anchor}.`
      : 'Focus next on one priority and validate it with a small, concrete test.'
    : anchor
      ? `Najbliższy fokus: ${anchor}.`
      : 'Najbliższy fokus: wybierz 1 priorytet i sprawdź go małym, konkretnym testem.'
  return { ...report, next_session_focus: fallback }
}

const validateExecutionReport = (report) => {
  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['execution_report_missing'] }
  }
  const errors = []
  if (!String(report.headline || '').trim()) errors.push('execution_report_headline_empty')
  if (!String(report.goal || '').trim()) errors.push('execution_report_goal_empty')
  if (!String(report.map_context?.coverage_summary || '').trim()) {
    errors.push('execution_report_map_context_empty')
  }
  if (!Array.isArray(report.priorities)) errors.push('execution_report_priorities_not_array')
  if (!Array.isArray(report.action_plan)) errors.push('execution_report_action_plan_not_array')
  if (!Array.isArray(report.decisions)) errors.push('execution_report_decisions_not_array')
  if (!Array.isArray(report.validation_loop)) errors.push('execution_report_validation_not_array')
  const quality = assessExecutionReportQuality(report)
  if (quality.sectionsWithContent === 0) errors.push('execution_report_no_structured_content')
  if (quality.sectionsWithContent < 2) errors.push('execution_report_below_lean_threshold')
  if (Array.isArray(report.priorities) && report.priorities.length > 5) errors.push('execution_report_priorities_too_many')
  if (Array.isArray(report.action_plan) && report.action_plan.length > MAX_EXEC_ACTION_PLAN_ITEMS) {
    errors.push('execution_report_action_plan_too_many')
  }
  if (Array.isArray(report.decisions) && report.decisions.length > 5) errors.push('execution_report_decisions_too_many')
  if (Array.isArray(report.validation_loop) && report.validation_loop.length > 5) errors.push('execution_report_validation_too_many')
  return { ok: errors.length === 0, errors }
}

const validateExecutionDecisionsOnly = (report, options = {}) => {
  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['execution_report_missing'] }
  }
  const errors = []
  if (!Array.isArray(report.decisions)) errors.push('execution_report_decisions_not_array')
  const decisions = Array.isArray(report.decisions) ? report.decisions : []
  const contradictionsCount = Number(options?.contradictionsCount ?? 0) || 0
  if (contradictionsCount > 0) {
	    if (decisions.length !== contradictionsCount) errors.push('execution_report_decisions_count_mismatch_triz')
	    const indices = decisions
	      .map((d) => (Number.isFinite(Number(d?.contradiction_index)) ? Math.floor(Number(d.contradiction_index)) : null))
	      .filter((x) => typeof x === 'number')
	    const unique = new Set(indices)
    if (indices.length !== decisions.length) errors.push('execution_report_decisions_missing_contradiction_index')
    if (unique.size !== indices.length) errors.push('execution_report_decisions_duplicate_contradiction_index')
    const invalid = indices.some((idx) => idx < 0 || idx >= contradictionsCount)
    if (invalid) errors.push('execution_report_decisions_invalid_contradiction_index')
    for (let idx = 0; idx < contradictionsCount; idx += 1) {
      if (!unique.has(idx)) {
        errors.push('execution_report_decisions_contradiction_not_covered')
        break
      }
    }
  }
  const complete = decisions.filter((item) => normalizeExecutionText(item?.tradeoff).length > 0).length
  if (complete < 1) errors.push('execution_report_decisions_empty')
  if (decisions.length > 5) errors.push('execution_report_decisions_too_many')
  const tooShort = decisions.filter((item) => {
    const t = normalizeExecutionText(item?.tradeoff)
    return t.length > 0 && t.length < 16
  }).length
  if (tooShort >= Math.ceil(Math.max(1, decisions.length) * 0.6)) {
    errors.push('execution_report_decisions_too_short')
  }
  return { ok: errors.length === 0, errors }
}

const validateExecutionPlanOnly = (report) => {
  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['execution_report_missing'] }
  }
  const errors = []
  if (!Array.isArray(report.priorities)) errors.push('execution_report_priorities_not_array')
  if (!Array.isArray(report.action_plan)) errors.push('execution_report_action_plan_not_array')
  if (!Array.isArray(report.validation_loop)) errors.push('execution_report_validation_not_array')
  const priorities = Array.isArray(report.priorities) ? report.priorities : []
  const roadmapPhases = Array.isArray(report.roadmap_phases)
    ? report.roadmap_phases
    : Array.isArray(report.roadmapPhases)
      ? report.roadmapPhases
      : []
  const actionPlan = Array.isArray(report.action_plan) ? report.action_plan : []
  const validationLoop = Array.isArray(report.validation_loop) ? report.validation_loop : []
  const meaningfulPriorities = priorities.filter((item) => normalizeExecutionText(item?.title).length > 0).length
	  const meaningfulRoadmap = roadmapPhases.filter((phase) => {
	    if (!phase || typeof phase !== 'object') return false
    const titleOk = normalizeExecutionText(phase?.phase_title || phase?.title).length > 0
    const narrativeOk = normalizeExecutionText(
      phase?.why_this_phase_matters ||
        phase?.key_risk_or_tradeoff ||
        phase?.validation_or_test ||
        phase?.decision_unlocked ||
        phase?.narrative ||
        phase?.why ||
        phase?.risks_reduced ||
        phase?.exit_criteria
    ).length > 0
    const actions = Array.isArray(phase?.concrete_actions)
      ? phase.concrete_actions
      : Array.isArray(phase?.actions)
        ? phase.actions
        : []
    const actionsOk = actions.some((a) => normalizeExecutionText(a?.text || a).length > 0)
	    return titleOk && (narrativeOk || actionsOk)
	  }).length
  const meaningfulActions =
    actionPlan.filter((item) => normalizeExecutionText(item?.step || item?.title).length > 0).length ||
    meaningfulRoadmap
  const meaningfulValidation = validationLoop.filter((item) => normalizeExecutionText(item?.check).length > 0).length
  const sectionsWithContent = [meaningfulPriorities > 0, meaningfulActions > 0, meaningfulValidation > 0, normalizeExecutionText(report.next_session_focus).length > 0].filter(Boolean).length
  if (sectionsWithContent < 2) errors.push('execution_report_plan_below_threshold')
  if (priorities.length > 5) errors.push('execution_report_priorities_too_many')
  if (actionPlan.length > MAX_EXEC_ACTION_PLAN_ITEMS) errors.push('execution_report_action_plan_too_many')
  if (validationLoop.length > 5) errors.push('execution_report_validation_too_many')
  return { ok: errors.length === 0, errors }
}

export const isReportGenerated = (summaryJson) => {
  if (!summaryJson || typeof summaryJson !== 'object') return false
  const normalized = validateAndNormalizeReport(summaryJson)
  const summary = normalized.summary || {}
  const hasSummary =
    Boolean(String(summary.headline || '').trim()) ||
    Boolean(String(summary.narrative || '').trim()) ||
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

export const isFullReportGenerated = (summaryJson) => {
  if (!summaryJson || typeof summaryJson !== 'object') return false
  const normalized = validateAndNormalizeReport(summaryJson)
  const summary = normalized.summary || {}
  const hasSummary =
    Boolean(String(summary.headline || '').trim()) && Boolean(String(summary.narrative || '').trim()) ||
    Boolean(String(summary.today || '').trim()) ||
    Boolean(String(summary.change || '').trim()) ||
    Boolean(String(summary.product || '').trim())
  const recs = normalized.recommendations || {}
  const hasRecs =
    Array.isArray(recs.based_on_user_ideas) && recs.based_on_user_ideas.length > 0 &&
    Array.isArray(recs.morphological) && recs.morphological.length > 0 &&
    Array.isArray(recs.market_trends) && recs.market_trends.length > 0
  const hasTriz =
    Boolean(String(normalized.triz?.section_title || '').trim()) ||
    Boolean(String(normalized.triz?.section_intro || '').trim()) ||
    (Array.isArray(normalized.triz?.contradictions) && normalized.triz.contradictions.length > 0)
  return hasSummary && hasRecs && hasTriz
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
  const headlineLen = typeof summary?.headline === 'string' ? summary.headline.length : 0
  const narrativeLen = typeof summary?.narrative === 'string' ? summary.narrative.length : 0
  const todayLen = typeof summary?.today === 'string' ? summary.today.length : 0
  const changeLen = typeof summary?.change === 'string' ? summary.change.length : 0
  const productLen = typeof summary?.product === 'string' ? summary.product.length : 0
  console.log(
    `[report:update][step3] ${label} summary lengths: headline=${headlineLen} narrative=${narrativeLen} today=${todayLen} change=${changeLen} product=${productLen}`
  )
}

const logSummaryShape = (label, summary) => {
  if (!summary || typeof summary !== 'object') {
    console.log(`[report:update][step3] ${label} summary shape: missing`)
    return
  }
  console.log(`[report:update][step3] ${label} summary shape`, {
    hasHeadline: Boolean(typeof summary.headline === 'string' && summary.headline.trim()),
    hasNarrative: Boolean(typeof summary.narrative === 'string' && summary.narrative.trim()),
    hasToday: Boolean(typeof summary.today === 'string' && summary.today.trim()),
    hasChange: Boolean(typeof summary.change === 'string' && summary.change.trim()),
    hasProduct: Boolean(typeof summary.product === 'string' && summary.product.trim()),
  })
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

const logExecutionReportShape = (label, report) => {
  if (!report || typeof report !== 'object') {
    console.log(`[report:update][step3] ${label} action-plan shape: missing`)
    return
  }
  console.log(`[report:update][step3] ${label} action-plan shape`, {
    hasHeadline: Boolean(typeof report.headline === 'string' && report.headline.trim()),
    hasGoal: Boolean(typeof report.goal === 'string' && report.goal.trim()),
    hasCoverageSummary: Boolean(
      typeof report.map_context?.coverage_summary === 'string' &&
        report.map_context.coverage_summary.trim()
    ),
	    priorities: Array.isArray(report.priorities) ? report.priorities.length : null,
	    roadmapPhases: Array.isArray(report.roadmap_phases) ? report.roadmap_phases.length : null,
	    actionPlan: Array.isArray(report.action_plan) ? report.action_plan.length : null,
    decisions: Array.isArray(report.decisions) ? report.decisions.length : null,
    validationLoop: Array.isArray(report.validation_loop) ? report.validation_loop.length : null,
    hasNextSessionFocus: Boolean(
      typeof report.next_session_focus === 'string' && report.next_session_focus.trim()
    ),
    supportingItems: Array.isArray(report.supporting_items) ? report.supporting_items.length : null,
  })
}

const getActionPlanDiagnosticShape = (report) => {
  if (!report || typeof report !== 'object') {
    return {
      stage: null,
      prioritiesLen: null,
      roadmapPhasesLen: null,
      actionPlanLen: null,
      validationLoopLen: null,
      decisionsLen: null,
      hasGoal: false,
      hasCoverageSummary: false,
      hasNextSessionFocus: false,
      sampleRoadmapPhaseTitle: null,
      sampleRoadmapPhaseKeys: null,
      sampleActionPlanStep: null,
      sampleActionPlanKeys: null,
      hasTechnologyOptions: false,
      hasDoneWhen: false,
    }
  }
  const roadmapPhases = Array.isArray(report.roadmap_phases)
    ? report.roadmap_phases
    : Array.isArray(report.roadmapPhases)
      ? report.roadmapPhases
      : []
  const actionPlan = Array.isArray(report.action_plan)
    ? report.action_plan
    : Array.isArray(report.actionPlan)
      ? report.actionPlan
      : []
  const priorities = Array.isArray(report.priorities) ? report.priorities : []
  const validationLoop = Array.isArray(report.validation_loop)
    ? report.validation_loop
    : Array.isArray(report.validationLoop)
      ? report.validationLoop
      : []
  const decisions = Array.isArray(report.decisions) ? report.decisions : []
  const sampleRoadmapPhase = roadmapPhases.find((item) => item && typeof item === 'object') || null
  const sampleActionPlan = actionPlan.find((item) => item && typeof item === 'object') || null
  return {
    stage: typeof report.stage === 'string' ? report.stage : null,
    prioritiesLen: priorities.length,
    roadmapPhasesLen: roadmapPhases.length,
    actionPlanLen: actionPlan.length,
    validationLoopLen: validationLoop.length,
    decisionsLen: decisions.length,
    hasGoal: Boolean(normalizeExecutionText(report.goal || report.objective || report.primary_goal)),
    hasCoverageSummary: Boolean(
      normalizeExecutionText(
        report.map_context?.coverage_summary ||
          report.map_context?.coverageSummary ||
          report.map_context?.summary
      )
    ),
    hasNextSessionFocus: Boolean(normalizeExecutionText(report.next_session_focus || report.nextSessionFocus)),
    sampleRoadmapPhaseTitle: sampleRoadmapPhase
      ? normalizeExecutionText(sampleRoadmapPhase.phase_title || sampleRoadmapPhase.title)
      : null,
    sampleRoadmapPhaseKeys: sampleRoadmapPhase ? Object.keys(sampleRoadmapPhase) : null,
    sampleActionPlanStep: sampleActionPlan
      ? normalizeExecutionText(sampleActionPlan.step || sampleActionPlan.title)
      : null,
    sampleActionPlanKeys: sampleActionPlan ? Object.keys(sampleActionPlan) : null,
    hasTechnologyOptions: actionPlan.some(
      (item) => Array.isArray(item?.technology_options) && item.technology_options.length > 0
    ),
    hasDoneWhen: actionPlan.some((item) => Boolean(normalizeExecutionText(item?.done_when || item?.doneWhen))),
  }
}

const logActionPlanDiagnosticShape = (label, report, extra = {}) => {
  console.log(`[REPORT FINALIZE DEBUG][backend][shape][${label}]`, {
    ...extra,
    ...getActionPlanDiagnosticShape(report),
  })
}

const getActionPlanPersistenceShape = (report, summaryJson = null) => ({
  ...getActionPlanDiagnosticShape(report),
  summaryJsonKeys: summaryJson && typeof summaryJson === 'object' ? Object.keys(summaryJson) : null,
})

const getFinalizeTraceShape = (report, meta = {}) => {
  const shape = getActionPlanDiagnosticShape(report)
  const roadmapPhases = report && typeof report === 'object'
    ? Array.isArray(report.roadmap_phases)
      ? report.roadmap_phases
      : Array.isArray(report.roadmapPhases)
        ? report.roadmapPhases
        : []
    : []
  return {
    checkpoint: meta.checkpoint ?? null,
    requestId: meta.requestId ?? null,
    sessionId: meta.sessionId ?? null,
    stage: shape.stage,
    roadmapPhasesLen: shape.roadmapPhasesLen,
    actionPlanLen: shape.actionPlanLen,
    validationLoopLen: shape.validationLoopLen,
    prioritiesLen: shape.prioritiesLen,
    decisionsLen: shape.decisionsLen,
    hasTechnologyOptions: shape.hasTechnologyOptions,
    hasDoneWhen: shape.hasDoneWhen,
    hasRoadmapPhaseNarrative: roadmapPhases.some((phase) =>
      Boolean(
        normalizeExecutionText(
          phase?.why_this_phase_matters ||
            phase?.key_risk_or_tradeoff ||
            phase?.validation_or_test ||
            phase?.decision_unlocked ||
            phase?.narrative ||
            phase?.why ||
            phase?.risks_reduced ||
            phase?.exit_criteria
        )
      )
    ),
    sampleRoadmapPhaseTitle: shape.sampleRoadmapPhaseTitle,
    sampleRoadmapPhaseKeys: shape.sampleRoadmapPhaseKeys,
    sampleActionPlanStep: shape.sampleActionPlanStep,
    sampleActionPlanKeys: shape.sampleActionPlanKeys,
    sourceLabel: meta.sourceLabel ?? null,
  }
}

const logFinalizeTrace = (checkpoint, report, meta = {}) => {
  console.log('[REPORT FINALIZE TRACE]', getFinalizeTraceShape(report, { ...meta, checkpoint }))
}

const logFinalizeAssignment = ({ requestId, sessionId, assignedFrom, reason, previousReport, nextReport }) => {
  console.log('[REPORT FINALIZE TRACE][assignment]', {
    checkpoint: 'execution_report_assignment',
    requestId,
    sessionId,
    assignedFrom,
    reason,
    previousShape: getFinalizeTraceShape(previousReport, { requestId, sessionId, sourceLabel: 'previous' }),
    nextShape: getFinalizeTraceShape(nextReport, { requestId, sessionId, sourceLabel: assignedFrom }),
  })
}

const logExecutionReportSamples = (label, report) => {
  if (!report || typeof report !== 'object') {
    console.log(`[report:update][step3] ${label} action-plan samples: missing`)
    return
  }
  console.log(`[report:update][step3] ${label} action-plan samples`, {
	    priority0: Array.isArray(report.priorities) ? report.priorities[0] ?? null : null,
	    roadmapPhase0: Array.isArray(report.roadmap_phases) ? report.roadmap_phases[0] ?? null : null,
	    action0: Array.isArray(report.action_plan) ? report.action_plan[0] ?? null : null,
    decision0: Array.isArray(report.decisions) ? report.decisions[0] ?? null : null,
    validation0: Array.isArray(report.validation_loop) ? report.validation_loop[0] ?? null : null,
  })
}

const logExecutionDecisionCoverage = (label, report) => {
  const decisions = Array.isArray(report?.decisions) ? report.decisions : []
  const withTradeoff = decisions.filter((item) => normalizeExecutionText(item?.tradeoff)).length
  const withOptionA = decisions.filter((item) => normalizeExecutionText(item?.option_a)).length
  const withOptionB = decisions.filter((item) => normalizeExecutionText(item?.option_b)).length
  const withConsequenceA = decisions.filter((item) => normalizeExecutionText(item?.consequence_a)).length
  const withConsequenceB = decisions.filter((item) => normalizeExecutionText(item?.consequence_b)).length
  console.log(`[report:update][step3] ${label} decisions coverage`, {
    total: decisions.length,
    withTradeoff,
    withOptionA,
    withOptionB,
    withConsequenceA,
    withConsequenceB,
  })
}

const validateSummary = (summary, itemsCount, lang = 'pl', options = {}) => {
  const errors = []
  const requireNarrative = options?.requireNarrative === true
  if (!summary || typeof summary !== 'object') {
    return { ok: false, errors: ['summary_missing'] }
  }
  const headline = typeof summary.headline === 'string' ? summary.headline.trim() : ''
  const narrative = typeof summary.narrative === 'string' ? summary.narrative.trim() : ''
  const today = typeof summary.today === 'string' ? summary.today.trim() : ''
  const change = typeof summary.change === 'string' ? summary.change.trim() : ''
  const product = typeof summary.product === 'string' ? summary.product.trim() : ''
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
          /nie można wygenerować/i,
        ]
  const interpretivePatterns =
    lang === 'en'
      ? [/\btrade[- ]?off\b/i, /\btension\b/i, /\bpotential\b/i, /\bdirection\b/i]
      : [/\bkompromis\b/i, /\bnapięci/i, /\bpotencjał/i, /\bkierunek\b/i, /\bsprzeczno/i]
  if (headline || narrative || requireNarrative) {
    if (!headline) errors.push('summary_headline_empty')
    if (headline && headline.length < 16) errors.push('summary_headline_too_short')
    if (!narrative) errors.push('summary_narrative_empty')
    if (narrative && narrative.length < 180) errors.push('summary_narrative_too_short')
    if (insufficientPatterns.some((pattern) => pattern.test(headline) || pattern.test(narrative))) {
      errors.push('summary_insufficient')
    }
    if (narrative && !interpretivePatterns.some((pattern) => pattern.test(narrative))) {
      errors.push('summary_narrative_not_interpretive')
    }
    return { ok: errors.length === 0, errors }
  }
  if (itemsCount >= 3) {
    if (today.length < 30) errors.push('summary_today_too_short')
    if (change.length < 30) errors.push('summary_change_too_short')
    if (!product) errors.push('summary_product_empty')
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
  const contradictionDescription = String(
    contradiction?.explanation || contradiction?.description || ''
  ).trim()
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
    .grayscale()
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
  const hasSolutions = contradiction.solutions != null
  const hasApproaches = contradiction.approaches != null
  const solutions = Array.isArray(contradiction.solutions)
    ? contradiction.solutions
    : Array.isArray(contradiction.approaches)
      ? contradiction.approaches
      : null
  if ((hasSolutions || hasApproaches) && !solutions) {
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
    const diagnosticsEnabled = req?.headers?.['x-diagnostics'] === '1'
    const requestId =
      req?.headers?.['x-request-id'] ||
      (typeof req?.headers?.get === 'function' ? req.headers.get('x-request-id') : '') ||
      randomUUID()
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
    const executionMode = String(body.execution_mode || body.executionMode || '').trim()
    const responseMeta = {}
    const responseExecution = { planGenerated: false, planSkippedReason: null }
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
    const reportLang = resolveReportLang(normalizedReport.lang, requestedLang, 'pl')
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
    const recordAiUsageBestEffort = async (payload) => {
      try {
        await recordSessionAiUsageEvent(supabaseAdmin, payload)
      } catch (error) {
        logTrizImage('error', 'usage_logging_failed', {
          reportId: reportRes.data.id,
          requestId,
          sourceTask: payload?.sourceTask ?? null,
          message: error?.message ?? 'unknown error',
        })
      }
    }

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
      await recordAiUsageBestEffort({
        sessionId: reportRes.data.session_id ?? sessionId,
        reportId: reportRes.data.id ?? null,
        userId,
        actionKey,
        sourceTask: 'image-generate',
        referenceId: reportRes.data.id ?? null,
        requestId,
        feature: 'image-generate',
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
      if (Array.isArray(contradiction.approaches) && contradiction.approaches[solutionIndex]) {
        contradiction.approaches[solutionIndex] = {
          ...contradiction.approaches[solutionIndex],
          ...(solution.description ? { description: solution.description } : {}),
          ...(prompt ? { sketch_prompt: prompt } : {}),
          image: currentPrimaryImage || nextImage,
          images: mergedImages,
        }
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
    if (Array.isArray(contradiction.approaches) && contradiction.approaches[solutionIndex]) {
      contradiction.approaches[solutionIndex] = {
        ...contradiction.approaches[solutionIndex],
        ...(solution.description ? { description: solution.description } : {}),
        ...(solution.sketch_prompt ? { sketch_prompt: solution.sketch_prompt } : {}),
        image: nextPrimaryImage,
        images: remainingImages,
      }
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
    const diagnosticsEnabled = req?.headers?.['x-diagnostics'] === '1'
    const actionPlanDiagnosticsEnabled = isEnvEnabled(process.env.ACTION_PLAN_DIAGNOSTICS)
    const disableActionPlanRewrite = isEnvEnabled(process.env.DISABLE_ACTION_PLAN_REWRITE)
    const disableExecPlanFallback = isEnvEnabled(process.env.DISABLE_EXEC_PLAN_FALLBACK)
    const requestId =
      req?.headers?.['x-request-id'] ||
      (typeof req?.headers?.get === 'function' ? req.headers.get('x-request-id') : '') ||
      randomUUID()
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
      const executionMode = String(body.execution_mode || body.executionMode || '').trim()
      const responseMeta = {}
      const responseExecution = { planGenerated: false, planSkippedReason: null }

	      if (executionMode === 'plan_from_decisions_only' || executionMode === 'plan_from_decisions') {
	        const incomingExecutionReport =
	          body.execution_report && typeof body.execution_report === 'object'
	            ? normalizeExecutionReport(body.execution_report, requestedLang || 'en')
	            : null
        const incomingDecisions = Array.isArray(incomingExecutionReport?.decisions)
          ? incomingExecutionReport.decisions
          : []
        const incomingSelectedOptions = incomingDecisions.map((d) =>
          d?.selected_option === 'a' || d?.selected_option === 'b' ? d.selected_option : null
        )
        const incomingTriz = body.triz && typeof body.triz === 'object' ? normalizeTriz(body.triz) : null
        const incomingContradictions = Array.isArray(incomingTriz?.contradictions)
          ? incomingTriz.contradictions
          : []
        console.log('[REPORT FINALIZE DEBUG][backend][entry]', {
          requestId,
          method: req?.method ?? null,
          sessionId,
          execution_mode: executionMode,
          lang: requestedLang ?? null,
          diagnosticsEnabled,
          hasIncomingExecutionReport: Boolean(incomingExecutionReport),
          incomingExecutionReportStage: incomingExecutionReport?.stage ?? null,
          incomingDecisionsCount: incomingDecisions.length,
          incomingSelectedOptions,
          hasIncomingTriz: Boolean(incomingTriz),
          incomingTrizContradictionsCount: incomingContradictions.length,
          incomingTrizSelectedApproachIndices: incomingContradictions.map((c, idx) => ({
            contradictionIndex: idx,
            selected_approach_indices: Array.isArray(c?.selected_approach_indices)
              ? c.selected_approach_indices
              : c?.selected_approach_index != null
                ? [c.selected_approach_index]
                : [],
          })),
        })
      }
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
    if (executionMode === 'triz_select_approach') {
      const selection = body.triz_selection && typeof body.triz_selection === 'object'
        ? body.triz_selection
        : null
      const contradictionIndexRaw =
        typeof selection?.contradiction_index === 'number'
          ? selection.contradiction_index
          : typeof selection?.contradiction_index === 'string'
            ? Number(selection.contradiction_index)
            : NaN
      const approachIndexRaw =
        typeof selection?.approach_index === 'number'
          ? selection.approach_index
          : typeof selection?.approach_index === 'string'
            ? Number(selection.approach_index)
            : NaN
      const contradictionIndex =
        Number.isFinite(contradictionIndexRaw) ? Math.max(0, Math.floor(contradictionIndexRaw)) : null
      const approachIndex =
        Number.isFinite(approachIndexRaw) ? Math.max(0, Math.floor(approachIndexRaw)) : null
      const approachTitle =
        typeof selection?.approach_title === 'string' && selection.approach_title.trim()
          ? selection.approach_title.trim()
          : null
      const selectionMode = String(selection?.mode || '').trim()
      if (contradictionIndex == null || approachIndex == null) {
        sendJson(res, 400, { ok: false, error: 'INVALID_TRIZ_SELECTION' })
        return
      }
      const normalizedReport = validateAndNormalizeReport(reportRes.data.summary_json ?? null)
      const normalizedTriz = normalizeTriz(normalizedReport.triz)
      const contradiction = normalizedTriz.contradictions[contradictionIndex]
      if (!contradiction) {
        sendJson(res, 404, { ok: false, error: 'TRIZ_CONTRADICTION_NOT_FOUND' })
        return
      }
      const renderedApproaches =
        Array.isArray(contradiction.approaches) && contradiction.approaches.length
          ? contradiction.approaches
          : contradiction.solutions
      if (!renderedApproaches?.[approachIndex]) {
        sendJson(res, 404, { ok: false, error: 'TRIZ_APPROACH_NOT_FOUND' })
        return
      }
      const currentIndices = Array.isArray(contradiction.selected_approach_indices)
        ? contradiction.selected_approach_indices
            .map((idx) => (typeof idx === 'number' ? idx : Number(idx)))
            .filter((idx) => Number.isFinite(idx))
            .map((idx) => Math.max(0, Math.floor(idx)))
        : []
      const currentLegacyIndex =
        contradiction.selected_approach_index != null ? [Number(contradiction.selected_approach_index)] : []
      const mergedCurrent = Array.from(new Set([...currentIndices, ...currentLegacyIndex].filter((idx) => Number.isFinite(idx))))
      const currentlySelected = mergedCurrent.includes(approachIndex)
      const nextIndices =
        selectionMode === 'toggle'
          ? currentlySelected
            ? mergedCurrent.filter((idx) => idx !== approachIndex)
            : Array.from(new Set([...mergedCurrent, approachIndex]))
          : selectionMode === 'add'
            ? currentlySelected
              ? mergedCurrent
              : Array.from(new Set([...mergedCurrent, approachIndex]))
            : [approachIndex]
      const currentTitles = Array.isArray(contradiction.selected_approach_titles)
        ? contradiction.selected_approach_titles.filter((t) => typeof t === 'string').map((t) => String(t).trim()).filter(Boolean)
        : []
      const legacyTitle =
        typeof contradiction.selected_approach_title === 'string' && contradiction.selected_approach_title.trim()
          ? [contradiction.selected_approach_title.trim()]
          : []
      const mergedTitles = Array.from(new Set([...currentTitles, ...legacyTitle]))
      const nextTitle = approachTitle || renderedApproaches[approachIndex]?.title || null
      const nextTitles =
        selectionMode === 'toggle'
          ? currentlySelected
            ? mergedTitles.filter((t) => t !== nextTitle)
            : Array.from(new Set([...mergedTitles, ...(nextTitle ? [nextTitle] : [])]))
          : selectionMode === 'add'
            ? currentlySelected
              ? mergedTitles
              : Array.from(new Set([...mergedTitles, ...(nextTitle ? [nextTitle] : [])]))
            : nextTitle
              ? [nextTitle]
              : []
      const selectionChanged =
        nextIndices.length !== mergedCurrent.length ||
        nextIndices.some((idx) => !mergedCurrent.includes(idx)) ||
        nextTitles.length !== mergedTitles.length ||
        nextTitles.some((title) => !mergedTitles.includes(title))
      normalizedTriz.contradictions = normalizedTriz.contradictions.map((item, idx) =>
        idx === contradictionIndex
          ? {
              ...item,
              selected_approach_indices: nextIndices,
              selected_approach_titles: nextTitles,
            }
          : item
      )
	      const normalizedExecutionReport = normalizeExecutionReport(
	        normalizedReport.execution_report ?? null,
	        normalizedReport.lang || requestedLang || 'en'
	      )
      const invalidatesPlan = selectionChanged && normalizedExecutionReport?.stage === 'plan_generated'
	      const nextExecutionReport = invalidatesPlan
	        ? normalizeExecutionReport(
	          {
	            ...normalizedExecutionReport,
	            stage: 'awaiting_decisions',
	            priorities: [],
	            action_plan: [],
	            validation_loop: [],
	            next_session_focus: '',
	          },
	          normalizedReport.lang || requestedLang || 'en'
	        )
	        : normalizedExecutionReport
      const nextSummary = sanitizeReportPayload({
        ...normalizedReport,
        triz: normalizedTriz,
        ...(invalidatesPlan ? { execution_report: nextExecutionReport } : {}),
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
        sendJson(res, 500, { ok: false, error: 'REPORT_UPDATE_FAILED' })
        return
      }
      sendJson(res, 200, { ok: true, report: updateRes.data ?? null })
      return
    }
    const shouldChargeForUpdate =
      !skipBilling &&
      executionMode !== 'plan_from_decisions_only' &&
      executionMode !== 'triz_select_approach'
    if (shouldChargeForUpdate) {
      try {
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
    const reportLang = resolveReportLang(existingNormalized.lang, requestedLang, 'pl')
    const llmLanguage = toLlmLanguage(reportLang)
    console.log('[report:update][exec] request', {
      requestId,
      sessionId,
      reportLang,
      executionMode: executionMode || null,
      hasExistingExecutionReport: Boolean(existingNormalized?.execution_report),
    })
    const executionPlanOnly = executionMode === 'plan_from_decisions_only'
	    const executionReportOverride =
	      body.execution_report && typeof body.execution_report === 'object'
	        ? normalizeExecutionReport(body.execution_report, reportLang)
	        : null

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
      execution_report: executionReportOverride || existingNormalized.execution_report,
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

    const recordAiUsageBestEffort = async (payload) => {
      try {
        await recordSessionAiUsageEvent(supabaseAdmin, payload)
        console.log('[report:update][ai-usage] recorded', {
          requestId,
          sourceTask: payload?.sourceTask ?? null,
          sessionId,
          model: payload?.meta?.modelUsed ?? null,
          tokens: payload?.meta?.tokens ?? null,
        })
      } catch (error) {
        console.error('[report:update][ai-usage] failed', {
          requestId,
          sourceTask: payload?.sourceTask ?? null,
          sessionId,
          message: error?.message ?? 'unknown error',
        })
      }
    }

    try {
      const representativeItems = items
        .slice(0, MAX_TRIZ_INPUT_ITEMS)
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
        .slice(0, MAX_TRIZ_INPUT_ITEMS)

      const preprocessInput = JSON.stringify({
        lang: reportLang,
        session_id: sessionId,
        items: representativeItems,
      })
      const trizSupportText = buildTrizSupportText({
        items: representativeItems,
        analysisJson: null,
      })

      let analysisJson = null
      try {
        const preprocessTaskInstructions =
          reportLang === 'en'
            ? 'Return ONLY valid JSON. No markdown. Extract signals from the items. Schema: { "lang":"pl|en","topic":"1-2 sentences","key_themes":["3-6 short noun phrases"],"tensions_or_opportunities":["3-6 short trade-offs/tensions"],"representative_items":[{"quote":"short quote","label":"","question":""}],"user_intent":"optional 1 sentence" }. Prefer concrete, decision-relevant phrasing. Avoid meta text like "not enough data" unless truly necessary. Do NOT include matrix codes A1..C3. Output must be in English.'
            : 'Zwróć WYŁĄCZNIE poprawny JSON. Bez markdown. Wyciągnij sygnały z wpisów. Schemat: { "lang":"pl|en","topic":"1-2 sentences","key_themes":["3-6 krótkich fraz rzeczownikowych"],"tensions_or_opportunities":["3-6 krótkich napięć / kompromisów"],"representative_items":[{"quote":"krótki cytat","label":"","question":""}],"user_intent":"opcjonalnie 1 zdanie" }. Preferuj konkret i decyzyjność. Unikaj meta-tekstu typu "brak danych", chyba że to naprawdę konieczne. Nie używaj kodów A1..C3. Całość po polsku.'
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
          await recordAiUsageBestEffort({
            sessionId: reportRes.data.session_id ?? sessionId,
            reportId: reportRes.data.id ?? null,
            userId,
            actionKey: reportActionKey,
            sourceTask: 'report-preprocess',
            referenceId: reportRes.data.id ?? null,
            requestId,
            feature: 'report-preprocess',
            meta: preprocessResult.meta,
          })
        }
      } catch {
        analysisJson = null
      }
      const themeCount = Array.isArray(analysisJson?.key_themes) ? analysisJson.key_themes.length : 0
      console.log('[report:update][step3] preprocess themes', themeCount)
      const trizSupportCorpus = buildTrizSupportText({
        items: representativeItems,
        analysisJson,
      })

      const summaryNotes =
        reportLang === 'en'
          ? [
              'Always fill summary.headline and summary.narrative.',
              'summary.headline must be one short sentence that captures the main product direction or tension.',
              'summary.narrative must be one coherent paragraph, not a list and not three separate mini-sections.',
              'Interpret the material instead of just summarizing it. Answer: what meaningful product direction emerges from these notes?',
              'The narrative must surface at least one tension, contradiction, or trade-off visible in the material.',
              'Show the potential of the idea and why the direction is promising, then end with one clear final sentence that naturally invites the reader into the next parts of the report or action plan.',
              'Use 1 to 3 markdown bold phrases in summary.narrative. At least one bold phrase is required unless the material is extremely sparse.',
              'Use markdown bold only for the most important tensions, problems, or product directions.',
              'The final sentence should feel like a coherent continuation of the narrative, not a pushy call to action and not a generic closing line.',
              'Avoid dry phrases like "You have X entries", "The project concerns", "There is not enough data" unless absolutely necessary.',
              'Use 2nd person sparingly and naturally; do not address the user in every sentence.',
              'Keep legacy fields summary.today, summary.change, and summary.product present for compatibility, but concise. They are secondary to headline and narrative.',
              'Output must be written in English.',
            ]
          : [
              'Zawsze wypełnij summary.headline i summary.narrative.',
              'summary.headline ma być jednym krótkim zdaniem, które pokazuje główny kierunek produktu albo najważniejsze napięcie.',
              'summary.narrative ma być jednym spójnym akapitem, a nie listą ani trzema osobnymi mini-sekcjami.',
              'Masz interpretować materiał, a nie tylko go streszczać. Odpowiedz na pytanie: jaki sensowny kierunek produktu wyłania się z tych wpisów?',
              'Narrative ma pokazać przynajmniej jedno napięcie, sprzeczność albo trade-off obecny w materiale.',
              'Pokaż potencjał pomysłu i dlaczego ten kierunek jest obiecujący, a na końcu dodaj jedno wyraźne, ale naturalne zdanie, które prowadzi do dalszych sekcji raportu lub planu działania.',
              'Użyj od 1 do 3 markdownowych pogrubień w summary.narrative. Co najmniej jedno pogrubienie jest wymagane, chyba że materiał jest skrajnie ubogi.',
              'Pogrubień używaj oszczędnie i tylko dla najważniejszych napięć, problemów lub kierunków produktu.',
              'Ostatnie zdanie ma być spójnym domknięciem całego akapitu, a nie nachalnym CTA ani generycznym zakończeniem.',
              'Unikaj suchych sformułowań typu "Masz X wpisów", "Projekt dotyczy", "Brak wystarczających danych", chyba że to absolutnie konieczne.',
              'Ogranicz 2. osobę liczby pojedynczej; jeśli się pojawia, niech brzmi naturalnie, a nie w każdym zdaniu.',
              'Zostaw legacy fields summary.today, summary.change i summary.product dla kompatybilności, ale traktuj je jako pola wtórne i krótkie.',
              'Całość musi być napisana po polsku.',
            ]

      const defaultPrompt = JSON.stringify({
        existing_summary: phaseASanitized.summary ?? null,
        analysis_json: analysisJson,
        requirements: {
          output_schema: {
            summary: {
              headline: 'string',
              narrative: 'string',
              today: 'string',
              change: 'string',
              product: 'string',
            },
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
            'The JSON MUST include summary.headline and summary.narrative.',
            'Keep all strings concise. If unsure, return shorter content rather than longer content.',
            'If session data is sparse, create minimal but still concrete items.',
            'Do not output matrix codes A1..C3 anywhere.',
            'Exactly 2 items per group.',
            'Rationale should reference analysis_json briefly; no long quotes.',
            'Prefer a product interpretation over a plain recap.',
            'Keep recommendation title, rationale, and how_to_test concise.',
            'Synthesize from the board data; do not copy entries verbatim.',
            ...summaryNotes,
          ],
        },
        session_items: representativeItems,
      })

      const defaultTaskInstructions =
        reportLang === 'en'
          ? 'Return a single valid JSON object only. No markdown outside values. No text before or after JSON. Keys: summary, recommendations. summary must contain headline and narrative plus legacy today, change, product. Make summary interpretive, concise, product-oriented, and naturally written in English. summary.narrative must include at least one markdown bold phrase and end with a natural sentence that leads into the next sections of the report.'
          : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown poza wartościami pól. Bez tekstu przed lub po JSON. Klucze: summary, recommendations. summary musi zawierać headline i narrative oraz legacy today, change, product. Podsumowanie ma być interpretacyjne, zwięzłe, produktowe i naturalne po polsku. summary.narrative ma zawierać przynajmniej jedno markdownowe pogrubienie i kończyć się naturalnym zdaniem prowadzącym do dalszych sekcji raportu.'

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
                explanation: 'string',
                solution_directions: ['string'],
                approaches: [
                  {
                    title: 'string',
                    description: 'string',
                  },
                ],
                reflections: ['string'],
              },
            ],
          },
          notes: [
            'Return exactly one valid JSON object and nothing else.',
            'The JSON must contain only: section_title, section_intro, contradictions.',
            'No markdown. No prose outside JSON. No commentary before or after JSON. No trailing text.',
            `Return 2 to ${MAX_TRIZ_CONTRADICTIONS} contradictions. Prefer ${PREFERRED_TRIZ_CONTRADICTIONS} strong contradictions.`,
            `Use 4 or ${MAX_TRIZ_CONTRADICTIONS} only when the board clearly contains multiple distinct, decision-relevant trade-offs.`,
            'Do not include minor, weak, redundant, or overlapping contradictions.',
            'Merge similar tensions into one stronger contradiction instead of listing multiple variants of the same trade-off.',
            'Use TRIZ reasoning internally to identify meaningful design contradictions and derive solution directions.',
            'Do NOT mention TRIZ, do NOT include principle names or numbers, and do NOT use academic language.',
            'Write for a product builder making design decisions.',
            'Prefer contradictions that materially affect product direction or design decisions.',
            'Prefer contradictions connected to real constraints, risks, costs, quality, delivery, implementation, usability, or scalability.',
            'Prefer contradictions supported by multiple signals in the board, unless a single signal is unusually strong and decision-relevant.',
            'Prefer practical contradictions that lead to concrete action directions, not merely descriptive observations.',
            'Do not restate the same trade-off in slightly different words.',
            'Translate contradictions into: a clear trade-off title, a simple explanation, solution directions, possible approaches, and reflection prompts.',
            'Detect contradictions not only from explicit opposites, but also from implicit trade-offs across multiple entries.',
            'Prefer concrete product and engineering tensions such as lightweight vs strength or durability, small or portable vs long reach, simple construction vs robustness, material choice conflicts, ambidextrous use vs ergonomic optimization, safety vs effectiveness.',
            'Every contradiction must include: title, explanation, solution_directions, approaches, reflections.',
            'solution_directions, approaches, and reflections must be arrays, but may be empty.',
            'Keep all strings concise, concrete, and action-oriented.',
            'Do not invent contradictions not grounded in the material.',
            reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
          ],
        },
        session_items: representativeItems,
      })

      const buildTrizPromptFromTradeoffs = (tradeoffs) =>
        JSON.stringify({
          analysis_json: analysisJson,
          selected_tradeoffs: Array.isArray(tradeoffs) ? tradeoffs.slice(0, TARGET_TRIZ_CONTRADICTIONS) : [],
          requirements: {
            output_schema: {
              section_title: 'string',
              section_intro: 'string',
              contradictions: [
                {
                  title: 'string',
                  explanation: 'string',
                  solution_directions: ['string'],
                  approaches: [
                    {
                      title: 'string',
                      description: 'string',
                    },
                  ],
                  reflections: ['string'],
                },
              ],
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: section_title, section_intro, contradictions.',
              'No markdown. No prose outside JSON.',
              `Use the provided selected_tradeoffs as anchors. Each contradiction title should closely match a trade-off.`,
              'For each contradiction: provide 2-4 concrete solution_directions and 2-4 approaches with practical titles and descriptions.',
              'Keep reflections short and actionable (2-4).',
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
          session_items: representativeItems.slice(0, 12),
        })

      const trizTaskInstructions =
        reportLang === 'en'
          ? `Return a single valid JSON object only. No markdown. No text before or after JSON. Keys: section_title, section_intro, contradictions. Use TRIZ reasoning internally but do not mention TRIZ in the output. Target exactly ${TARGET_TRIZ_CONTRADICTIONS} strong contradictions when material supports it; otherwise return 2. Return 4+ only for clearly distinct, decision-relevant trade-offs. Merge overlapping tensions instead of repeating them. Each contradiction must contain title and a concrete explanation. solution_directions/approaches/reflections must be arrays (may be empty) but keep them concise. Avoid generic contradictions; ground each in the material. Output must be in English.`
          : `Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucze: section_title, section_intro, contradictions. Użyj TRIZ wewnętrznie do analizy, ale nie wspominaj o TRIZ w wyniku. Celuj w dokładnie ${TARGET_TRIZ_CONTRADICTIONS} mocne kompromisy, jeśli materiał na to pozwala; w przeciwnym razie zwróć 2. Zwracaj 4+ tylko wtedy, gdy materiał zawiera kilka wyraźnych, nieredundantnych i decyzyjnych napięć. Scalaj podobne napięcia zamiast powielać warianty. Każda pozycja musi mieć title i konkretną explanation. solution_directions/approaches/reflections muszą być tablicami (mogą być puste), ale pisz zwięźle. Unikaj generyków; każdą sprzeczność uziem w materiale. Całość po polsku.`

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
          timeoutMs: REPORT_LLM_TIMEOUT_MS,
	          maxOutputTokens: 1800,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })
      console.log('[report:update] itemsCount', itemsFromDb.length)
      let validationErrors = []
      let summaryCandidate = phaseASanitized.summary
      let recommendationsCandidate = normalizeRecommendations(phaseASanitized.recommendations)
      let trizCandidate = normalizeTriz(phaseASanitized.triz)
	      let executionReportCandidate = normalizeExecutionReport(phaseASanitized.execution_report, reportLang)
      let executionReportCandidateSource = 'existing'
      let finalExecutionReportSource = 'unknown'
      let summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length, reportLang, {
        requireNarrative: true,
      })
      let recValidation = validateRecommendations(recommendationsCandidate)
      let trizValidation = validateTriz(trizCandidate)
      let executionReportValidation = validateExecutionReport(executionReportCandidate)
      logSummaryLengths('existing', phaseASanitized.summary)
      console.log('[report:update][step3] existing summary validation', summaryValidation.errors)
      logExecutionReportShape('existing', executionReportCandidate)
      console.log(
        '[report:update][step3] existing action-plan validation',
        executionReportValidation.errors
      )
      console.log('[report:update][exec] stage_start', {
        requestId,
        stage: executionReportCandidate?.stage ?? null,
        decisionsCount: Array.isArray(executionReportCandidate?.decisions)
          ? executionReportCandidate.decisions.length
          : null,
      })

      const applyGenerated = (generated) => {
        if (!generated || typeof generated !== 'object') return
        if (generated.summary && typeof generated.summary === 'object') {
          logSummaryShape('llm_raw', generated.summary)
          logSummaryLengths('llm_raw', generated.summary)
          summaryCandidate = generated.summary
          summaryValidation = validateSummary(summaryCandidate, itemsFromDb.length, reportLang, {
            requireNarrative: true,
          })
          console.log('[report:update][step3] summary validation detail', summaryValidation.errors)
        }
        if (generated.recommendations && typeof generated.recommendations === 'object') {
          recommendationsCandidate = normalizeRecommendations(generated.recommendations)
          recValidation = validateRecommendations(recommendationsCandidate)
        }
      }

      if (!executionPlanOnly) {
        let defaultResult = await runDefault()
        if (defaultResult?.meta) {
          await recordAiUsageBestEffort({
            sessionId: reportRes.data.session_id ?? sessionId,
            reportId: reportRes.data.id ?? null,
            userId,
            actionKey: reportActionKey,
            sourceTask: 'report-summary-recs',
            referenceId: reportRes.data.id ?? null,
            requestId,
            feature: 'report-summary-recs',
            meta: defaultResult.meta,
          })
        } else {
          console.log('[report:update][step3] default_result meta missing')
        }
        if (defaultResult.ok && defaultResult.data) {
          logLlmMeta('default', defaultResult)
          if (defaultResult?.data?.summary) {
            logSummaryShape('default_result', defaultResult.data.summary)
          } else {
            console.log('[report:update][step3] default_result summary missing')
          }
          applyGenerated(defaultResult.data)
          logRecommendationCounts('default', recommendationsCandidate)
          console.log('[report:update][step3] summary validation', summaryValidation.errors)
          console.log('[report:update][step3] validation errors', recValidation.errors)
          if (!recValidation.ok || !summaryValidation.ok) {
            validationErrors = recValidation.errors.concat(summaryValidation.errors || [])
            console.log('[report:update][step3] retry reasons', validationErrors)
            if (recValidation.errors.some((err) => err.startsWith('group_count_invalid'))) {
              validationErrors.push('wrong_item_count_return_exactly_2_per_list')
            }
            console.log('[report:update][step3] retry default')
            defaultResult = await runDefault(undefined, validationErrors)
            if (defaultResult?.meta) {
              await recordAiUsageBestEffort({
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-summary-recs',
                referenceId: reportRes.data.id ?? null,
                requestId,
                feature: 'report-summary-recs',
                meta: defaultResult.meta,
              })
            } else {
              console.log('[report:update][step3] retry_result meta missing')
            }
            if (defaultResult.ok && defaultResult.data) {
              logLlmMeta('retry', defaultResult)
              if (defaultResult?.data?.summary) {
                logSummaryShape('retry_result', defaultResult.data.summary)
              } else {
                console.log('[report:update][step3] retry_result summary missing')
              }
              applyGenerated(defaultResult.data)
              logRecommendationCounts('retry', recommendationsCandidate)
              console.log('[report:update][step3] retry validation errors', recValidation.errors)
              console.log('[report:update][step3] retry summary validation', summaryValidation.errors)
            } else {
              console.log('[report:update][step3] retry_result invalid', {
                ok: defaultResult?.ok ?? false,
                hasData: Boolean(defaultResult?.data),
                error: defaultResult?.error ?? null,
                metaTokens: defaultResult?.meta?.tokens ?? null,
              })
            }
          }
        } else {
          console.log('[report:update][step3] default_result invalid', {
            ok: defaultResult?.ok ?? false,
            hasData: Boolean(defaultResult?.data),
            error: defaultResult?.error ?? null,
            metaTokens: defaultResult?.meta?.tokens ?? null,
          })
        }
        if (!recValidation.ok || !summaryValidation.ok) {
          console.log('[report:update][step3] escalation')
          const escalationResult = await runDefault(
            process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
            validationErrors
          )
          if (escalationResult?.meta) {
            await recordAiUsageBestEffort({
              sessionId: reportRes.data.session_id ?? sessionId,
              reportId: reportRes.data.id ?? null,
              userId,
              actionKey: reportActionKey,
              sourceTask: 'report-summary-recs',
              referenceId: reportRes.data.id ?? null,
              requestId,
              feature: 'report-summary-recs',
              meta: escalationResult.meta,
            })
          } else {
            console.log('[report:update][step3] escalation_result meta missing')
          }
          if (escalationResult.ok && escalationResult.data) {
            logLlmMeta('escalation', escalationResult)
            if (escalationResult?.data?.summary) {
              logSummaryShape('escalation_result', escalationResult.data.summary)
            } else {
              console.log('[report:update][step3] escalation_result summary missing')
            }
            applyGenerated(escalationResult.data)
            logRecommendationCounts('escalation', recommendationsCandidate)
            console.log('[report:update][step3] escalation validation errors', recValidation.errors)
            console.log('[report:update][step3] escalation summary validation', summaryValidation.errors)
          } else {
            console.log('[report:update][step3] escalation_result invalid', {
              ok: escalationResult?.ok ?? false,
              hasData: Boolean(escalationResult?.data),
              error: escalationResult?.error ?? null,
              metaTokens: escalationResult?.meta?.tokens ?? null,
            })
          }
        }
      }

      const runTrizOnly = async (modelOverride, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-triz',
          input:
            typeof options.inputOverride === 'string' && options.inputOverride.trim()
              ? options.inputOverride
              : trizPrompt,
          sessionId,
          language: llmLanguage,
          taskInstructions: trizTaskInstructions,
          forceEscalation: options.forceEscalation === true,
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
            escalation:
              process.env.OPENAI_MODEL_ESCALATION ||
              process.env.OPENAI_MODEL_DEFAULT ||
              'gpt-4.1-mini',
          },
          timeoutMs:
            typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
              ? options.timeoutMs
              : REPORT_TRIZ_TIMEOUT_MS,
          maxOutputTokens: REPORT_TRIZ_MAX_OUTPUT_TOKENS,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })

      const perspectiveCounts = itemsFromDb.reduce(
        (acc, item) => {
          const row = String(item.matrixRow || '').toLowerCase()
          if (!['world', 'product', 'elements'].includes(row)) return acc
          const col = String(item.matrixCol || '').toLowerCase()
          if (col === 'as_is') acc.asIs += 1
          else if (col === 'not_working') acc.notWorking += 1
          else if (col === 'should_be') acc.toBe += 1
          return acc
        },
        { asIs: 0, notWorking: 0, toBe: 0 }
      )
      const executionSupportingItems = itemsFromDb.slice(0, 8)
      const executionReportDefaults = (() => {
        const topic =
          typeof analysisJson?.topic === 'string' && analysisJson.topic.trim()
            ? analysisJson.topic.trim()
            : typeof summaryCandidate?.product === 'string' && summaryCandidate.product.trim()
              ? summaryCandidate.product.trim()
              : ''
        const totalPerspectiveSignals =
          perspectiveCounts.asIs + perspectiveCounts.notWorking + perspectiveCounts.toBe
        const dominantArea = (() => {
          const entries = [
            ['asIs', perspectiveCounts.asIs],
            ['notWorking', perspectiveCounts.notWorking],
            ['toBe', perspectiveCounts.toBe],
          ].sort((left, right) => right[1] - left[1])
          return entries[0]?.[0] || null
        })()
        if (reportLang === 'en') {
          return {
            goal: topic
              ? `Turn the current material about ${topic} into a clearer sequence of product decisions and next steps.`
              : 'Turn the current material into a clearer sequence of product decisions and next steps.',
            map_context: {
              coverage_summary:
                totalPerspectiveSignals > 0
                  ? `Right now you have a clear slice of the situation, but it’s not evenly balanced yet: the material leans most toward ${dominantArea === 'notWorking' ? 'what is breaking or causing friction' : dominantArea === 'toBe' ? 'what you want to achieve' : 'what is true today'}. Use that as your anchor, then make the next decision about what to test or change first.`
                  : 'You have only a partial picture so far, so keep the next step small and testable: pick one concrete point to clarify before you design a solution.',
            },
          }
        }
        return {
          goal: topic
            ? `Przełóż obecny materiał o obszarze ${topic} na bardziej klarowną sekwencję decyzji produktowych i kolejnych kroków.`
            : 'Przełóż obecny materiał na bardziej klarowną sekwencję decyzji produktowych i kolejnych kroków.',
          map_context: {
            coverage_summary:
              totalPerspectiveSignals > 0
                ? `Masz już dość wyraźny obraz sytuacji, ale jeszcze nie jest on równomierny: najmocniej przebija się ${dominantArea === 'notWorking' ? 'to, co boli i przeszkadza' : dominantArea === 'toBe' ? 'to, co chcesz osiągnąć' : 'to, jak jest dziś'}. Oprzyj o to najbliższą decyzję i wybierz jedną rzecz, którą sprawdzisz lub zmienisz jako pierwszą.`
                : 'Na razie widzisz tylko fragment sytuacji, więc trzymaj kolejny krok mały i weryfikowalny: doprecyzuj jedną konkretną niewiadomą zanim zaprojektujesz rozwiązanie.',
          },
        }
      })()

      const buildExecutionReportPrompt = (strictJson = false, retryReasons = []) =>
        JSON.stringify({
          existing_execution_report: phaseASanitized.execution_report ?? null,
          analysis_json: analysisJson,
          summary: summaryCandidate,
          recommendations: recommendationsCandidate,
          triz: trizCandidate,
          perspective_map: perspectiveCounts,
          source_snapshot: phaseASanitized.source_snapshot ?? null,
          supporting_items: executionSupportingItems,
          requirements: {
            output_schema: {
              execution_report: {
                headline: 'string',
                goal: 'string',
                map_context: {
                  coverage_summary: 'string',
                  strongest_area: 'string|null',
                  weakest_area: 'string|null',
                  decision_risk_note: 'string|null',
                },
	                priorities: [
	                  {
	                    title: 'string',
	                    why_it_matters: 'string',
	                    impact: 'high|medium|low',
	                    risk_of_ignoring: 'string',
	                  },
	                ],
		                roadmap_phases: [
		                  {
		                    phase_title: 'string',
		                    why_this_phase_matters: 'string',
		                    key_risk_or_tradeoff: 'string',
		                    concrete_actions: ['string'],
		                    validation_or_test: 'string',
		                    decision_unlocked: 'string',
		                  },
		                ],
		                action_plan: [
		                  {
		                    step: 'string',
		                    status: '"pending" | "in_progress" | "completed"',
		                    details: 'string',
		                    technology_options: ['string'],
		                    done_when: 'string',
		                  },
		                ],
                decisions: [
                  {
                    tradeoff: 'string',
                    option_a: 'string',
                    option_b: 'string',
                    consequence_a: 'string',
                    consequence_b: 'string',
                  },
                ],
                validation_loop: [
                  {
                    check: 'string',
                    how_to_check: 'string',
                    positive_result_means: 'string',
                    negative_result_means: 'string',
                  },
                ],
                next_session_focus: 'string',
              },
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: execution_report.',
              'Base the result only on the provided material. Do not invent missing evidence.',
              'Make the report execution-oriented, concrete, ordered, and decision-useful.',
              'Avoid generic consulting language and repeated observations.',
              'Use the summary, recommendations, TRIZ, and perspective map only as synthesis inputs grounded in the board material.',
              'For goal: write one short, human-readable session goal sentence. Describe what the user is trying to achieve through this session and the intended practical outcome. Make it sound like a product/decision goal, not an instruction to the model. Use plain natural language. Do NOT mention analysis, material, board, synthesis, mapping, or generating a sequence.',
              'For map_context.coverage_summary: write a short, human, insight-driven paragraph (max 2-3 sentences). Address the user directly where natural. Describe what is actually happening in the user’s situation, not what appears on any board/data. Name the most visible tension/problem/pattern and what it means for the next decisions. Use plain language.',
              'Do NOT mention: board, signals, perspectives, dimensions, areas, counts, coverage, mapping. Do NOT describe the dataset; interpret it.',
              'For map_context.strongest_area: explain (plain language) what the user understands best right now / what is clearest.',
              'For map_context.weakest_area: explain what is still unclear, missing, or weakly understood.',
              'For map_context.decision_risk_note: describe the practical risk of jumping into a solution too fast.',
              'If triz.contradictions is present and supported, let selected/supported contradictions visibly continue into decisions and/or the action plan when the material supports it.',
              'Treat contradiction titles as anchors for decision tradeoffs (when used), but do not force one decision per contradiction.',
              'Preserve TRIZ-derived order where natural, but prefer clarity and usefulness over rigid ordering.',
              'Do not invent weak decisions or weak A/B options just to cover every contradiction.',
              'When you create a TRIZ-aligned decision, keep decisions[i].tradeoff semantically close to the relevant contradiction title.',
              'When you include option_a and option_b, they must be two concrete alternative directions for that same tradeoff (not a new topic).',
              'Use exactly these field names and no aliases.',
              'Do not use string shortcuts instead of objects inside priorities, roadmap_phases, action_plan, decisions, or validation_loop.',
              'Lean shape only. Prioritize durable fields that will be persisted and displayed: priorities.title, roadmap_phases, decisions, validation_loop.check, next_session_focus, map_context.coverage_summary, goal, headline.',
              'Write like a senior product engineer, technical founder, or R&D lead advising a real team. The roadmap should read like practical product-development reasoning, not an executive summary, Jira backlog, requirements document, or consulting template.',
              'Prefer roadmap_phases over action_plan: group work into 4–6 meaningful phases (few, high-signal).',
              'Each roadmap phase must contain exactly these primary fields: phase_title, why_this_phase_matters, key_risk_or_tradeoff, concrete_actions, validation_or_test, decision_unlocked.',
              'The most important output is sequencing logic, engineering judgment, uncertainty reduction, tradeoff thinking, and practical constraint reasoning. Actions support that reasoning; reasoning must not merely introduce a task list.',
              'phase_title must be semantic and specific. Never return only "Etap", "Faza", "Phase", or "Stage"; name the uncertainty, product proof point, engineering risk, or milestone being reduced.',
              'why_this_phase_matters should be a short advisory paragraph. Explain why this phase matters now, why it should happen before later work, and what is intentionally not worth optimizing yet.',
              'key_risk_or_tradeoff should read like a caution from an experienced builder. Mention overengineering, premature complexity, cost/weight/footprint/setup friction/manufacturing repeatability, or other concrete constraints when supported.',
              'concrete_actions should contain 2–3 concrete moves max. Avoid long procedural lists. Use grounded build/test/check moves only when they clarify the phase reasoning.',
              'roadmap_phases.concrete_actions must read as direct practical instructions, not impersonal infinitives. In Polish, start with imperative verbs such as "Zaprojektuj", "Zbuduj", "Przetestuj", "Zmierz", "Porównaj", "Sprawdź", "Wybierz" instead of "Zaprojektować", "Zbudować", "Przetestować", "Zmierzyć", "Porównać", "Sprawdzić", "Wybrać". In English, start with imperative verbs such as "Design", "Build", "Test", "Measure", "Compare", "Check", "Choose".',
              'validation_or_test should name the signal that would justify continuing, pivoting, or stopping. Prefer observed user behavior, prototype comparison, metric, physical constraint, cost boundary, or feasibility check over abstract validation.',
              'decision_unlocked should state what decision becomes honest after the phase. It may also say what should wait until the signal is stronger.',
              'If validation_or_test or decision_unlocked starts with "Czy", "Should", or "Can", write it as a proper question and end it with "?".',
              'Avoid visible mechanics in the prose. Do not write labels like "RYZYKO:", "WALIDACJA:", "DECYZJA:", "Największe ryzyko", "Co robimy", "Sygnał, że to działa", or "Jeśli to potwierdzisz".',
              'Avoid waterfall language. Acknowledge temporary assumptions, iteration, pivots, incomplete knowledge, and the possibility that the direction is not worth continuing.',
              'Include founder-style realism where supported: "not worth optimizing yet", "premature complexity", "risk of overengineering", "only continue if users perceive value", "validate before scaling". Phrase naturally, not as slogans.',
              'Prefer concrete constraints and signals such as battery weight, desk footprint, heat dissipation, user setup friction, manufacturing repeatability, installation time, reliability under repeated use, or BOM/cost boundaries when relevant.',
              'Avoid generic strategic filler such as "develop the product", "optimize the experience", "prepare for market", "improve UX", or "scale the solution" unless the same sentence names the concrete artifact, test condition, metric, and decision.',
              'Avoid generic lifecycle endings such as preparing marketing materials or launching the product unless the phase is grounded in concrete product-readiness evidence.',
              'Avoid abstract PM language, especially when unsupported: implementation, analysis, evaluation, ensuring, preparation, optimization, validation. Prefer what someone builds, observes, compares, measures, removes, or deliberately postpones.',
              'Prefer embedded product/R&D actions: prototype variants, material/geometry comparisons, integration spikes, user handling tests, cost checks, manufacturability checks, instrumentation, packaging or compliance checks when relevant.',
              'Use contradictions and decisions as anchors (when supported), but do not force mechanical coverage.',
              'Keep source links via source_type/source_ref (or other metadata), not by copying titles into phase/action text.',
              'Avoid filling mechanical fields (done_when/technology_options) with weak placeholders. If action_plan is present, it can be short and minimal; it is OK for action_plan to be empty when roadmap_phases are strong.',
	              'A good action changes the project state and produces an artifact, test result, or decision-enabling evidence.',
	              'Avoid meta-workshop actions.',
              'Avoid actions whose only output is discussion, clarification, definition, prioritization, or choosing later.',
              'Do not write actions that merely ask the user to define acceptance criteria, define success signals, clarify priorities, analyze options, validate assumptions, turn a signal into an experiment, or add kill conditions.',
              'Forbidden phrases as action titles or main action instructions unless immediately followed by a concrete project-specific object, scope, method, and expected output:',
              '- Define acceptance criteria',
              '- Set acceptance criteria',
              '- Define a success signal',
              '- Set a success signal',
              '- Clarify priorities',
              '- Pick a priority',
              '- Analyze options',
              '- Validate assumptions',
              '- Turn a signal into an experiment',
              '- Add a kill condition',
              '- Narrow the MVP',
              '- Set one hard constraint',
              'If an action involves validation, specify what will be built/tested, with whom or under what condition, what will be measured, and what concrete decision the result will enable.',
              'If an action involves a decision, operationalize the decision into a concrete product/prototype/business step; do not reopen the decision.',
              'If the material is ambiguous, choose the smallest concrete next move supported by the material instead of asking the user to clarify.',
              'Do not invent action_plan placeholder fields. If a legacy action_plan item lacks a useful done_when or technology_options, leave that field empty.',
              'Each decisions item must contain tradeoff and may optionally contain option_a, option_b, consequence_a, and consequence_b.',
              'For each decision, try to provide option_a and option_b as short alternative decision directions grounded in the project material.',
              'If option_a or option_b cannot be supported from the material, omit them instead of inventing weak or generic options.',
              'If consequence_a or consequence_b can be supported from the material, make them short, concrete, project-level consequences of choosing option A or B.',
              'If consequence_a or consequence_b cannot be supported from the material, omit them instead of inventing generic consequences.',
              'It is better to return fewer decisions with meaningful A/B and consequences than more decisions with low-quality enrichment.',
              'Each validation_loop item must contain exactly: check.',
              'Do not include helper fields such as why_it_matters, risk_of_ignoring, why_now, choose_a_when, choose_b_when, how_to_check, positive_result_means, or negative_result_means.',
              'Do not include choose_a_when or choose_b_when.',
              'Do not use alternative keys such as task, krok, output, responsible, deadline, decyzja, cel, metoda, nextSessionFocus, or coverageSummary.',
              'Do not translate keys. Keep JSON keys exactly as specified in English.',
              'Do not return template or meta-instruction text such as "Define a small test...", "This priority affects...", "If ignored...", or "The current direction gains support...".',
              'It is better to return fewer items than to return incomplete items.',
              `priorities: target exactly ${TARGET_EXEC_PRIORITIES} items when material supports it; otherwise return at least 2 and at most 5.`,
              'roadmap_phases: target 4 to 6 phases when material supports it; otherwise return 3 broader phases with concrete actions.',
              'roadmap_phases.concrete_actions: target 2 to 4 concrete actions per phase. Fewer is acceptable only when the material is sparse.',
              `action_plan: optional legacy fallback; if used, return at most ${TARGET_EXEC_ACTION_PLAN} natural items in logical order.`,
              `decisions: target exactly ${TARGET_EXEC_DECISIONS} items when material supports it; otherwise return 2 to 5 items.`,
              `validation_loop: target exactly ${TARGET_EXEC_VALIDATION} items when material supports it; otherwise return 2 to 5 items.`,
              'Avoid empty arrays as a default. Prefer cautious, grounded items over emptiness when there is enough material.',
              'Avoid duplicates: titles/tradeoffs/checks should be distinct and not paraphrases of each other.',
              'Avoid extremely short entries (e.g. 1-2 words) unless the material is truly sparse.',
              'If you cannot support a section, return fewer items but keep at least 2 sections with real content.',
              ...(strictJson
                ? [
                    'STRICT JSON MODE: follow the schema exactly or return fewer items.',
                    'Every list entry must be a JSON object, never a string.',
                    'Do not invent substitute field names.',
                  ]
                : []),
              ...(retryReasons.length
                ? [`Retry focus: fix these issues exactly -> ${retryReasons.join(', ')}`]
                : []),
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
        })

      const buildExecutionReportTaskInstructions = (strictJson = false) => {
        const baseInstructions =
          reportLang === 'en'
          ? `Return a single valid JSON object only. No markdown. No text before or after JSON. Keys: execution_report.\n\nWrite like a senior product engineer, technical founder, or R&D lead advising a real team. Do not facilitate a workshop. Do not ask the user to clarify. Do not generate a checklist, Jira backlog, requirements document, or executive summary.\n\nGoal: produce a structured but natural product-development roadmap where phase reasoning is the main artifact.\nStyle (very important):\n- Write like an advisor: short paragraphs, concrete language, mild uncertainty where appropriate.\n- No visible mechanics: do NOT write labels/headings like \"RISK:\", \"VALIDATION:\", \"DECISION:\", \"Biggest risk\", \"What we do\", \"Signal it works\", no ALL CAPS, no schema-like phrasing.\n- Prefer observable signals and constraints over abstract nouns (avoid: assessment, analysis, implementation, ensuring, preparation, optimization).\n- Avoid waterfall vibes: allow iteration, pivots, and conditional plans; explicitly say what is not worth optimizing yet when relevant.\n- Include practical engineering judgment: premature complexity, overengineering risk, cost/weight/footprint/setup friction/manufacturing repeatability when supported.\n\n- Prefer execution_report.roadmap_phases (4–6 phases) over execution_report.action_plan.\n- Each roadmap phase must use exactly these fields: phase_title, why_this_phase_matters, key_risk_or_tradeoff, concrete_actions, validation_or_test, decision_unlocked.\n- phase_title must name a concrete uncertainty, milestone, or engineering objective. Never return only \"Phase\", \"Stage\", \"Etap\", or \"Faza\".\n- why_this_phase_matters should explain why this matters now, what uncertainty is being reduced, and what should intentionally wait.\n- key_risk_or_tradeoff should sound like a realistic caution, not a label: what could invalidate this direction, what complexity may not be justified, or what constraint can break the plan.\n- concrete_actions should contain 2–3 specific build/test/check moves max. Actions are supporting evidence, not the center of the roadmap.\n- validation_or_test should name the signal that justifies continuing, pivoting, or stopping.\n- decision_unlocked should state what decision becomes honest after the phase, including when not to continue.\n- Avoid filler like \"develop the product\", \"optimize the experience\", \"perform evaluation\", or \"prepare for market\" unless immediately tied to a concrete artifact/test/metric/decision.\n- Avoid mechanical fields: omit or keep empty anything you cannot support (e.g. technology_options, done_when).\n\nIf you include action_plan, keep it short and natural. Do not force imperative verbs or rigid 3–8 word titles.\n\nUse contradictions/decisions as anchors when supported, but do not force mechanical coverage.${strictJson ? ' STRICT JSON MODE: JSON only, exact keys only, no aliases.' : ''}`
          : `Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: execution_report.\n\nPisz jak senior product engineer, technical founder albo lider R&D doradzający prawdziwemu zespołowi. Nie moderuj warsztatu. Nie proś o doprecyzowanie. Nie generuj checklisty, backlogu Jira, dokumentu wymagań ani executive summary.\n\nCel: ustrukturyzowana, naturalna mapa drogowa rozwoju produktu, w której logika etapu jest głównym artefaktem.\nStyl (bardzo ważne):\n- Pisz jak doradca-inżynier: krótkie akapity, konkret, lekka niepewność tam, gdzie to uczciwe.\n- Bez widocznej mechaniki: nie pisz etykiet/nagłówków typu \"RYZYKO:\", \"WALIDACJA:\", \"DECYZJA:\", \"Największe ryzyko\", \"Co robimy\", \"Sygnał, że to działa\", bez CAPS LOCKA i bez brzmienia jak szablon.\n- Preferuj sygnały do zaobserwowania i ograniczenia zamiast abstraktów (unikaj: ocena, analiza, implementacja, zapewnienie, przygotowanie, optymalizacja).\n- Unikaj waterfallu: dopuszczaj iteracje, pivoty i warunkowe plany; jeśli ma sens, powiedz wprost, czego nie warto jeszcze optymalizować.\n- Dodawaj praktyczny osąd inżynierski: przedwczesna złożoność, ryzyko overengineeringu, koszt/masa/footprint/tarcie konfiguracji/powtarzalność produkcji, jeśli wynika to z materiału.\n\n- Preferuj execution_report.roadmap_phases (4–6 etapów) zamiast execution_report.action_plan.\n- Każdy etap roadmapy musi używać dokładnie pól: phase_title, why_this_phase_matters, key_risk_or_tradeoff, concrete_actions, validation_or_test, decision_unlocked.\n- phase_title ma nazwać konkretną niewiadomą, kamień milowy albo cel inżynieryjny. Nigdy nie zwracaj samego \"Etap\", \"Faza\", \"Phase\" ani \"Stage\".\n- why_this_phase_matters ma wyjaśniać, dlaczego to ważne teraz, jaką niewiadomą redukuje i co celowo powinno poczekać.\n- key_risk_or_tradeoff ma brzmieć jak realistyczna przestroga, nie etykieta: co może unieważnić kierunek, jaka złożoność może nie mieć uzasadnienia albo jakie ograniczenie może złamać plan.\n- concrete_actions ma zawierać maksymalnie 2–3 konkretne ruchy typu zbuduj/przetestuj/sprawdź. Działania wspierają rozumowanie, nie są centrum roadmapy.\n- validation_or_test ma nazwać sygnał, który uzasadnia kontynuację, pivot albo zatrzymanie.\n- decision_unlocked ma powiedzieć, jaka decyzja staje się uczciwa po etapie, także kiedy nie kontynuować.\n- Unikaj wypełniaczy typu \"rozwinąć produkt\", \"zoptymalizować doświadczenie\", \"przeprowadzić ewaluację\", \"przygotować do rynku\", jeśli od razu nie wskazujesz konkretnego artefaktu/testu/metryki/decyzji.\n- Unikaj mechanicznych pól: pomijaj (albo zostaw puste) to, czego nie da się sensownie uzasadnić (np. technology_options, done_when).\n\nJeśli dodajesz action_plan, niech będzie krótki i naturalny. Nie wymuszaj trybu rozkazującego ani sztucznie krótkich tytułów.\n\nTraktuj sprzeczności/decyzje jako kotwice, ale nie wymuszaj mechanicznego pokrycia.${strictJson ? ' TRYB ŚCISŁEGO JSON: tylko JSON, tylko dokładnie zdefiniowane klucze, bez aliasów.' : ''}`

        const roadmapLanguageInstructions =
          reportLang === 'en'
            ? 'Roadmap language: roadmap_phases.concrete_actions must read as direct practical instructions, not impersonal infinitives. Start with imperative verbs such as "Design", "Build", "Test", "Measure", "Compare", "Check", "Choose". If validation_or_test or decision_unlocked starts with "Should" or "Can", write it as a proper question and end it with "?".'
            : 'Język roadmapy: roadmap_phases.concrete_actions mają brzmieć jak bezpośrednie, praktyczne instrukcje, nie bezosobowe bezokoliczniki. Zaczynaj od trybu rozkazującego: "Zaprojektuj", "Zbuduj", "Przetestuj", "Zmierz", "Porównaj", "Sprawdź", "Wybierz" zamiast "Zaprojektować", "Zbudować", "Przetestować", "Zmierzyć", "Porównać", "Sprawdzić", "Wybrać". Jeśli validation_or_test albo decision_unlocked zaczyna się od "Czy", zapisz to jako poprawne pytanie i zakończ znakiem "?".'
        return `${baseInstructions}\n\n${roadmapLanguageInstructions}`
      }

      const actionPlanRawResponses = new Map()
      const actionPlanParseResults = new Map()

      const summarizeRawOutput = (content) => {
        const raw = typeof content === 'string' ? content : String(content ?? '')
        return {
          rawOutputLen: raw.length,
          rawOutputPreview: previewDiagnosticText(raw, 3000),
          rawOutputTail: previewDiagnosticText(raw.slice(Math.max(0, raw.length - 1000)), 1000),
          containsRoadmapPhases: raw.includes('roadmap_phases'),
          containsActionPlan: raw.includes('action_plan'),
          containsTechnologyOptions: raw.includes('technology_options'),
          containsDoneWhen: raw.includes('done_when'),
          containsRyzyko: raw.includes('RYZYKO'),
          containsWalidacja: raw.includes('WALIDACJA'),
          looksTruncated: looksLikeTruncatedJson(raw),
        }
      }

      const logRawLlmResponse = ({ task, model, content }) => {
        actionPlanRawResponses.set(task, { model: model ?? null, content })
        if (!actionPlanDiagnosticsEnabled) return
        console.log('[REPORT FINALIZE DEBUG][backend][llm-raw]', {
          requestId,
          sessionId,
          task,
          model: model ?? null,
          ...summarizeRawOutput(content),
        })
      }

      const logActionPlanParseResult = (task, value, parseAttempt, parsedShape) => {
        actionPlanParseResults.set(task, {
          parseError: parseAttempt?.error
            ? {
                name: parseAttempt.error?.name ?? null,
                message: parseAttempt.error?.message ?? String(parseAttempt.error),
              }
            : null,
          recoveryError: parseAttempt?.recoveryError
            ? {
                name: parseAttempt.recoveryError?.name ?? null,
                message: parseAttempt.recoveryError?.message ?? String(parseAttempt.recoveryError),
              }
            : null,
          recovered: Boolean(parseAttempt?.recovered),
          parsedShape,
        })
        if (!actionPlanDiagnosticsEnabled) return
        const parseError = parseAttempt?.recoveryError || parseAttempt?.error || null
        console.log('[REPORT FINALIZE DEBUG][backend][llm-parse]', {
          requestId,
          sessionId,
          task,
          parsed: Boolean(parseAttempt?.parsed),
          recovered: Boolean(parseAttempt?.recovered),
          parseError: parseError
            ? {
                name: parseError?.name ?? null,
                message: parseError?.message ?? String(parseError),
              }
            : null,
          parsedShape,
          ...summarizeRawOutput(value),
        })
      }

      const logActionPlanLlmCallResult = (task, promptCharLen, result) => {
        if (!actionPlanDiagnosticsEnabled) return
        const raw = actionPlanRawResponses.get(task)
        const parse = actionPlanParseResults.get(task)
        console.log('[REPORT FINALIZE DEBUG][backend][llm-result]', {
          requestId,
          sessionId,
          task,
          promptCharLen,
          model: result?.meta?.modelUsed ?? raw?.model ?? null,
          tokens: result?.meta?.tokens ?? null,
          llmOk: Boolean(result?.ok),
          hasData: Boolean(result?.data),
          parseError: parse?.recoveryError || parse?.parseError || null,
          ...(raw ? summarizeRawOutput(raw.content) : {}),
        })
      }

      const buildDecisionEnrichmentPrompt = (decisions) =>
        JSON.stringify({
          lang: reportLang,
          summary: summaryCandidate,
          triz: trizCandidate,
          decisions,
          requirements: {
            output_schema: {
              decisions: [
                {
                  tradeoff: 'string',
                  consequence_a: 'string',
                  consequence_b: 'string',
                },
              ],
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: decisions.',
              'Use the provided decisions as the base. Do not regenerate the whole execution report.',
              'Preserve exactly the same number of decisions as in the input.',
              'Preserve the same order as in the input.',
              'Preserve each tradeoff exactly in meaning and as closely as possible in wording.',
              'Do not rename, merge, split, generalize, or replace decision tradeoffs.',
              'Keep each tradeoff aligned with the input decisions and preserve the same decision meaning.',
              'For each decision, try to add consequence_a and consequence_b only when option_a or option_b are present and the material supports a concrete consequence.',
              'Only enrich with consequence_a and consequence_b when supported by the material. If not supported, omit the consequence field but keep the decision entry aligned.',
              'Each consequence must be one short, practical, project-level sentence.',
              'Do not return placeholders, generic business advice, or meta-instructions.',
              'If a consequence cannot be supported from the material, omit the field instead of inventing it.',
              'Do not add any keys other than tradeoff, consequence_a, consequence_b.',
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
        })

      const buildExecutionDecisionsPrompt = (strictJson = false, retryReasons = []) => {
        const contradictions = Array.isArray(trizCandidate?.contradictions)
          ? trizCandidate.contradictions
              .filter((c) => c && typeof c === 'object')
              .map((c, index) => ({
                contradiction_index: index,
                title: normalizeExecutionText(c.title),
                explanation: normalizeExecutionText(c.explanation),
              }))
              .filter((c) => c.title || c.explanation)
          : []
        const hasContradictions = contradictions.length > 0
        return JSON.stringify({
          analysis_json: analysisJson,
          triz_contradictions: contradictions,
          perspective_map: perspectiveCounts,
          supporting_items: executionSupportingItems,
          requirements: {
            output_schema: {
              decisions: [
                {
                  contradiction_index: 'number|null',
                  tradeoff: 'string',
                  option_a: 'string',
                  option_b: 'string',
                  consequence_a: 'string',
                  consequence_b: 'string',
                },
              ],
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: decisions.',
              hasContradictions
                ? 'TRIZ contradictions are the authoritative source: generate EXACTLY one decision per contradiction.'
                : 'Generate the most important project decisions/tradeoffs grounded in the material.',
              hasContradictions
                ? 'Do not add extra decisions beyond the contradictions list and do not skip any contradiction.'
                : `Target exactly ${TARGET_EXEC_DECISIONS} decisions when material supports it; otherwise return 2 to 5.`,
              hasContradictions
                ? 'For each decision set contradiction_index to the source contradiction_index.'
                : 'Set contradiction_index to null.',
              'Each decision must be short, concrete, and decision-useful (not a generic statement).',
              'Option A and Option B must be genuinely different directions.',
              'Each consequence must be one short practical sentence. If not supported, keep it empty.',
              ...(retryReasons?.length ? [`Retry reasons: ${retryReasons.join(', ')}`] : []),
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
          strict_json: Boolean(strictJson),
        })
      }

      const buildExecutionPlanPrompt = (strictJson = false, retryReasons = []) =>
        JSON.stringify({
          analysis_json: analysisJson,
          triz: trizCandidate,
          selected_triz_approaches: Array.isArray(trizCandidate?.contradictions)
            ? trizCandidate.contradictions
                .flatMap((c, contradiction_index) => {
                  const rendered =
                    Array.isArray(c?.approaches) && c.approaches.length
                      ? c.approaches
                      : Array.isArray(c?.solutions)
                        ? c.solutions
                        : []
                  const indicesRaw = Array.isArray(c?.selected_approach_indices)
                    ? c.selected_approach_indices
                    : c?.selected_approach_index != null
                      ? [c.selected_approach_index]
                      : []
                  const indices = Array.from(
                    new Set(
                      indicesRaw
                        .map((idx) => (typeof idx === 'number' ? idx : Number(idx)))
                        .filter((idx) => Number.isFinite(idx))
                        .map((idx) => Math.max(0, Math.floor(idx)))
                        .filter((idx) => idx >= 0 && idx < rendered.length)
                    )
                  )
                  return indices
                    .map((approach_index) => {
                      const selected = rendered[approach_index]
                      if (!selected) return null
                      return {
                        contradiction_index,
                        contradiction_title: normalizeExecutionText(c?.title),
                        approach_index,
                        approach_title: normalizeExecutionText(selected?.title),
                        approach_description: normalizeExecutionText(selected?.description),
                      }
                    })
                    .filter(Boolean)
                })
            : [],
          perspective_map: perspectiveCounts,
          supporting_items: executionSupportingItems,
          decisions: Array.isArray(executionReportCandidate?.decisions)
            ? executionReportCandidate.decisions.map((d) => ({
                tradeoff: normalizeExecutionText(d?.tradeoff),
                option_a: normalizeExecutionText(d?.option_a),
                option_b: normalizeExecutionText(d?.option_b),
                selected_option: normalizeExecutionSelectedOption(d?.selected_option),
              }))
            : [],
          action_generation: {
            choice_actions_required_count:
              (Array.isArray(executionReportCandidate?.decisions)
                ? executionReportCandidate.decisions.filter(
                    (d) => d?.selected_option === 'a' || d?.selected_option === 'b'
                  ).length
                : 0) +
              (Array.isArray(trizCandidate?.contradictions)
                ? trizCandidate.contradictions.reduce((sum, c) => {
                    const indices = Array.isArray(c?.selected_approach_indices)
                      ? c.selected_approach_indices
                      : c?.selected_approach_index != null
                        ? [c.selected_approach_index]
                        : []
                    return sum + new Set(indices).size
                  }, 0)
                : 0),
            analysis_actions_min_count: 3,
          },
          requirements: {
            output_schema: {
              priorities: [{ title: 'string' }],
              choice_actions: [
                {
                  title: 'string',
                  what_to_do: 'string',
                  success_criteria: 'string',
                  source_ref: 'string',
                },
              ],
              analysis_actions: [
                {
                  title: 'string',
                  what_to_do: 'string',
                  success_criteria: 'string',
                },
              ],
              validation_loop: [{ check: 'string' }],
              next_session_focus: 'string',
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: priorities, choice_actions, analysis_actions, validation_loop, next_session_focus.',
              'Build a focused plan from the user selections + the board context.',
              'Treat selected options as committed design choices.',
              'IMPORTANT: choice_actions must contain EXACTLY action_generation.choice_actions_required_count items.',
              'IMPORTANT: choice_actions must cover ALL selections: every selected decision and every selected TRIZ approach gets exactly 1 choice_actions item.',
              'IMPORTANT: For choice_actions.source_ref use ONE of these formats: "decision:<normalized_tradeoff_key>:<a|b>" or "triz:<contradiction_index>:<approach_index>".',
              'IMPORTANT: analysis_actions must contain at least action_generation.analysis_actions_min_count items and they must be distinct from the selections.',
              'analysis_actions must not be a paraphrase of user selections. They must turn board signals into: an experiment, a success criterion, an MVP constraint, a user behavior test, or an assumption to tighten.',
              'Do NOT copy board items verbatim. Summarize and convert into actionable steps.',
              'Do NOT use any source labels in titles like "Decyzja:", "Podejście TRIZ:", "Z tablicy:" or similar.',
              'Write all actions in one consistent style: concrete, natural language, no technical meta.',
              'Avoid dry formulaic verbs like "wdroż wybraną opcję", "zweryfikuj", "zrób pierwszy prototyp/test". Be specific about what and how.',
              'Do not recommend actions that contradict the selected options.',
              'Do not regenerate or reinterpret the decisions list.',
              `priorities: target exactly ${TARGET_EXEC_PRIORITIES} items when material supports it; otherwise return at least 2 and at most 5.`,
              `Keep action counts reasonable. choice_actions + analysis_actions should be <= ${MAX_EXEC_ACTION_PLAN_ITEMS}.`,
              `validation_loop: target exactly ${TARGET_EXEC_VALIDATION} items when material supports it; otherwise return 2 to 5 items.`,
              ...(retryReasons?.length ? [`Retry reasons: ${retryReasons.join(', ')}`] : []),
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
          strict_json: Boolean(strictJson),
        })

      const buildDecisionEnrichmentTaskInstructions = () =>
        reportLang === 'en'
          ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Key: decisions. For each provided decision, add only short, concrete consequence_a and consequence_b when they are clearly supported by the material. Keep the same decision meaning. Do not regenerate the whole report. Do not use placeholders or generic filler.'
          : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: decisions. Dla każdej przekazanej decyzji dodaj tylko krótkie, konkretne consequence_a i consequence_b, ale wyłącznie wtedy, gdy wynikają z materiału. Zachowaj sens tej samej decyzji. Nie generuj ponownie całego raportu. Bez placeholderów i generycznych wypełniaczy.'

      const runExecutionReport = async (modelOverride, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-action-plan',
          input: buildExecutionReportPrompt(options.strictJson === true, options.retryReasons || []),
          sessionId,
          language: llmLanguage,
          taskInstructions: buildExecutionReportTaskInstructions(options.strictJson === true),
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const raw = parsed?.execution_report && typeof parsed.execution_report === 'object'
              ? parsed.execution_report
              : parsed
            logActionPlanParseResult(
              'report-action-plan',
              value,
              parseAttempt,
              getActionPlanDiagnosticShape(raw)
            )
            return raw && typeof raw === 'object' ? raw : null
          },
          fallbackData: null,
          models: {
            default: modelOverride || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 2600,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
          onRawResponse: logRawLlmResponse,
        })

      const runExecutionDecisionsOnly = async (modelOverride, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-execution-decisions',
          input: buildExecutionDecisionsPrompt(options.strictJson === true, options.retryReasons || []),
          sessionId,
          language: llmLanguage,
          taskInstructions:
            reportLang === 'en'
              ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Key: decisions. Keep it concrete and grounded.'
              : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: decisions. Konkretnie i na podstawie materiału.',
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const raw = Array.isArray(parsed?.decisions)
              ? parsed.decisions
              : Array.isArray(parsed)
                ? parsed
                : null
            return raw
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

      const runExecutionPlanFromDecisions = async (modelOverride, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-execution-plan-from-decisions',
          input: buildExecutionPlanPrompt(options.strictJson === true, options.retryReasons || []),
          sessionId,
          language: llmLanguage,
          taskInstructions:
            reportLang === 'en'
              ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Keys: priorities, choice_actions, analysis_actions, validation_loop, next_session_focus. Do not output decisions.'
              : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucze: priorities, choice_actions, analysis_actions, validation_loop, next_session_focus. Nie zwracaj decisions.',
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            logActionPlanParseResult(
              'report-execution-plan-from-decisions',
              value,
              parseAttempt,
              parsed && typeof parsed === 'object'
                ? {
                    prioritiesLen: Array.isArray(parsed.priorities) ? parsed.priorities.length : null,
                    choiceActionsLen: Array.isArray(parsed.choice_actions) ? parsed.choice_actions.length : null,
                    analysisActionsLen: Array.isArray(parsed.analysis_actions)
                      ? parsed.analysis_actions.length
                      : null,
                    validationLoopLen: Array.isArray(parsed.validation_loop)
                      ? parsed.validation_loop.length
                      : null,
                  }
                : null
            )
            return parsed && typeof parsed === 'object' ? parsed : null
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
          onRawResponse: logRawLlmResponse,
        })

      const buildActionPlanRewritePrompt = (actions) =>
        JSON.stringify({
          lang: reportLang,
          actions: Array.isArray(actions)
            ? actions.map((item) => ({
                step: normalizeExecutionText(item?.step || item?.title),
                status: normalizeExecutionStatus(item?.status),
                details: normalizeExecutionText(item?.details || item?.what_to_do),
                technology_options: normalizeExecutionTechnologyOptions(item?.technology_options),
                done_when: normalizeExecutionText(item?.done_when || item?.expected_result),
                source_type: item?.source_type ?? null,
                derived_from_user_choice: Boolean(item?.derived_from_user_choice),
              }))
            : [],
          requirements: {
            output_schema: {
              action_plan: [
                {
                  step: 'string',
                  status: '"pending" | "in_progress" | "completed"',
                  details: 'string',
                  technology_options: ['string'],
                  done_when: 'string',
                },
              ],
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: action_plan.',
              'Rewrite the provided actions into a cohesive, natural action plan.',
              'Preserve EXACTLY the same number of actions and the same order.',
              'Do NOT merge two actions into one.',
              'Do NOT split one action into multiple actions.',
              'Do NOT add or remove actions.',
              'Keep each action semantically aligned with the input action at the same index.',
              'Preserve status values. Do NOT change statuses.',
              'Do NOT include any source labels like "Decyzja:", "Podejście TRIZ:", "Z tablicy:", "From the board:" in step/details/done_when.',
              'Write in one consistent style: concrete, specific, natural language.',
              'Act as a product execution strategist, not a workshop facilitator. Do not generate meta-workshop prompts.',
              'Never output noun-phrase topics. Every step must start with an imperative verb and be short (ideally 3-8 words).',
              'Keep step short; move detail into details, technology_options, and done_when.',
              'technology_options must have 0-3 practical options.',
              'done_when must be a concrete completion condition.',
              'A good rewrite keeps the action concrete and state-changing: build, test, compare, prototype, implement, remove a constraint, reduce uncertainty, or validate a risky assumption with a concrete artifact or experiment.',
              'Avoid meta-workshop actions whose only output is discussion, clarification, definition, prioritization, or choosing later.',
              'Do not write or preserve action titles that are only process, such as: "Define acceptance criteria", "Set acceptance criteria", "Define a success signal", "Set a success signal", "Clarify priorities", "Pick a priority", "Analyze options", "Validate assumptions", "Turn a signal into an experiment", "Add a kill condition", "Narrow the MVP", "Set one hard constraint" unless immediately followed by a concrete project object, scope, method, and expected output.',
              'Be specific about what to build, what to test, with whom/under what conditions, what you measure, and what decision the result enables.',
              'Avoid dry template verbs like "wdroż wybraną opcję", "zweryfikuj", "zrób pierwszy prototyp/test", or "z jasnym sygnałem pass/fail". Replace with concrete project actions and concrete artifacts.',
              'Across the whole plan, vary action types by real-world artifacts and steps (prototype build, user test setup, implementation slice, integration, content/spec creation, instrumentation, packaging/ops), not workshop moves.',
              'Avoid repeating the same sentence pattern across actions (especially not one pattern per category).',
              'Do not start most steps with the same word. Vary phrasing naturally.',
              'Paraphrase input material; do not copy full decision titles or full board sentences as the core of the bullet.',
              'For done_when, include a short measurable outcome or acceptance criterion when possible.',
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
        })

      const runActionPlanRewrite = async (actions, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-action-plan-rewrite',
          input: buildActionPlanRewritePrompt(actions),
          sessionId,
          language: llmLanguage,
          taskInstructions:
            reportLang === 'en'
              ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Key: action_plan. Act as a product execution strategist, not a workshop facilitator. Rewrite into concrete, real-world execution actions (build/test/prototype/implement) and avoid meta-workshop phrasing.'
              : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: action_plan. Działaj jak strateg wykonania produktu, a nie moderator warsztatu. Przepisz na konkretne akcje wykonawcze (zbuduj/przetestuj/prototypuj/wdroż) i unikaj warsztatowych meta-sformułowań.',
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const raw = parsed?.action_plan
            logActionPlanParseResult(
              'report-action-plan-rewrite',
              value,
              parseAttempt,
              { actionPlanLen: Array.isArray(raw) ? raw.length : null }
            )
            return Array.isArray(raw) ? raw : null
          },
          fallbackData: null,
          models: {
            default: options.modelOverride || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 1200,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
          onRawResponse: logRawLlmResponse,
        })

      const buildRoadmapFromActionPlanPrompt = (actions, context = {}) =>
        JSON.stringify({
          lang: reportLang,
          project_hint: {
            headline: normalizeExecutionText(context?.headline),
            goal: normalizeExecutionText(context?.goal),
          },
          decisions: Array.isArray(context?.decisions) ? context.decisions : [],
          triz: context?.triz ?? null,
          supporting_items: Array.isArray(context?.supporting_items) ? context.supporting_items : [],
          action_plan: Array.isArray(actions)
            ? actions.map((item) => ({
                step: normalizeExecutionText(item?.step || item?.title),
                details: normalizeExecutionText(item?.details || item?.what_to_do),
                done_when: normalizeExecutionText(item?.done_when || item?.expected_result),
              }))
            : [],
          requirements: {
            output_schema: {
              roadmap_phases: [
                {
                  phase_title: 'string',
                  why_this_phase_matters: 'string',
                  key_risk_or_tradeoff: 'string',
                  concrete_actions: ['string'],
                  validation_or_test: 'string',
                  decision_unlocked: 'string',
                },
              ],
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: roadmap_phases.',
              'Write like a senior product engineer, technical founder, or R&D lead advising a real team.',
              'Convert the input into a coherent roadmap of 4–6 phases where phase reasoning is primary. It must not read like a checklist, Jira backlog, requirements document, or executive summary.',
              'Each phase must include exactly: phase_title, why_this_phase_matters, key_risk_or_tradeoff, concrete_actions, validation_or_test, decision_unlocked.',
              'phase_title must name the concrete uncertainty, milestone, or engineering objective. Never return only "Etap", "Faza", "Phase", or "Stage".',
              'why_this_phase_matters should explain why this phase matters now, why it comes before later work, and what should intentionally wait.',
              'key_risk_or_tradeoff should read like a practical caution: what could invalidate the direction, what complexity may be premature, or what tradeoff constrains the next move.',
              'concrete_actions should contain 2–3 specific build/test/check moves max. Actions are supporting evidence, not the main artifact.',
              'roadmap_phases.concrete_actions must read as direct practical instructions, not impersonal infinitives. In Polish, start with imperative verbs such as "Zaprojektuj", "Zbuduj", "Przetestuj", "Zmierz", "Porównaj", "Sprawdź", "Wybierz" instead of "Zaprojektować", "Zbudować", "Przetestować", "Zmierzyć", "Porównać", "Sprawdzić", "Wybrać". In English, start with imperative verbs such as "Design", "Build", "Test", "Measure", "Compare", "Check", "Choose".',
              'validation_or_test should describe the signal that justifies continuing, pivoting, or stopping: a practical test, prototype comparison, metric, observed behavior, or constraint check.',
              'decision_unlocked should state the decision the team can make after the phase, including what not to pursue if the signal is weak.',
              'If validation_or_test or decision_unlocked starts with "Czy", "Should", or "Can", write it as a proper question and end it with "?".',
              'Use concrete details from the provided material. Do not invent missing evidence.',
              'Do not write visible labels such as "RISK:", "VALIDATION:", "DECISION:", "Największe ryzyko", "Co robimy", "Sygnał, że to działa", or "Jeśli to potwierdzisz". Make the prose itself advisory.',
              'Avoid waterfall language. Mention iteration, temporary assumptions, pivots, incomplete knowledge, and not-worth-optimizing-yet areas when relevant.',
              'Prefer concrete engineering/product constraints such as battery weight, desk footprint, heat dissipation, setup friction, manufacturing repeatability, installation time, reliability under repeated use, or cost boundaries when relevant.',
              'Avoid generic strategic filler such as "develop the product", "optimize the experience", "prepare for market", "improve UX", or "scale the solution" unless the same sentence names the concrete artifact, test condition, metric, and decision.',
              'Avoid generic lifecycle endings such as preparing marketing materials or launching unless grounded in concrete product-readiness evidence.',
              'Avoid abstract PM wording such as implementation, analysis, evaluation, ensuring, preparation, optimization, or validation when a concrete build/test/observe/compare/check phrasing is possible.',
              'Avoid rigid imperative verbs as phase titles.',
              reportLang === 'en' ? 'Output must be in English.' : 'Całość po polsku.',
            ],
          },
        })

      const runRoadmapFromActionPlan = async (actions, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-action-plan-roadmap',
          input: buildRoadmapFromActionPlanPrompt(actions, options.context || {}),
          sessionId,
          language: llmLanguage,
          taskInstructions:
            reportLang === 'en'
              ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Key: roadmap_phases.'
              : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: roadmap_phases.',
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const raw = parsed?.roadmap_phases
            logActionPlanParseResult(
              'report-action-plan-roadmap',
              value,
              parseAttempt,
              { roadmapPhasesLen: Array.isArray(raw) ? raw.length : null }
            )
            return Array.isArray(raw) ? raw : null
          },
          fallbackData: null,
          models: {
            default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 2200,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
          onRawResponse: logRawLlmResponse,
        })

      const buildActionPlanCopyPolishPrompt = (actions, context = {}) =>
        JSON.stringify({
          lang: reportLang,
          project_hint: {
            headline: normalizeExecutionText(context?.headline),
            goal: normalizeExecutionText(context?.goal),
          },
          action_plan: Array.isArray(actions)
            ? actions.map((item) => ({
                step: normalizeExecutionText(item?.step || item?.title),
                status: normalizeExecutionStatus(item?.status),
                details: normalizeExecutionText(item?.details || item?.what_to_do),
                technology_options: normalizeExecutionTechnologyOptions(item?.technology_options),
                done_when: normalizeExecutionText(item?.done_when || item?.expected_result),
                meta: {
                  source_type: item?.source_type ?? null,
                  source_ref: item?.source_ref ?? null,
                  derived_from_user_choice: Boolean(item?.derived_from_user_choice),
                },
              }))
            : [],
          requirements: {
            output_schema: {
              action_plan: [
                {
                  step: 'string',
                  status: '"pending" | "in_progress" | "completed"',
                  details: 'string',
                  technology_options: ['string'],
                  done_when: 'string',
                },
              ],
            },
            notes: [
              'Return exactly one valid JSON object and nothing else.',
              'The JSON must contain only: action_plan.',
              'Rewrite ONLY the copy (wording) of: step, details, technology_options, done_when.',
              'Preserve EXACTLY the same number of items and the same order.',
              'Do NOT add/remove/reorder/merge/split items.',
              'Do NOT change statuses. Preserve status values exactly.',
              'Do NOT add any new fields. Do NOT output meta fields.',
              'Do NOT copy contradiction titles, decision tradeoffs, or solution titles into step.',
              'Never output noun-phrase topics. Every step must start with an imperative verb.',
              'Keep step short and natural (ideally 3–8 words), but do not truncate or break grammar.',
              'details: concise natural phrasing; avoid repeating step.',
              'technology_options: keep 0–3 concrete options; do not invent many options.',
              'done_when: keep a verifiable completion condition; do not turn it into a benefit.',
              reportLang === 'en' ? 'Output must be in English only.' : 'Całość wyłącznie po polsku.',
              reportLang === 'en'
                ? 'Status values must remain in English only: pending, in_progress, completed.'
                : 'Status zawsze po angielsku: pending, in_progress, completed.',
              reportLang === 'en'
                ? 'STRICT: Do not output markdown.'
                : 'TRYB ŚCISŁY: Bez markdown.',
            ],
          },
        })

      const runActionPlanCopyPolish = async (actions, options = {}) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'action-plan-copy-polish',
          input: buildActionPlanCopyPolishPrompt(actions, options.context || {}),
          sessionId,
          language: llmLanguage,
          taskInstructions:
            reportLang === 'en'
              ? 'Return a single valid JSON object only. No markdown. No text before or after JSON. Key: action_plan. You are polishing copy only; preserve meaning, count, order, and status.'
              : 'Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: action_plan. To tylko wygładzenie copy; zachowaj sens, liczbę, kolejność i statusy.',
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const raw = parsed?.action_plan
            return Array.isArray(raw) ? raw : null
          },
          fallbackData: null,
          models: {
            default: options.modelOverride || process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 700,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })

      const polishActionPlanCopyWithLlm = async (actionPlan, locale, context = {}) => {
        const plan = Array.isArray(actionPlan) ? actionPlan : []
        if (!plan.length) return plan
        console.log('[report:update][action-plan-copy-polish] diagnostics', {
          requestId,
          sessionId,
          task: 'action-plan-copy-polish',
          locale,
          item_count: plan.length,
          polish_attempted: 1,
          polish_accepted: 0,
          polish_rejected: 0,
          polish_reject_reason: null,
        })

        const summarizeRejectReason = (errors) => {
          const list = Array.isArray(errors) ? errors : []
          const has = (prefix) => list.some((e) => String(e || '').startsWith(prefix))
          if (list.includes('length_mismatch')) return 'wrong_length'
          if (list.includes('in_progress_count_changed') || has('status_changed:')) return 'status_changed'
          if (has('meta_prefix:')) return 'invalid_step'
          if (has('mixed_language:')) return 'mixed_language'
          if (has('missing_step:') || has('missing_done_when:') || has('not_imperative:')) return 'invalid_step'
          if (has('step_too_long:') || has('technology_options_')) return 'invalid_step'
          return list.length ? 'invalid_step' : 'unknown'
        }
        try {
          const polishResult = await runActionPlanCopyPolish(plan, { strictJson: true, context })
          if (polishResult?.meta) {
            await recordAiUsageBestEffort({
              sessionId: reportRes.data.session_id ?? sessionId,
              reportId: reportRes.data.id ?? null,
              userId,
              actionKey: reportActionKey,
              sourceTask: 'action-plan-copy-polish',
              referenceId: reportRes.data.id ?? null,
              requestId,
              feature: 'action-plan-copy-polish',
              meta: polishResult.meta,
            })
            logLlmMeta('action-plan-copy-polish', polishResult)
          }
          if (!(polishResult?.ok && Array.isArray(polishResult.data))) {
            const rejectReason = polishResult?.error ? 'llm_error' : 'invalid_json'
            console.log('[report:update][action-plan-copy-polish] diagnostics', {
              requestId,
              sessionId,
              task: 'action-plan-copy-polish',
              locale,
              item_count: plan.length,
              polish_attempted: 1,
              polish_accepted: 0,
              polish_rejected: 1,
              polish_reject_reason: rejectReason,
              ok: polishResult?.ok ?? false,
              hasData: Array.isArray(polishResult?.data),
              llm_error: polishResult?.error ?? null,
              metaTokens: polishResult?.meta?.tokens ?? null,
            })
            return plan
          }

          const candidate = polishResult.data
          const validation = validatePolishedActionPlan(plan, candidate, locale)
          if (!validation.ok) {
            const rejectReason = summarizeRejectReason(validation.errors)
            console.log('[report:update][action-plan-copy-polish] diagnostics', {
              requestId,
              sessionId,
              task: 'action-plan-copy-polish',
              locale,
              item_count: plan.length,
              polish_attempted: 1,
              polish_accepted: 0,
              polish_rejected: 1,
              polish_reject_reason: rejectReason,
              error_count: validation.errors.length,
            })
            return plan
          }

          const merged = candidate.map((item, idx) => {
            const original = plan[idx] || {}
            const step = sanitizeExecutionActionStep(normalizeExecutionText(item?.step), locale)
            return {
              ...original,
              step: step,
              // Preserve original status + metadata, only polish user-facing copy.
              status: normalizeExecutionStatus(original?.status),
              details: sanitizeExecutionDetailText(item?.details),
              technology_options: normalizeExecutionTechnologyOptions(item?.technology_options),
              done_when: sanitizeExecutionDetailText(item?.done_when),
            }
          })

          console.log('[report:update][action-plan-copy-polish] diagnostics', {
            requestId,
            sessionId,
            task: 'action-plan-copy-polish',
            locale,
            item_count: merged.length,
            polish_attempted: 1,
            polish_accepted: 1,
            polish_rejected: 0,
            polish_reject_reason: null,
          })
          return merged
        } catch (error) {
          console.error('[report:update] action-plan-copy-polish exception:', error)
          console.log('[report:update][action-plan-copy-polish] diagnostics', {
            requestId,
            sessionId,
            task: 'action-plan-copy-polish',
            locale,
            item_count: plan.length,
            polish_attempted: 1,
            polish_accepted: 0,
            polish_rejected: 1,
            polish_reject_reason: 'llm_error',
          })
          return plan
        }
      }

      const runDecisionEnrichment = async (decisions) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-decisions-enrich',
          input: buildDecisionEnrichmentPrompt(decisions),
          sessionId,
          language: llmLanguage,
          taskInstructions: buildDecisionEnrichmentTaskInstructions(),
          parseResponse: (value) => {
            const parseAttempt = safeParseJson(value)
            const parsed = parseAttempt.parsed
            const raw = Array.isArray(parsed?.decisions)
              ? parsed.decisions
              : Array.isArray(parsed)
                ? parsed
                : null
            return raw
          },
          fallbackData: null,
          models: {
            default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 700,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })

      const forceTrizOnGenerate = reportActionKey === 'report_generate'

      if (!executionPlanOnly) try {
        const trizOnlyResult = await runTrizOnly()
        if (diagnosticsEnabled) {
          console.log('[report:update][triz] first_attempt', {
            requestId,
            ok: trizOnlyResult?.ok ?? false,
            hasData: Boolean(trizOnlyResult?.data),
            error: trizOnlyResult?.error ?? null,
            metaTokens: trizOnlyResult?.meta?.tokens ?? null,
          })
        }
        if (trizOnlyResult?.meta) {
          await recordAiUsageBestEffort({
            sessionId: reportRes.data.session_id ?? sessionId,
            reportId: reportRes.data.id ?? null,
            userId,
            actionKey: reportActionKey,
            sourceTask: 'report-triz',
            referenceId: reportRes.data.id ?? null,
            requestId,
            feature: 'report-triz',
            meta: trizOnlyResult.meta,
          })
        }
        if (trizOnlyResult?.meta) {
          logLlmMeta('triz', trizOnlyResult)
        }
        if (trizOnlyResult.ok && trizOnlyResult.data) {
          const generatedTriz = normalizeTriz(trizOnlyResult.data)
          if (diagnosticsEnabled) {
            console.log('[report:update][triz] normalized', {
              requestId,
              contradictions: generatedTriz?.contradictions?.length ?? 0,
              validationErrors: validateTriz(generatedTriz).errors,
            })
          }
          trizCandidate = mergeTrizKeepingSupportedExisting({
            existingTriz: phaseASanitized.triz,
            generatedTriz,
            supportText: trizSupportCorpus || trizSupportText,
          })
          const preservedCount = Math.max(
            0,
            (trizCandidate?.contradictions?.length || 0) - (generatedTriz?.contradictions?.length || 0)
          )
          console.log('[report:update][step3] triz merge', {
            generated: generatedTriz?.contradictions?.length || 0,
            final: trizCandidate?.contradictions?.length || 0,
            preservedExisting: preservedCount,
          })
          trizValidation = validateTriz(trizCandidate)
          const trizQuality = assessTrizQuality(trizCandidate)
          const hasRichMaterial = representativeItems.length >= 6 || Boolean(trizSupportCorpus && trizSupportCorpus.length >= 200)
          if (trizValidation.ok && trizQuality.lowSubstance && hasRichMaterial) {
            console.log('[report:update][step3] triz retry: low substance', trizQuality)
            const trizRetry = await runTrizOnly(undefined)
            if (trizRetry?.meta) {
              await recordAiUsageBestEffort({
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-triz',
                referenceId: reportRes.data.id ?? null,
                requestId,
                feature: 'report-triz',
                meta: trizRetry.meta,
              })
            }
            if (trizRetry.ok && trizRetry.data) {
              const retryGenerated = normalizeTriz(trizRetry.data)
              const retryMerged = mergeTrizKeepingSupportedExisting({
                existingTriz: phaseASanitized.triz,
                generatedTriz: retryGenerated,
                supportText: trizSupportCorpus || trizSupportText,
              })
              const retryValidation = validateTriz(retryMerged)
              const retryQuality = assessTrizQuality(retryMerged)
              if (retryValidation.ok && !retryQuality.lowSubstance) {
                trizCandidate = retryMerged
                trizValidation = retryValidation
                console.log('[report:update][step3] triz retry accepted', retryQuality)
              } else {
                console.log('[report:update][step3] triz retry rejected', {
                  validationErrors: retryValidation.errors,
                  quality: retryQuality,
                })
              }
            }
          }
        }
        if (forceTrizOnGenerate && !(trizCandidate?.contradictions?.length > 0)) {
          console.log('[report:update][step3] triz retry: empty on generate')
          const trizRetry = await runTrizOnly(undefined, {
            timeoutMs: REPORT_TRIZ_ESCALATION_TIMEOUT_MS,
            forceEscalation: true,
          })
          if (diagnosticsEnabled) {
            console.log('[report:update][triz] retry_empty_on_generate', {
              requestId,
              ok: trizRetry?.ok ?? false,
              hasData: Boolean(trizRetry?.data),
              error: trizRetry?.error ?? null,
              metaTokens: trizRetry?.meta?.tokens ?? null,
            })
          }
          if (trizRetry?.meta) {
            await recordAiUsageBestEffort({
              sessionId: reportRes.data.session_id ?? sessionId,
              reportId: reportRes.data.id ?? null,
              userId,
              actionKey: reportActionKey,
              sourceTask: 'report-triz',
              referenceId: reportRes.data.id ?? null,
              requestId,
              feature: 'report-triz',
              meta: trizRetry.meta,
            })
          }
          if (trizRetry.ok && trizRetry.data) {
            const generatedTriz = normalizeTriz(trizRetry.data)
            trizCandidate = mergeTrizKeepingSupportedExisting({
              existingTriz: phaseASanitized.triz,
              generatedTriz,
              supportText: trizSupportCorpus || trizSupportText,
            })
            trizValidation = validateTriz(trizCandidate)
          }
        }
      } catch (error) {
        console.error('[report:update] triz-only generation exception:', error)
        if (forceTrizOnGenerate) {
          try {
            console.log('[report:update][step3] triz retry after exception: generate')
            const trizRetry = await runTrizOnly(undefined, {
              timeoutMs: REPORT_TRIZ_ESCALATION_TIMEOUT_MS,
              forceEscalation: true,
            })
            if (trizRetry?.meta) {
              await recordAiUsageBestEffort({
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-triz',
                referenceId: reportRes.data.id ?? null,
                requestId,
                feature: 'report-triz',
                meta: trizRetry.meta,
              })
            }
            if (trizRetry.ok && trizRetry.data) {
              const generatedTriz = normalizeTriz(trizRetry.data)
              trizCandidate = mergeTrizKeepingSupportedExisting({
                existingTriz: phaseASanitized.triz,
                generatedTriz,
                supportText: trizSupportCorpus || trizSupportText,
              })
              trizValidation = validateTriz(trizCandidate)
            }
          } catch (retryError) {
            console.error('[report:update] triz-only retry exception:', retryError)
          }
        }
      }

      try {
        const previousHash = String(reportRes.data?.last_summary_text_hash || '')
        const contentHashChanged = Boolean(previousHash && contentHash && previousHash !== contentHash)
        const wantsPlanFromDecisions =
          executionMode === 'plan_from_decisions' || executionMode === 'plan_from_decisions_only'
        const hasDecisions =
          Array.isArray(executionReportCandidate?.decisions) && executionReportCandidate.decisions.length > 0
        const allDecisionsSelected =
          hasDecisions &&
          executionReportCandidate.decisions.every(
            (d) => d?.selected_option === 'a' || d?.selected_option === 'b'
          )
        const contradictionsCount = Array.isArray(trizCandidate?.contradictions)
          ? trizCandidate.contradictions.filter(
              (c) =>
                c &&
                typeof c === 'object' &&
                (String(c.title || '').trim() || String(c.explanation || '').trim())
            ).length
          : 0
        console.log('[report:update][exec] stage_inputs', {
          requestId,
          wantsPlanFromDecisions,
          hasDecisions,
          allDecisionsSelected,
          contentHashChanged,
          contradictionsCount,
        })

        // If the source changed, reset to decisions stage (regenerate + clear selections).
        if (contentHashChanged) {
          if (executionPlanOnly && allDecisionsSelected) {
            console.log('[report:update][exec] finalize_blocked_by_contentHashChanged', {
              requestId,
              sessionId,
              executionMode: executionMode || null,
            })
          }
          const previousExecutionReportCandidate = executionReportCandidate
	          executionReportCandidate = normalizeExecutionReport({
	            ...executionReportDefaults,
	            stage: 'awaiting_decisions',
	            priorities: [],
	            action_plan: [],
	            validation_loop: [],
	            next_session_focus: '',
	            decisions: [],
	            supporting_items: executionSupportingItems,
	            source_snapshot: phaseASanitized.source_snapshot ?? null,
	          }, reportLang)
          executionReportCandidateSource = 'fallback'
          logFinalizeAssignment({
            requestId,
            sessionId,
            assignedFrom: 'fallback',
            reason: 'content hash changed; reset execution report to awaiting decisions',
            previousReport: previousExecutionReportCandidate,
            nextReport: executionReportCandidate,
          })
	        }

        if (wantsPlanFromDecisions) {
          const selectedDecisionsCount = Array.isArray(executionReportCandidate?.decisions)
            ? executionReportCandidate.decisions.filter(
                (d) => d?.selected_option === 'a' || d?.selected_option === 'b'
              ).length
            : 0
          const selectedTrizApproachesCount = Array.isArray(trizCandidate?.contradictions)
            ? trizCandidate.contradictions.reduce((sum, c) => {
                const indices = Array.isArray(c?.selected_approach_indices)
                  ? c.selected_approach_indices
                  : c?.selected_approach_index != null
                    ? [c.selected_approach_index]
                    : []
                return sum + new Set(indices).size
              }, 0)
            : 0
          const hasAnySelections = selectedDecisionsCount > 0 || selectedTrizApproachesCount > 0

          // "Finalize action plan" uses `execution_mode=plan_from_decisions_only`.
          // In that mode, once all decisions are selected, we still want a proper `execution_report.action_plan`
          // generated via the main `report-action-plan` prompt architecture (two-layer plan).
          let previousFinalPlanAttempt = null
          logFinalizeTrace('incoming_existing_execution_report', executionReportCandidate, {
            requestId,
            sessionId,
            sourceLabel: executionReportCandidateSource,
          })
          console.log('[report:update][exec] finalize_gate', {
            requestId,
            executionPlanOnly,
            allDecisionsSelected,
            selectedDecisionsCount,
            selectedTrizApproachesCount,
            hasAnySelections,
          })
          if (executionPlanOnly) {
            const selectedOptions = Array.isArray(executionReportCandidate?.decisions)
              ? executionReportCandidate.decisions.map((d) =>
                  d?.selected_option === 'a' || d?.selected_option === 'b' ? d.selected_option : null
                )
              : []
            console.log('[REPORT FINALIZE DEBUG][backend][finalize-gate]', {
              requestId,
              sessionId,
              execution_mode: executionMode,
              executionPlanOnly,
              allDecisionsSelected,
              decisionsCount: Array.isArray(executionReportCandidate?.decisions)
                ? executionReportCandidate.decisions.length
                : 0,
              selectedOptions,
              contentHashChanged,
              existingStage: executionReportCandidate?.stage ?? null,
              willRunFinalizeGeneration: Boolean(executionPlanOnly && allDecisionsSelected),
              planSkippedReason: allDecisionsSelected ? null : 'DECISIONS_INCOMPLETE',
            })
          }
          if (executionPlanOnly && allDecisionsSelected) {
            try {
              const existingDecisions = Array.isArray(executionReportCandidate?.decisions)
                ? executionReportCandidate.decisions
                : []
              const promptForLen = buildExecutionReportPrompt(true, [])
              logFinalizeTrace('before_report_action_plan_llm_call', executionReportCandidate, {
                requestId,
                sessionId,
                sourceLabel: executionReportCandidateSource,
              })
              console.log('[REPORT FINALIZE DEBUG][backend][before-final-plan-llm]', {
                requestId,
                sessionId,
                task: 'report-action-plan',
                language: llmLanguage,
                analysisJsonExists: Boolean(analysisJson),
                trizCandidateExists: Boolean(trizCandidate),
                selectedApproachesCount: Array.isArray(trizCandidate?.contradictions)
                  ? trizCandidate.contradictions.reduce((sum, c) => {
                      const indices = Array.isArray(c?.selected_approach_indices)
                        ? c.selected_approach_indices
                        : c?.selected_approach_index != null
                          ? [c.selected_approach_index]
                          : []
                      return sum + new Set(indices).size
                    }, 0)
                  : 0,
                supportingItemsCount: Array.isArray(executionSupportingItems) ? executionSupportingItems.length : null,
                decisionsCount: existingDecisions.length,
                promptCharLen: typeof promptForLen === 'string' ? promptForLen.length : null,
              })
              const execResult = await runExecutionReport(undefined, { strictJson: true })
              logActionPlanLlmCallResult('report-action-plan', promptForLen.length, execResult)
              logFinalizeTrace('raw_report_action_plan_llm_result', execResult?.data, {
                requestId,
                sessionId,
                sourceLabel: 'report-action-plan',
              })
              {
                const raw = actionPlanRawResponses.get('report-action-plan')
                const parse = actionPlanParseResults.get('report-action-plan')
                const rawSummary = raw ? summarizeRawOutput(raw.content) : {}
                console.log('[REPORT FINALIZE TRACE][llm][report-action-plan]', {
                  requestId,
                  sessionId,
                  checkpoint: 'raw_report_action_plan_llm_result',
                  task: 'report-action-plan',
                  llmOk: Boolean(execResult?.ok),
                  hasData: Boolean(execResult?.data),
                  model: execResult?.meta?.modelUsed ?? raw?.model ?? null,
                  tokens: execResult?.meta?.tokens ?? null,
                  rawOutputLen: rawSummary.rawOutputLen ?? null,
                  containsRoadmapPhases: rawSummary.containsRoadmapPhases ?? null,
                  containsActionPlan: rawSummary.containsActionPlan ?? null,
                  containsTechnologyOptions: rawSummary.containsTechnologyOptions ?? null,
                  containsDoneWhen: rawSummary.containsDoneWhen ?? null,
                  parseError: parse?.recoveryError || parse?.parseError || null,
                  validationErrors: previousFinalPlanAttempt?.validationErrors ?? null,
                  ...(actionPlanDiagnosticsEnabled && rawSummary.rawOutputPreview
                    ? { rawOutputPreview: rawSummary.rawOutputPreview }
                    : {}),
                })
              }
              const reportActionPlanParse = actionPlanParseResults.get('report-action-plan') || null
              previousFinalPlanAttempt = {
                llmOk: Boolean(execResult?.ok),
                hasData: Boolean(execResult?.data),
                validationErrors: null,
                parseError: reportActionPlanParse?.recoveryError || reportActionPlanParse?.parseError || null,
              }
              if (execResult?.meta) {
                responseMeta.execution_report_action_plan = execResult.meta
                await recordAiUsageBestEffort({
                  sessionId: reportRes.data.session_id ?? sessionId,
                  reportId: reportRes.data.id ?? null,
                  userId,
                  actionKey: reportActionKey,
                  sourceTask: 'report-action-plan',
                  referenceId: reportRes.data.id ?? null,
                  requestId,
                  feature: 'report-action-plan',
                  meta: execResult.meta,
                })
                logLlmMeta('execution-report', execResult)
              }
              if (execResult?.ok && execResult.data && typeof execResult.data === 'object') {
                logFinalizeTrace('parsed_report_action_plan_before_normalization', execResult.data, {
                  requestId,
                  sessionId,
                  sourceLabel: 'report-action-plan',
                })
                logActionPlanDiagnosticShape('before-normalize-report-action-plan', execResult.data, {
                  requestId,
                  sessionId,
                })
                const generated = normalizeExecutionReport(execResult.data, reportLang)
                logFinalizeTrace('after_normalize_report_action_plan_result', generated, {
                  requestId,
                  sessionId,
                  sourceLabel: 'report-action-plan',
                })
                logActionPlanDiagnosticShape('after-normalize-report-action-plan', generated, {
                  requestId,
                  sessionId,
                })
                const allowCompleted = Boolean(
                  Array.isArray(existingNormalized?.execution_report?.action_plan) &&
                    existingNormalized.execution_report.action_plan.some((a) => a?.status === 'completed')
                )
                const generatedWithStatuses = {
                  ...generated,
                  action_plan: initializeActionPlanStatuses(generated.action_plan, { allowCompleted }),
                }
                logFinalizeTrace('after_report_action_plan_status_initialization', generatedWithStatuses, {
                  requestId,
                  sessionId,
                  sourceLabel: 'report-action-plan',
                })
                const previousExecutionReportCandidate = executionReportCandidate
                executionReportCandidate = normalizeExecutionReport({
                  ...executionReportDefaults,
                  ...generatedWithStatuses,
                  stage: 'plan_generated',
                  // Preserve the user's selected decisions (incl. selected_option) as the committed context.
                  decisions: existingDecisions,
                  supporting_items: executionSupportingItems,
                  source_snapshot: phaseASanitized.source_snapshot ?? null,
                }, reportLang)
                executionReportCandidateSource = 'report-action-plan'
                logFinalizeAssignment({
                  requestId,
                  sessionId,
                  assignedFrom: 'report-action-plan',
                  reason: 'report-action-plan llm returned object and passed parse',
                  previousReport: previousExecutionReportCandidate,
                  nextReport: executionReportCandidate,
                })
                logActionPlanDiagnosticShape('after-coerce-final-plan-candidate', executionReportCandidate, {
                  requestId,
                  sessionId,
                })
                const beforeNextFocusExecutionReportCandidate = executionReportCandidate
                executionReportCandidate = ensureExecutionNextSessionFocus(executionReportCandidate, reportLang)
                if (beforeNextFocusExecutionReportCandidate !== executionReportCandidate) {
                  logFinalizeAssignment({
                    requestId,
                    sessionId,
                    assignedFrom: executionReportCandidateSource,
                    reason: 'ensureExecutionNextSessionFocus after report-action-plan',
                    previousReport: beforeNextFocusExecutionReportCandidate,
                    nextReport: executionReportCandidate,
                  })
                }
                logActionPlanDiagnosticShape('after-ensure-next-session-focus-final-plan', executionReportCandidate, {
                  requestId,
                  sessionId,
                })
                executionReportValidation = validateExecutionPlanOnly(executionReportCandidate)
                previousFinalPlanAttempt.validationErrors = executionReportValidation?.errors ?? null
                responseExecution.planGenerated =
                  (Array.isArray(executionReportCandidate?.roadmap_phases) && executionReportCandidate.roadmap_phases.length > 0) ||
                  (Array.isArray(executionReportCandidate?.action_plan) && executionReportCandidate.action_plan.length > 0)
                console.log('[REPORT FINALIZE DEBUG][backend][after-final-plan-llm]', {
                  requestId,
                  sessionId,
                  llmOk: Boolean(execResult?.ok),
                  hasData: Boolean(execResult?.data),
                  normalizedStage: executionReportCandidate?.stage ?? null,
                  prioritiesLen: Array.isArray(executionReportCandidate?.priorities)
                    ? executionReportCandidate.priorities.length
                    : null,
                  roadmapPhasesLen: Array.isArray(executionReportCandidate?.roadmap_phases)
                    ? executionReportCandidate.roadmap_phases.length
                    : null,
                  actionPlanLen: Array.isArray(executionReportCandidate?.action_plan)
                    ? executionReportCandidate.action_plan.length
                    : null,
                  validationLoopLen: Array.isArray(executionReportCandidate?.validation_loop)
                    ? executionReportCandidate.validation_loop.length
                    : null,
                  nextSessionFocus: Boolean(
                    typeof executionReportCandidate?.next_session_focus === 'string' &&
                      executionReportCandidate.next_session_focus.trim()
                  ),
                  validationErrors: executionReportValidation?.errors ?? null,
                  planGenerated: responseExecution.planGenerated,
                })
              } else {
                logFinalizeTrace('parsed_report_action_plan_before_normalization', null, {
                  requestId,
                  sessionId,
                  sourceLabel: 'report-action-plan',
                })
                console.log('[REPORT FINALIZE DEBUG][backend][after-final-plan-llm]', {
                  requestId,
                  sessionId,
                  llmOk: Boolean(execResult?.ok),
                  hasData: Boolean(execResult?.data),
                  normalizedStage: null,
                  prioritiesLen: null,
                  roadmapPhasesLen: null,
                  actionPlanLen: null,
                  validationLoopLen: null,
                  nextSessionFocus: null,
                  validationErrors: null,
                  planGenerated: false,
                })
              }
            } catch (error) {
              console.error('[report:update] execution_report after decisions exception:', error)
            }
          }

          // If we already generated a plan above (finalize path), skip the legacy plan-from-decisions pipeline.
          if (responseExecution.planGenerated) {
            console.log('[report:update][step3] execution_plan_from_decisions_skipped', {
              requestId,
              reason: 'FINALIZED_VIA_REPORT_ACTION_PLAN',
              hasDecisions,
              allDecisionsSelected,
              selectedDecisionsCount,
              selectedTrizApproachesCount,
            })
            // Keep responseExecution.planSkippedReason null: this was not "skipped", it used the main generator.
          } else if (hasAnySelections) {
            const fallbackReason =
              executionPlanOnly && allDecisionsSelected
                ? previousFinalPlanAttempt?.llmOk === false
                  ? 'REPORT_ACTION_PLAN_LLM_FAILED'
                  : previousFinalPlanAttempt?.hasData === false
                    ? 'REPORT_ACTION_PLAN_NO_DATA'
                    : Array.isArray(previousFinalPlanAttempt?.validationErrors) &&
                        previousFinalPlanAttempt.validationErrors.length
                      ? 'REPORT_ACTION_PLAN_VALIDATION_FAILED'
                      : 'REPORT_ACTION_PLAN_DID_NOT_GENERATE_PLAN'
                : 'SELECTIONS_AVAILABLE_WITHOUT_GENERATED_PLAN'
            if (disableExecPlanFallback && executionPlanOnly && allDecisionsSelected) {
              console.log('[REPORT FINALIZE DEBUG][backend][fallback]', {
                requestId,
                sessionId,
                fallbackTriggered: false,
                skipped: true,
                reason: 'DISABLE_EXEC_PLAN_FALLBACK',
                previousLlmOk: previousFinalPlanAttempt?.llmOk ?? null,
                previousHasData: previousFinalPlanAttempt?.hasData ?? null,
                previousValidationErrors: previousFinalPlanAttempt?.validationErrors ?? null,
                previousParseError: previousFinalPlanAttempt?.parseError ?? null,
              })
              if (actionPlanDiagnosticsEnabled && previousFinalPlanAttempt?.llmOk === false) {
                const raw = actionPlanRawResponses.get('report-action-plan')
                const parse = actionPlanParseResults.get('report-action-plan')
                console.log('[REPORT FINALIZE DEBUG][backend][llm-failure-cause]', {
                  requestId,
                  sessionId,
                  task: 'report-action-plan',
                  cause:
                    parse?.recoveryError || parse?.parseError
                      ? 'parse_error'
                      : previousFinalPlanAttempt?.hasData === false
                        ? 'missing_data'
                        : Array.isArray(previousFinalPlanAttempt?.validationErrors) &&
                            previousFinalPlanAttempt.validationErrors.length
                          ? 'validation_error'
                          : 'unknown',
                  parseError: parse?.recoveryError || parse?.parseError || null,
                  validationErrors: previousFinalPlanAttempt?.validationErrors ?? null,
                  missingData: previousFinalPlanAttempt?.hasData === false,
                  modelOutputTruncated: raw ? summarizeRawOutput(raw.content).looksTruncated : null,
                  rawOutputPreview: raw ? summarizeRawOutput(raw.content).rawOutputPreview : null,
                })
              }
              const unchangedReportPayload = {
                id: reportRes.data?.id ?? null,
                session_id: reportRes.data?.session_id ?? sessionId,
                summary_json: reportRes.data?.summary_json ?? null,
                updated_at: reportRes.data?.updated_at ?? null,
                source_updated_at: reportRes.data?.source_updated_at ?? null,
              }
              res.status(200).json({
                ok: false,
                error: 'report_action_plan_failed',
                diagnostics: {
                  reason: 'DISABLE_EXEC_PLAN_FALLBACK',
                  failureReason: fallbackReason,
                  previousLlmOk: previousFinalPlanAttempt?.llmOk ?? null,
                  previousHasData: previousFinalPlanAttempt?.hasData ?? null,
                  validationErrors: previousFinalPlanAttempt?.validationErrors ?? null,
                  parseError: previousFinalPlanAttempt?.parseError ?? null,
                },
                execution_report:
                  reportRes.data?.summary_json?.execution_report &&
                  typeof reportRes.data.summary_json.execution_report === 'object'
                    ? reportRes.data.summary_json.execution_report
                    : null,
                report: unchangedReportPayload,
                planGenerated: false,
                planSkippedReason: 'REPORT_ACTION_PLAN_FAILED_FALLBACK_DISABLED',
                execution: {
                  ...responseExecution,
                  planGenerated: false,
                  planSkippedReason: 'REPORT_ACTION_PLAN_FAILED_FALLBACK_DISABLED',
                },
              })
              return
            } else {
              logFinalizeTrace('before_fallback_to_report_execution_plan_from_decisions', executionReportCandidate, {
                requestId,
                sessionId,
                sourceLabel: executionReportCandidateSource,
              })
              console.log('[REPORT FINALIZE DEBUG][backend][fallback]', {
                requestId,
                sessionId,
                fallbackTriggered: true,
                reason: fallbackReason,
                previousLlmOk: previousFinalPlanAttempt?.llmOk ?? null,
                previousHasData: previousFinalPlanAttempt?.hasData ?? null,
                previousValidationErrors: previousFinalPlanAttempt?.validationErrors ?? null,
                previousParseError: previousFinalPlanAttempt?.parseError ?? null,
              })
              const planPromptForLen = buildExecutionPlanPrompt(true, [])
              const planResult = await runExecutionPlanFromDecisions(undefined, { strictJson: true })
              logActionPlanLlmCallResult(
                'report-execution-plan-from-decisions',
                planPromptForLen.length,
                planResult
              )
              logFinalizeTrace('after_report_execution_plan_from_decisions', planResult?.data, {
                requestId,
                sessionId,
                sourceLabel: 'execution-plan-from-decisions',
              })
            if (planResult?.meta) {
              responseMeta.execution_plan_from_decisions = planResult.meta
              await recordAiUsageBestEffort({
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-execution-plan-from-decisions',
                referenceId: reportRes.data.id ?? null,
                requestId,
                feature: 'report-execution-plan-from-decisions',
                meta: planResult.meta,
              })
              logLlmMeta('execution-plan-from-decisions', planResult)
            }
            const planOk = Boolean(planResult?.ok && planResult.data && typeof planResult.data === 'object')
            if (!planOk) {
              console.log('[report:update][exec] execution-plan-from-decisions invalid; using deterministic repairs', {
                requestId,
                ok: planResult?.ok ?? false,
                hasData: Boolean(planResult?.data),
                error: planResult?.error ?? null,
              })
            }

            {
              const selectedTrizApproaches = Array.isArray(trizCandidate?.contradictions)
                ? trizCandidate.contradictions.flatMap((c, contradiction_index) => {
                    const rendered =
                      Array.isArray(c?.approaches) && c.approaches.length
                        ? c.approaches
                        : Array.isArray(c?.solutions)
                          ? c.solutions
                          : []
                    const indicesRaw = Array.isArray(c?.selected_approach_indices)
                      ? c.selected_approach_indices
                      : c?.selected_approach_index != null
                        ? [c.selected_approach_index]
                        : []
                    const indices = Array.from(
                      new Set(
                        indicesRaw
                          .map((idx) => (typeof idx === 'number' ? idx : Number(idx)))
                          .filter((idx) => Number.isFinite(idx))
                          .map((idx) => Math.max(0, Math.floor(idx)))
                          .filter((idx) => idx >= 0 && idx < rendered.length)
                      )
                    )
                    return indices
                      .map((approach_index) => {
                        const approach = rendered[approach_index]
                        if (!approach) return null
                        return {
                          contradiction_index,
                          contradiction_title: normalizeExecutionText(c?.title),
                          approach_index,
                          approach_title: normalizeExecutionText(approach?.title),
                          approach_description: normalizeExecutionText(approach?.description),
                        }
                      })
                      .filter(Boolean)
                  })
                : []

              const selectedDecisions = Array.isArray(executionReportCandidate?.decisions)
                ? executionReportCandidate.decisions
                    .map((d) => ({
                      tradeoff: normalizeExecutionText(d?.tradeoff),
                      selected: normalizeExecutionSelectedOption(d?.selected_option),
                    }))
                    .filter((d) => d.tradeoff && (d.selected === 'a' || d.selected === 'b'))
                : []

              const requiredChoiceCount = selectedDecisions.length + selectedTrizApproaches.length
              const llmChoiceActionsRaw = planOk && Array.isArray(planResult.data.choice_actions)
                ? planResult.data.choice_actions
                : []
              const llmAnalysisActionsRaw = planOk && Array.isArray(planResult.data.analysis_actions)
                ? planResult.data.analysis_actions
                : []

	              const toActionStep = (value) =>
	                normalizeExecutionText(value?.step || value?.title || value?.task || value?.action || value)
	              const toActionDetails = (value) =>
	                normalizeExecutionText(value?.details || value?.what_to_do || value?.what || value?.do || '')
	              const toDoneWhen = (value) =>
	                normalizeExecutionText(
	                  value?.done_when || value?.doneWhen || value?.success_criteria || value?.success || value?.criteria || ''
	                )

	              const choiceActions = llmChoiceActionsRaw
	                .filter((item) => item && typeof item === 'object')
	                .map((item) => ({
	                  step: toActionStep(item),
	                  details: toActionDetails(item),
	                  done_when: toDoneWhen(item),
	                  technology_options: [],
	                  source_ref: normalizeExecutionText(item?.source_ref),
	                }))
	                .filter((item) => item.step)

	              const analysisActions = llmAnalysisActionsRaw
	                .filter((item) => item && typeof item === 'object')
	                .map((item) => ({
	                  step: toActionStep(item),
	                  details: toActionDetails(item),
	                  done_when: toDoneWhen(item),
	                  technology_options: [],
	                }))
	                .filter((item) => item.step)

	              const looksLikeSourceLabel = (text) =>
	                /^(\s*(decyzja|podejście triz|triz approach|z tablicy|from the board)\s*:)/i.test(String(text || '').trim())

              const sanitizeActionText = (text) => {
                const value = normalizeExecutionText(text)
                if (!value) return ''
                return value.replace(/^(\s*(decyzja|podejście triz|triz approach|z tablicy|from the board)\s*:)\s*/i, '')
              }

	              const inferProductObject = (raw, lang) => {
	                  const text = normalizeExecutionText(raw).toLowerCase()
	                  const asForms = (nom, gen, acc, kind = 'generic') => ({ nom, gen, acc, kind })
	                  const asFormsSame = (value, kind = 'generic') => asForms(value, value, value, kind)
	                  if (lang === 'en') {
	                    if (!text) return null
	                    if (/\b(mocowan|plecak|backpack)\b/.test(text)) return asFormsSame('the backpack mounting system')
	                    if (/\b(skala|oznaczen|marking|markings|indicator)\b/.test(text)) return asFormsSame('the segment marking scale')
	                    if (/\b(materiał|material|aluminium|aluminum|kompozyt|composite|carbon|węgl)\b/.test(text)) {
	                      return asFormsSame('the pole structure material')
	                    }
	                    if (/\b(koszt|produkcj|manufactur|production|cost)\b/.test(text)) {
	                      return asFormsSame('the production cost', 'cost')
	                    }
	                    if (/\b(blokad|zatrzask|mechanizm|lock|latch|segment|długo|length)\b/.test(text)) {
	                      return asFormsSame('the segment locking mechanism')
	                    }
	                    return null
	                  }
	                  // pl
	                  if (!text) return null
	                  if (/\b(mocowan|plecak|backpack)\b/.test(text)) {
	                    return asForms('mocowanie plecakowe', 'mocowania plecakowego', 'mocowanie plecakowe')
	                  }
	                  if (/\b(skala|oznaczen|marking|markings|indicator)\b/.test(text)) {
	                    return asForms('skala oznaczeń segmentów', 'skali oznaczeń segmentów', 'skalę oznaczeń segmentów')
	                  }
	                  if (/\b(materiał|material|aluminium|aluminum|kompozyt|composite|carbon|węgl)\b/.test(text)) {
	                    return asForms('materiał konstrukcji kijków', 'materiału konstrukcji kijków', 'materiał konstrukcji kijków')
	                  }
	                  if (/\b(koszt|produkcj|manufactur|production|cost)\b/.test(text)) {
	                    return asForms('koszt produkcji', 'kosztu produkcji', 'koszt produkcji', 'cost')
	                  }
	                  if (/\b(blokad|zatrzask|mechanizm|lock|latch|segment|długo|length)\b/.test(text)) {
	                    return asForms(
	                      'mechanizm blokady segmentów',
	                      'mechanizmu blokady segmentów',
	                      'mechanizm blokady segmentów'
	                    )
	                  }
	                  return null
	                }

	              const isForbiddenGenericPlaceholder = (text) => {
	                const value = normalizeExecutionText(text).toLowerCase()
	                if (!value) return false
	                if (value.includes('kluczowy element produktu')) return true
	                if (value.includes('element rozwiązania')) return true
	                // "system" without qualifier is too generic (allow e.g. "system mocowania plecakowego")
	                if (/\bsystem\b/.test(value) && !/\bsystem\b.*\b(mocowan|plecak|blokad|zatrzask|segment|oznacze|kijk|pole)\b/.test(value)) {
	                  return true
	                }
	                return false
	              }

	              const doneWhenForVerb = (verb, lang) => {
	                const v = String(verb || '').toLowerCase()
	                if (lang === 'en') {
	                  if (v.startsWith('design')) return 'A solution design is ready.'
	                  if (v.startsWith('build')) return 'A working prototype is ready.'
	                  if (v.startsWith('test')) return 'Test results are collected and assessed.'
	                  if (v.startsWith('estimate')) return 'The production cost is estimated.'
	                  if (v.startsWith('define')) return 'Requirements are written and agreed.'
	                  return 'A concrete deliverable is ready.'
	                }
	                // pl
	                if (v.startsWith('zaprojektuj')) return 'Powstał projekt rozwiązania.'
	                if (v.startsWith('zbuduj')) return 'Działający prototyp jest gotowy.'
	                if (v.startsWith('przetestuj') || v.startsWith('przeprowadź')) return 'Wyniki testu są zebrane i ocenione.'
	                if (v.startsWith('oszacuj')) return 'Oszacowano koszt produkcji.'
	                if (v.startsWith('zdefiniuj')) return 'Wymagania są spisane i uzgodnione.'
	                return 'Powstał konkretny rezultat.'
	              }

	              const tryInferObject = (lang, ...candidates) => {
	                for (const c of candidates) {
	                  const obj = inferProductObject(c, lang)
	                  if (obj) return obj
	                }
	                return null
	              }

	              const buildChoiceRepairActions = () => {
	                const shorten = (value, maxWords = 10) => {
	                  const text = normalizeExecutionText(value).replace(/[“”"']/g, '').trim()
	                  if (!text) return ''
	                  const words = text.split(/\s+/).filter(Boolean)
                  if (words.length <= maxWords) return text
                  return `${words.slice(0, maxWords).join(' ')}…`
                }
                const hashSeed = (value) => {
                  const raw = normalizeQualityKey(value)
                  let h = 0
                  for (let i = 0; i < raw.length; i += 1) {
                    h = (h << 5) - h + raw.charCodeAt(i)
                    h |= 0
                  }
                  return Math.abs(h)
                }
	                const pick = (arr, seed) => arr[seed % arr.length]
		                const decisionMovesPl = [
		                  { verb: 'Zdefiniuj', make: (obj) => `Zdefiniuj wymagania ${obj.gen}` },
		                  { verb: 'Zaprojektuj', make: (obj) => `Zaprojektuj ${obj.acc}` },
		                  { verb: 'Zbuduj', make: (obj) => `Zbuduj prototyp ${obj.gen}` },
		                  { verb: 'Przetestuj', make: (obj) => `Przetestuj ${obj.acc} w terenie` },
		                  {
		                    verb: 'Oszacuj',
		                    make: (obj) => (obj.kind === 'cost' ? 'Oszacuj koszt produkcji rozwiązania' : `Oszacuj koszt ${obj.gen}`),
		                  },
		                ]
		                const decisionMovesEn = [
		                  { verb: 'Define', make: (obj) => `Define requirements for ${obj.acc}` },
		                  { verb: 'Design', make: (obj) => `Design ${obj.acc}` },
		                  { verb: 'Build', make: (obj) => `Build a prototype of ${obj.acc}` },
		                  { verb: 'Test', make: (obj) => `Test ${obj.acc} in real use` },
		                  {
		                    verb: 'Estimate',
		                    make: (obj) => (obj.kind === 'cost' ? 'Estimate the solution production cost' : `Estimate the cost of ${obj.acc}`),
		                  },
		                ]
		                const trizMovesPl = [
		                  { verb: 'Zaprojektuj', make: (obj) => `Zaprojektuj ${obj.acc}` },
		                  { verb: 'Zbuduj', make: (obj) => `Zbuduj prototyp ${obj.gen}` },
		                  { verb: 'Przetestuj', make: (obj) => `Przetestuj ${obj.acc} w użyciu` },
		                  { verb: 'Dobierz', make: (obj) => `Dobierz technologię dla ${obj.gen}` },
		                  { verb: 'Oceń', make: (obj) => `Oceń wykonalność ${obj.gen}` },
		                ]
		                const trizMovesEn = [
		                  { verb: 'Design', make: (obj) => `Design ${obj.acc}` },
		                  { verb: 'Build', make: (obj) => `Build a prototype of ${obj.acc}` },
		                  { verb: 'Test', make: (obj) => `Test ${obj.acc} in use` },
		                  { verb: 'Select', make: (obj) => `Select a technology for ${obj.acc}` },
		                  { verb: 'Evaluate', make: (obj) => `Evaluate feasibility of ${obj.acc}` },
		                ]
		                const items = []
			                selectedDecisions.forEach((d) => {
			                  const seed = hashSeed(`${d.tradeoff}:${String(d.selected)}`)
			                  const obj = tryInferObject(reportLang, d.tradeoff)
			                  if (!obj) return
			                  const moveObj = reportLang === 'en' ? pick(decisionMovesEn, seed) : pick(decisionMovesPl, seed)
			                  const rawStep = moveObj.make(obj)
			                  if (isForbiddenGenericPlaceholder(rawStep)) return
			                  items.push({
			                    step: rewriteStepToImperative(
			                      reportLang === 'en' ? `${rawStep}` : `${rawStep}`,
			                      reportLang
			                    ),
			                    details: '',
			                    technology_options: [],
			                    done_when: doneWhenForVerb(moveObj.verb, reportLang),
			                    source_type: 'decision',
			                    source_ref: `decision:${normalizeQualityKey(d.tradeoff)}:${String(d.selected)}`,
			                    derived_from_user_choice: true,
			                  })
			                })
			                selectedTrizApproaches.forEach((a) => {
		                  const rawLabel = a.approach_title || a.contradiction_title || ''
		                  let labelCandidate = normalizeExecutionText(rawLabel)
		                  if (!labelCandidate) labelCandidate = normalizeExecutionText(a.contradiction_title) || ''
		                  labelCandidate = stripLeadingMetaPrefixes(labelCandidate, reportLang)
		                  // Ensure `label` is a noun-phrase-ish object so move templates don't create double verbs.
		                  if (startsWithImperativeVerb(labelCandidate, reportLang)) {
		                    labelCandidate = labelCandidate.split(/\s+/).slice(1).join(' ').trim()
		                  }
		                  const label = shorten(labelCandidate || rawLabel, 10)
			                  const seed = hashSeed(`triz:${a.contradiction_index}:${a.approach_index}:${label}`)
			                  const moveObj = reportLang === 'en' ? pick(trizMovesEn, seed) : pick(trizMovesPl, seed)
			                  const labelForms = tryInferObject(
			                    reportLang,
			                    label,
			                    a.approach_title,
			                    a.approach_description,
			                    a.contradiction_title
			                  )
			                  if (!labelForms) return
			                  const rawStep = moveObj.make(labelForms)
			                  if (isForbiddenGenericPlaceholder(rawStep)) return
			                  items.push({
			                    step: rewriteStepToImperative(
			                      reportLang === 'en' ? `${rawStep}` : `${rawStep}`,
			                      reportLang
			                    ),
			                    details: '',
			                    technology_options: [],
			                    done_when: doneWhenForVerb(moveObj.verb, reportLang),
			                    source_type: 'triz',
			                    source_ref: `triz:${a.contradiction_index}:${a.approach_index}`,
			                    derived_from_user_choice: true,
			                  })
			                })
	                return items
	              }

		              const buildAnalysisRepairActions = (needed) => {
		                const actions = []
	                const tensions = Array.isArray(analysisJson?.tensions_or_opportunities)
	                  ? analysisJson.tensions_or_opportunities
	                  : []
                const themes = Array.isArray(analysisJson?.key_themes) ? analysisJson.key_themes : []
                const candidates = [...tensions, ...themes].map((x) => normalizeExecutionText(x)).filter(Boolean)
                const base = candidates.length ? candidates : executionSupportingItems.map((i) => normalizeExecutionText(i?.text)).filter(Boolean)
	                const analysisMovesPl = [
	                  { verb: 'Zdefiniuj', make: (obj) => `Zdefiniuj wymagania ${obj.gen}` },
	                  { verb: 'Zaprojektuj', make: (obj) => `Zaprojektuj ${obj.acc}` },
	                  { verb: 'Zbuduj', make: (obj) => `Zbuduj prototyp ${obj.gen}` },
	                  { verb: 'Przetestuj', make: (obj) => `Przetestuj ${obj.acc} w użyciu` },
	                  {
	                    verb: 'Oszacuj',
	                    make: (obj) => (obj.kind === 'cost' ? 'Oszacuj koszt produkcji rozwiązania' : `Oszacuj koszt ${obj.gen}`),
	                  },
	                ]
	                const analysisMovesEn = [
	                  { verb: 'Define', make: (obj) => `Define requirements for ${obj.acc}` },
	                  { verb: 'Design', make: (obj) => `Design ${obj.acc}` },
	                  { verb: 'Build', make: (obj) => `Build a prototype of ${obj.acc}` },
	                  { verb: 'Test', make: (obj) => `Test ${obj.acc} in use` },
	                  {
	                    verb: 'Estimate',
	                    make: (obj) => (obj.kind === 'cost' ? 'Estimate the solution production cost' : `Estimate manufacturing cost for ${obj.acc}`),
	                  },
	                ]
                const shorten = (value, maxWords = 12) => {
                  const text = normalizeExecutionText(value).replace(/[“”"']/g, '').trim()
                  if (!text) return ''
                  const words = text.split(/\s+/).filter(Boolean)
                  if (words.length <= maxWords) return text
                  return `${words.slice(0, maxWords).join(' ')}…`
                }
	                const hashSeed = (value) => {
	                  const raw = normalizeQualityKey(value)
	                  let h = 0
	                  for (let i = 0; i < raw.length; i += 1) {
	                    h = (h << 5) - h + raw.charCodeAt(i)
	                    h |= 0
	                  }
	                  return Math.abs(h)
	                }
	                const pick = (arr, seed) => arr[seed % arr.length]
		                for (let i = 0; i < needed; i += 1) {
			                  const hint = base[i % Math.max(1, base.length)] || ''
			                  const obj =
			                    tryInferObject(reportLang, hint) ||
			                    (reportLang === 'en'
			                      ? { acc: 'the solution', gen: 'the solution', nom: 'solution' }
			                      : { acc: 'rozwiązanie', gen: 'rozwiązania', nom: 'rozwiązanie' })
			                  const seed = hashSeed(`analysis:${i}:${obj.nom}`)
			                  const moveObj = reportLang === 'en' ? pick(analysisMovesEn, seed) : pick(analysisMovesPl, seed)
			                  const rawStep = moveObj.make(obj)
			                  if (isForbiddenGenericPlaceholder(rawStep)) {
			                    actions.push({
			                      step:
			                        reportLang === 'en'
			                          ? 'Review constraints and assumptions for the solution'
			                          : 'Przejrzyj ograniczenia i założenia dla rozwiązania',
			                      details: '',
			                      technology_options: [],
			                      done_when: reportLang === 'en' ? 'Constraints are documented.' : 'Ograniczenia są spisane.',
			                      source_type: 'analysis',
			                      source_ref: `analysis:${i}`,
			                      derived_from_user_choice: false,
			                    })
			                    continue
			                  }
			                  actions.push({
			                    step: rewriteStepToImperative(`${rawStep}`, reportLang),
			                    details: '',
			                    technology_options: [],
			                    done_when: doneWhenForVerb(moveObj.verb, reportLang),
			                    source_type: 'analysis',
			                    source_ref: `analysis:${i}`,
			                    derived_from_user_choice: false,
			                  })
			                }
		                return actions
		              }

	              let finalChoiceActions = choiceActions.map((a, index) => ({
	                step: sanitizeActionText(a.step),
	                details: sanitizeActionText(a.details),
	                technology_options: normalizeExecutionTechnologyOptions(a.technology_options),
	                done_when: sanitizeActionText(a.done_when),
	                source_type: a.source_ref && String(a.source_ref).startsWith('triz:') ? 'triz' : 'decision',
	                source_ref: a.source_ref || `choice:${index}`,
	                derived_from_user_choice: true,
	              }))
	              const usedChoiceRepair =
	                finalChoiceActions.some((a) => looksLikeSourceLabel(a.step)) ||
	                finalChoiceActions.length !== requiredChoiceCount
	              if (
	                finalChoiceActions.some((a) => looksLikeSourceLabel(a.step)) ||
	                finalChoiceActions.length !== requiredChoiceCount
	              ) {
	                finalChoiceActions = buildChoiceRepairActions()
	              }

	              let finalAnalysisActions = analysisActions.map((a, index) => ({
	                step: sanitizeActionText(a.step),
	                details: sanitizeActionText(a.details),
	                technology_options: normalizeExecutionTechnologyOptions(a.technology_options),
	                done_when: sanitizeActionText(a.done_when),
	                source_type: 'analysis',
	                source_ref: `analysis:${index}`,
	                derived_from_user_choice: false,
	              }))
              const usedAnalysisRepair = finalAnalysisActions.length < 3
              if (finalAnalysisActions.length < 3) {
                finalAnalysisActions = [
                  ...finalAnalysisActions,
                  ...buildAnalysisRepairActions(3 - finalAnalysisActions.length),
                ]
              }

	              let forcedActionPlan = [...finalChoiceActions, ...finalAnalysisActions].slice(
	                0,
	                MAX_EXEC_ACTION_PLAN_ITEMS
	              )
	              forcedActionPlan = initializeActionPlanStatuses(forcedActionPlan, { allowCompleted: false })
              logFinalizeTrace('before_report_action_plan_rewrite', {
                ...executionReportCandidate,
                stage: 'plan_generated',
                action_plan: forcedActionPlan,
              }, {
                requestId,
                sessionId,
                sourceLabel: 'execution-plan-from-decisions',
              })

              if (usedChoiceRepair || usedAnalysisRepair) {
                const rewriteReason = [
                  usedChoiceRepair ? 'CHOICE_REPAIR_USED_OR_COUNT_MISMATCH' : null,
                  usedAnalysisRepair ? 'ANALYSIS_REPAIR_USED' : null,
                ].filter(Boolean).join(',')
                console.log('[REPORT FINALIZE DEBUG][backend][rewrite-before]', {
                  requestId,
                  sessionId,
                  rewriteTriggered: !disableActionPlanRewrite,
                  rewriteSkipped: disableActionPlanRewrite,
                  inputActionPlanLen: forcedActionPlan.length,
                  inputRoadmapPhasesLen: Array.isArray(executionReportCandidate?.roadmap_phases)
                    ? executionReportCandidate.roadmap_phases.length
                    : 0,
                  reason: disableActionPlanRewrite ? 'DISABLE_ACTION_PLAN_REWRITE' : rewriteReason,
                })
                const rewriteSampleBefore = normalizeExecutionText(forcedActionPlan?.[0]?.step)
                if (disableActionPlanRewrite) {
                  logFinalizeTrace('rewrite_skipped_by_env', {
                    ...executionReportCandidate,
                    stage: 'plan_generated',
                    action_plan: forcedActionPlan,
                  }, {
                    requestId,
                    sessionId,
                    sourceLabel: 'execution-plan-from-decisions',
                  })
                  console.log('[REPORT FINALIZE DEBUG][backend][rewrite-skipped]', {
                    requestId,
                    sessionId,
                    reason: 'DISABLE_ACTION_PLAN_REWRITE',
                    inputActionPlanLen: forcedActionPlan.length,
                    inputRoadmapPhasesLen: Array.isArray(executionReportCandidate?.roadmap_phases)
                      ? executionReportCandidate.roadmap_phases.length
                      : 0,
                    sampleBefore: rewriteSampleBefore,
                  })
                } else {
                try {
                  const rewritePromptForLen = buildActionPlanRewritePrompt(forcedActionPlan)
                  const forcedActionPlanBeforeRewrite = forcedActionPlan
                  const rewriteResult = await runActionPlanRewrite(forcedActionPlan, { strictJson: true })
                  logActionPlanLlmCallResult(
                    'report-action-plan-rewrite',
                    rewritePromptForLen.length,
                    rewriteResult
                  )
                  if (rewriteResult?.meta) {
                    responseMeta.action_plan_rewrite = rewriteResult.meta
                    await recordAiUsageBestEffort({
                      sessionId: reportRes.data.session_id ?? sessionId,
                      reportId: reportRes.data.id ?? null,
                      userId,
                      actionKey: reportActionKey,
                      sourceTask: 'report-action-plan-rewrite',
                      referenceId: reportRes.data.id ?? null,
                      requestId,
                      feature: 'report-action-plan-rewrite',
                      meta: rewriteResult.meta,
                    })
                    logLlmMeta('action-plan-rewrite', rewriteResult)
                  }
	                  if (
	                    rewriteResult?.ok &&
	                    Array.isArray(rewriteResult.data) &&
	                    rewriteResult.data.length === forcedActionPlan.length
	                  ) {
	                    const rewritten = rewriteResult.data
	                      .map((item, index) => ({
	                        ...forcedActionPlan[index],
	                        step: sanitizeActionText(normalizeExecutionText(item?.step)),
	                        status: normalizeExecutionStatus(item?.status || forcedActionPlan[index]?.status),
	                        details: sanitizeActionText(normalizeExecutionText(item?.details)),
	                        technology_options: normalizeExecutionTechnologyOptions(item?.technology_options),
	                        done_when: sanitizeActionText(normalizeExecutionText(item?.done_when)),
	                      }))
	                      .filter((item) => normalizeExecutionText(item?.step))
	                    if (rewritten.length === forcedActionPlan.length) {
	                      forcedActionPlan = rewritten
	                    }
	                  }
                  logFinalizeTrace('after_report_action_plan_rewrite', {
                    ...executionReportCandidate,
                    stage: 'plan_generated',
                    action_plan: forcedActionPlan,
                  }, {
                    requestId,
                    sessionId,
                    sourceLabel: 'action-plan-rewrite',
                  })
                  if (forcedActionPlanBeforeRewrite !== forcedActionPlan) {
                    logFinalizeAssignment({
                      requestId,
                      sessionId,
                      assignedFrom: 'action-plan-rewrite',
                      reason: 'rewrite replaced forcedActionPlan before executionReportCandidate assignment',
                      previousReport: {
                        ...executionReportCandidate,
                        stage: 'plan_generated',
                        action_plan: forcedActionPlanBeforeRewrite,
                      },
                      nextReport: {
                        ...executionReportCandidate,
                        stage: 'plan_generated',
                        action_plan: forcedActionPlan,
                      },
                    })
                  }
                  console.log('[REPORT FINALIZE DEBUG][backend][rewrite-after]', {
                    requestId,
                    sessionId,
                    outputActionPlanLen: forcedActionPlan.length,
                    outputRoadmapPhasesLen: Array.isArray(executionReportCandidate?.roadmap_phases)
                      ? executionReportCandidate.roadmap_phases.length
                      : 0,
                    sampleBefore: rewriteSampleBefore,
                    sampleAfter: normalizeExecutionText(forcedActionPlan?.[0]?.step),
                  })
                } catch (error) {
                  console.error('[report:update] action-plan-rewrite exception:', error)
                }
                }
              }

              logActionPlanDiagnosticShape('before-normalize-plan-from-decisions', {
                ...executionReportDefaults,
                ...executionReportCandidate,
                stage: 'plan_generated',
                priorities: planOk && Array.isArray(planResult.data.priorities) ? planResult.data.priorities : [],
                action_plan: forcedActionPlan,
                validation_loop:
                  planOk && Array.isArray(planResult.data.validation_loop) ? planResult.data.validation_loop : [],
                next_session_focus: planOk ? normalizeExecutionText(planResult.data.next_session_focus) : '',
                supporting_items: executionSupportingItems,
                source_snapshot: phaseASanitized.source_snapshot ?? null,
              }, {
                requestId,
                sessionId,
              })
              const previousExecutionReportCandidate = executionReportCandidate
	              executionReportCandidate = normalizeExecutionReport({
	                ...executionReportDefaults,
	                ...executionReportCandidate,
	                stage: 'plan_generated',
	                priorities: planOk && Array.isArray(planResult.data.priorities) ? planResult.data.priorities : [],
	                action_plan: forcedActionPlan,
                validation_loop:
                  planOk && Array.isArray(planResult.data.validation_loop) ? planResult.data.validation_loop : [],
                next_session_focus: planOk ? normalizeExecutionText(planResult.data.next_session_focus) : '',
                supporting_items: executionSupportingItems,
	                source_snapshot: phaseASanitized.source_snapshot ?? null,
	              }, reportLang)
              executionReportCandidateSource =
                usedChoiceRepair || usedAnalysisRepair
                  ? disableActionPlanRewrite
                    ? 'execution-plan-from-decisions'
                    : 'action-plan-rewrite'
                  : 'execution-plan-from-decisions'
              logFinalizeAssignment({
                requestId,
                sessionId,
                assignedFrom: executionReportCandidateSource,
                reason: 'legacy fallback pipeline normalized forcedActionPlan into executionReportCandidate',
                previousReport: previousExecutionReportCandidate,
                nextReport: executionReportCandidate,
              })
              logFinalizeTrace('after_execution_plan_from_decisions_candidate_assignment', executionReportCandidate, {
                requestId,
                sessionId,
                sourceLabel: executionReportCandidateSource,
              })
              logActionPlanDiagnosticShape('after-normalize-plan-from-decisions', executionReportCandidate, {
                requestId,
                sessionId,
              })
              const beforePlanFromDecisionsFocus = executionReportCandidate
              executionReportCandidate = ensureExecutionNextSessionFocus(executionReportCandidate, reportLang)
              if (beforePlanFromDecisionsFocus !== executionReportCandidate) {
                logFinalizeAssignment({
                  requestId,
                  sessionId,
                  assignedFrom: executionReportCandidateSource,
                  reason: 'ensureExecutionNextSessionFocus after execution-plan-from-decisions',
                  previousReport: beforePlanFromDecisionsFocus,
                  nextReport: executionReportCandidate,
                })
              }
              logActionPlanDiagnosticShape('after-ensure-next-session-focus-plan-from-decisions', executionReportCandidate, {
                requestId,
                sessionId,
              })
              executionReportValidation = validateExecutionPlanOnly(executionReportCandidate)
              responseExecution.planGenerated = true
            }
            }
          } else {
            console.log('[report:update][step3] execution_plan_from_decisions_skipped', {
              hasDecisions,
              allDecisionsSelected,
              selectedDecisionsCount,
              selectedTrizApproachesCount,
            })
            responseExecution.planGenerated = false
            responseExecution.planSkippedReason = 'NO_SELECTIONS'
          }
        } else {
          if (!hasDecisions) {
            const decisionsResult = await runExecutionDecisionsOnly(undefined, { strictJson: true })
            console.log('[report:update][exec] decisions_llm_result', {
              requestId,
              ok: decisionsResult?.ok ?? false,
              hasData: Array.isArray(decisionsResult?.data),
              dataLen: Array.isArray(decisionsResult?.data) ? decisionsResult.data.length : null,
              error: decisionsResult?.error ?? null,
              metaTokens: decisionsResult?.meta?.tokens ?? null,
            })
            if (decisionsResult?.meta) {
              await recordAiUsageBestEffort({
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-execution-decisions',
                referenceId: reportRes.data.id ?? null,
                requestId,
                feature: 'report-execution-decisions',
                meta: decisionsResult.meta,
              })
              logLlmMeta('execution-decisions', decisionsResult)
            }
            if (decisionsResult?.ok && Array.isArray(decisionsResult.data)) {
	              executionReportCandidate = normalizeExecutionReport({
	                ...executionReportDefaults,
	                stage: 'awaiting_decisions',
	                priorities: [],
	                action_plan: [],
	                validation_loop: [],
	                next_session_focus: '',
	                decisions: decisionsResult.data.map((d) => ({ ...d, selected_option: null })),
	                supporting_items: executionSupportingItems,
	                source_snapshot: phaseASanitized.source_snapshot ?? null,
	              }, reportLang)
              executionReportValidation = validateExecutionDecisionsOnly(executionReportCandidate, {
                contradictionsCount,
              })
              console.log('[report:update][exec] decisions_validation', {
                requestId,
                ok: executionReportValidation.ok,
                errors: executionReportValidation.errors,
                contradictionsCount,
                decisionsCount: Array.isArray(executionReportCandidate?.decisions)
                  ? executionReportCandidate.decisions.length
                  : null,
              })
            } else {
              console.log('[report:update][step3] execution_decisions_only_invalid', {
                ok: decisionsResult?.ok ?? false,
                hasData: Boolean(decisionsResult?.data),
                error: decisionsResult?.error ?? null,
                metaTokens: decisionsResult?.meta?.tokens ?? null,
              })
            }
          } else if (executionReportCandidate.stage !== 'plan_generated') {
	            executionReportCandidate = normalizeExecutionReport({
	              ...executionReportDefaults,
	              ...executionReportCandidate,
	              stage: 'awaiting_decisions',
	              supporting_items: executionSupportingItems,
	              source_snapshot: phaseASanitized.source_snapshot ?? null,
	            }, reportLang)
            executionReportValidation = validateExecutionDecisionsOnly(executionReportCandidate, {
              contradictionsCount,
            })
            console.log('[report:update][exec] decisions_existing_validation', {
              requestId,
              ok: executionReportValidation.ok,
              errors: executionReportValidation.errors,
              contradictionsCount,
              decisionsCount: Array.isArray(executionReportCandidate?.decisions)
                ? executionReportCandidate.decisions.length
                : null,
            })
          }
        }
      } catch (error) {
        console.error('[report:update] execution_report 2-stage exception:', error)
      }

      logSummaryLengths('generated', summaryCandidate)

      const fallbackSummary = (() => {
        const topic = typeof analysisJson?.topic === 'string' ? analysisJson.topic.trim() : ''
        if (reportLang === 'en') {
          const topicSuffix = topic ? ` around ${topic}` : ''
          return {
            headline: `A promising direction is taking shape${topicSuffix}.`,
            narrative:
              'The material suggests a product direction, but it still needs sharper signals about user priorities, tensions, and decision criteria. Add a bit more detail to make the next iteration more concrete and strategically useful.',
            today: `A product direction is emerging${topicSuffix}.`,
            change: 'Add more detail about needs, tensions, and constraints to sharpen the direction.',
            product: topic || '',
          }
        }
        const topicSuffix = topic ? ` wokół obszaru: ${topic}` : ''
        return {
          headline: `Wyłania się obiecujący kierunek produktu${topicSuffix}.`,
          narrative:
            'W materiale widać zalążek sensownego kierunku, ale potrzeba jeszcze wyraźniejszych sygnałów dotyczących potrzeb, napięć i kryteriów decyzji. Dodaj trochę więcej konkretu, aby kolejne podsumowanie było bardziej użyteczne i produktowo trafne.',
          today: `Wyłania się kierunek produktu${topicSuffix}.`,
          change:
            'Dodaj więcej konkretów o potrzebach, napięciach i ograniczeniach, aby doprecyzować kierunek.',
          product: topic || '',
        }
      })()
      const insufficientSummaryPattern =
        reportLang === 'en'
          ? /not enough data|insufficient data|no (direct )?information|no entries|cannot generate/i
          : /brak wystarczających danych|brak informacji|brak wpisów|zbyt mało informacji/i
      const hasUsableExistingSummary =
        validateSummary(phaseASanitized.summary, itemsFromDb.length, reportLang).ok ||
        (
          typeof phaseASanitized.summary?.today === 'string' &&
          phaseASanitized.summary.today.trim().length >= 30 &&
          typeof phaseASanitized.summary?.change === 'string' &&
          phaseASanitized.summary.change.trim().length >= 30 &&
          !insufficientSummaryPattern.test(phaseASanitized.summary.today) &&
          !insufficientSummaryPattern.test(phaseASanitized.summary.change)
        )
      const finalSummary = executionPlanOnly
        ? phaseASanitized.summary
        : summaryValidation.ok
          ? summaryCandidate
          : hasUsableExistingSummary
            ? phaseASanitized.summary
            : fallbackSummary
      if (!executionPlanOnly) {
        if (!summaryValidation.ok) {
          console.log('[report:update][step3] summary fallback', summaryValidation.errors)
        }
        logSummaryLengths('final', finalSummary)
        console.log(
          '[report:update][step3] summary overwrite',
          summaryValidation.ok ? 'generated' : hasUsableExistingSummary ? 'existing' : 'fallback'
        )
      }
      const finalRecommendations = executionPlanOnly
        ? phaseASanitized.recommendations
        : recValidation.ok
          ? recommendationsCandidate
          : { based_on_user_ideas: [], morphological: [], market_trends: [] }
      if (!executionPlanOnly && !recValidation.ok) {
        console.log('[report:update][step3] recommendations fallback', recValidation.errors)
      }
      let finalTrizResolved = executionPlanOnly
        ? normalizeTriz(phaseASanitized.triz)
        : (() => {
            const finalTriz = trizValidation.ok ? trizCandidate : normalizeTriz(phaseASanitized.triz)
            if (!trizValidation.ok) {
              const coerced = coerceTrizToValid(trizCandidate)
              const coercedValidation = validateTriz(coerced)
              if (coercedValidation.ok) {
                console.log('[report:update][step3] triz fallback coerced', trizValidation.errors)
                trizCandidate = coerced
                trizValidation = coercedValidation
              } else {
                console.log('[report:update][step3] triz fallback', trizValidation.errors)
              }
            }
            return trizValidation.ok ? trizCandidate : finalTriz
          })()
	      const existingExecutionReport = phaseASanitized.execution_report
	        ? normalizeExecutionReport(phaseASanitized.execution_report, reportLang)
	        : null
      const existingExecutionValidation =
        existingExecutionReport?.stage === 'plan_generated'
          ? validateExecutionPlanOnly(existingExecutionReport)
          : validateExecutionDecisionsOnly(existingExecutionReport)
      const hasUsableExistingExecutionReport = isExecutionReportUsable(existingExecutionReport)
      const existingExecutionPersistable = getExecutionReportPersistableStats(existingExecutionReport)
      const existingDecisionOptions = countDecisionOptions(existingExecutionReport)
      console.log('[report:update][step3] existing action-plan usability', {
        usable: hasUsableExistingExecutionReport,
        persistable: existingExecutionPersistable,
        decisionOptions: existingDecisionOptions,
        validationErrors: existingExecutionValidation.errors,
        stage: existingExecutionReport?.stage ?? null,
      })
      const generatedExecutionPersistable = getExecutionReportPersistableStats(executionReportCandidate)
      logActionPlanDiagnosticShape('before-save-selection-generated-candidate', executionReportCandidate, {
        requestId,
        sessionId,
      })
      const generatedDecisionOptions = countDecisionOptions(executionReportCandidate)
      const generatedExecutionValidation =
        executionReportCandidate?.stage === 'plan_generated'
          ? validateExecutionPlanOnly(executionReportCandidate)
          : validateExecutionDecisionsOnly(executionReportCandidate)
      const headlineFallback =
        normalizeExecutionText(existingExecutionReport?.headline) ||
        normalizeExecutionText(summaryCandidate?.headline) ||
        normalizeExecutionText(phaseASanitized.summary?.headline) ||
        (reportLang === 'en'
          ? 'A lean action plan is emerging from the current material.'
          : 'Z obecnego materiału wyłania się zwięzły plan działania.')
      const generatedExecutionReadyForSave = Boolean(
        generatedExecutionValidation.ok &&
          (executionReportCandidate?.stage === 'plan_generated'
            ? generatedExecutionPersistable.sectionsWithMeaningfulContent >= 2
            : Array.isArray(executionReportCandidate?.decisions) && executionReportCandidate.decisions.length > 0)
      )
      logFinalizeTrace('after_lean_persistability_checks', executionReportCandidate, {
        requestId,
        sessionId,
        sourceLabel: executionReportCandidateSource,
      })
      console.log('[REPORT FINALIZE TRACE][persistability]', {
        requestId,
        sessionId,
        checkpoint: 'after_lean_persistability_checks',
        generatedExecutionReadyForSave,
        generatedExecutionValidation,
        generatedExecutionPersistable,
        hasUsableExistingExecutionReport,
        existingExecutionPersistable,
      })
      let finalExecutionReport = null
      let actionPlanDecision = 'execution_report_lean_not_persisted_empty_fallback'
	      if (generatedExecutionReadyForSave) {
        const previousFinalExecutionReport = finalExecutionReport
	        finalExecutionReport = normalizeExecutionReport(
	          executionReportCandidate?.stage === 'plan_generated'
	            ? ensureExecutionNextSessionFocus(
                {
                  ...executionReportCandidate,
                  headline: normalizeExecutionText(executionReportCandidate?.headline) || headlineFallback,
                  supporting_items: executionSupportingItems,
                  source_snapshot: phaseASanitized.source_snapshot ?? null,
                },
                reportLang
              )
            : {
                ...executionReportCandidate,
                headline: normalizeExecutionText(executionReportCandidate?.headline) || headlineFallback,
                supporting_items: executionSupportingItems,
                source_snapshot: phaseASanitized.source_snapshot ?? null,
	              }
	        , reportLang)
        finalExecutionReportSource = executionReportCandidateSource
        logFinalizeAssignment({
          requestId,
          sessionId,
          assignedFrom: finalExecutionReportSource,
          reason: 'generated execution report passed lean persistability checks',
          previousReport: previousFinalExecutionReport,
          nextReport: finalExecutionReport,
        })
        logFinalizeTrace('final_execution_report_selected_for_save', finalExecutionReport, {
          requestId,
          sessionId,
          sourceLabel: finalExecutionReportSource,
        })
        logActionPlanDiagnosticShape('after-normalize-final-execution-report', finalExecutionReport, {
          requestId,
          sessionId,
        })
        const finalDecisionOptions = countDecisionOptions(finalExecutionReport)
        const existingOptionTotal = (existingDecisionOptions.optionA || 0) + (existingDecisionOptions.optionB || 0)
        const finalOptionTotal = (finalDecisionOptions.optionA || 0) + (finalDecisionOptions.optionB || 0)
        actionPlanDecision =
          executionReportCandidate?.stage === 'plan_generated'
            ? finalOptionTotal > existingOptionTotal
              ? 'execution_report_plan_saved'
              : 'execution_report_plan_saved'
            : finalOptionTotal > existingOptionTotal
              ? 'execution_report_decisions_saved'
              : 'execution_report_decisions_saved'
        console.log('[report:update][step3] execution_report_lean_generated', generatedExecutionPersistable)
        console.log('[report:update][step3] execution_report_lean_saved', {
          decisionOptions: finalDecisionOptions,
          stage: executionReportCandidate?.stage ?? null,
        })
      } else if (hasUsableExistingExecutionReport) {
        const previousFinalExecutionReport = finalExecutionReport
	        finalExecutionReport = normalizeExecutionReport(
          existingExecutionReport?.stage === 'plan_generated'
            ? ensureExecutionNextSessionFocus(
                {
                  ...existingExecutionReport,
                  supporting_items: executionSupportingItems,
                  source_snapshot: phaseASanitized.source_snapshot ?? null,
                },
                reportLang
              )
            : {
                ...existingExecutionReport,
                supporting_items: executionSupportingItems,
                source_snapshot: phaseASanitized.source_snapshot ?? null,
	              }
	        , reportLang)
        finalExecutionReportSource = 'existing'
        logFinalizeAssignment({
          requestId,
          sessionId,
          assignedFrom: 'existing',
          reason: 'generated execution report was not ready for save; preserving usable existing report',
          previousReport: previousFinalExecutionReport,
          nextReport: finalExecutionReport,
        })
        logFinalizeTrace('final_execution_report_selected_for_save', finalExecutionReport, {
          requestId,
          sessionId,
          sourceLabel: finalExecutionReportSource,
        })
        logActionPlanDiagnosticShape('after-preserve-existing-execution-report', finalExecutionReport, {
          requestId,
          sessionId,
        })
        actionPlanDecision = 'execution_report_lean_preserved_existing_only_if_new_not_persistable'
        console.log('[report:update][step3] execution_report_lean_preserved_existing_only_if_new_not_persistable')
      } else if (!generatedExecutionPersistable.persistable) {
        console.log('[report:update][step3] execution_report_lean_discarded_below_threshold', {
          validationErrors: generatedExecutionValidation.errors,
          persistable: generatedExecutionPersistable,
        })
        actionPlanDecision = 'execution_report_lean_discarded_below_threshold'
        console.log('[report:update][step3] execution_report_lean_not_persisted_empty_fallback')
      }
	      if (!generatedExecutionValidation.ok) {
	        console.log('[report:update][step3] execution_report fallback', generatedExecutionValidation.errors)
	      }

	      if (finalExecutionReport && diagnosticsEnabled) {
	        const diag = diagnoseExecutionActionPlan(finalExecutionReport.action_plan, reportLang)
	        console.log('[report:update][diagnostics] action_plan_quality', {
	          requestId,
	          reportLang,
	        actionPlanLen: Array.isArray(finalExecutionReport?.action_plan)
	          ? finalExecutionReport.action_plan.length
	          : null,
	        roadmapPhasesLen: Array.isArray(finalExecutionReport?.roadmap_phases)
	          ? finalExecutionReport.roadmap_phases.length
	          : null,
	          ...diag,
	        })
	      }

      const decisionsForEnrichment = Array.isArray(finalExecutionReport?.decisions)
        ? finalExecutionReport.decisions.filter(
            (item) =>
              normalizeExecutionText(item?.tradeoff) &&
              (
                normalizeExecutionText(item?.option_a) ||
                normalizeExecutionText(item?.option_b)
              ) &&
              (
                !normalizeExecutionText(item?.consequence_a) ||
                !normalizeExecutionText(item?.consequence_b)
              )
          )
        : []
      console.log('[report:update][step3] decisions-enrich input', {
        total: decisionsForEnrichment.length,
      })
      if (finalExecutionReport && decisionsForEnrichment.length) {
        try {
          const decisionsEnrichResult = await runDecisionEnrichment(decisionsForEnrichment)
          if (decisionsEnrichResult?.meta) {
            await recordAiUsageBestEffort({
              sessionId: reportRes.data.session_id ?? sessionId,
              reportId: reportRes.data.id ?? null,
              userId,
              actionKey: reportActionKey,
              sourceTask: 'report-decisions-enrich',
              referenceId: reportRes.data.id ?? null,
              requestId,
              feature: 'report-action-plan',
              meta: decisionsEnrichResult.meta,
            })
            logLlmMeta('decisions-enrich', decisionsEnrichResult)
          }
          if (decisionsEnrichResult?.ok && Array.isArray(decisionsEnrichResult.data)) {
	            const enrichedExecutionReport = mergeDecisionConsequences(
	              finalExecutionReport,
	              decisionsEnrichResult.data,
	              reportLang
	            )
            const enrichmentCoverage = countDecisionOptions(enrichedExecutionReport)
            console.log('[report:update][step3] decisions-enrich output', {
              input: decisionsForEnrichment.length,
              withConsequenceA: enrichmentCoverage.consequenceA,
              withConsequenceB: enrichmentCoverage.consequenceB,
            })
            const improvedConsequenceCount =
              (enrichmentCoverage.consequenceA || 0) + (enrichmentCoverage.consequenceB || 0)
            const previousConsequenceCount =
              (countDecisionOptions(finalExecutionReport).consequenceA || 0) +
              (countDecisionOptions(finalExecutionReport).consequenceB || 0)
            if (improvedConsequenceCount > previousConsequenceCount) {
              const previousFinalExecutionReport = finalExecutionReport
              finalExecutionReport = enrichedExecutionReport
              logFinalizeAssignment({
                requestId,
                sessionId,
                assignedFrom: finalExecutionReportSource || 'unknown',
                reason: 'decision consequence enrichment improved existing finalExecutionReport',
                previousReport: previousFinalExecutionReport,
                nextReport: finalExecutionReport,
              })
              console.log('[report:update][step3] decisions-enrich merge saved', {
                input: decisionsForEnrichment.length,
                withConsequenceA: enrichmentCoverage.consequenceA,
                withConsequenceB: enrichmentCoverage.consequenceB,
              })
            } else {
              console.log('[report:update][step3] decisions-enrich merge skipped', {
                input: decisionsForEnrichment.length,
                withConsequenceA: enrichmentCoverage.consequenceA,
                withConsequenceB: enrichmentCoverage.consequenceB,
              })
            }
          } else {
            console.log('[report:update][step3] decisions-enrich invalid', {
              ok: decisionsEnrichResult?.ok ?? false,
              hasData: Boolean(decisionsEnrichResult?.data),
              error: decisionsEnrichResult?.error ?? null,
              metaTokens: decisionsEnrichResult?.meta?.tokens ?? null,
            })
          }
        } catch (error) {
          console.error('[report:update] decisions-enrich exception:', error)
        }
      }

      const looksLikeChecklistActionPlan = (actionPlan, lang) => {
        const items = Array.isArray(actionPlan) ? actionPlan : []
        if (items.length < 3) return false
        const verbsPl = ['zaprojektuj', 'zdefiniuj', 'przeprowadź', 'przetestuj', 'zbuduj', 'zweryfikuj', 'oszacuj', 'dobierz']
        const verbsEn = ['design', 'define', 'run', 'test', 'build', 'validate', 'estimate', 'compare', 'select']
        const verbs = lang === 'pl' ? verbsPl : verbsEn
        const hits = items.filter((x) => {
          const step = normalizeExecutionText(x?.step || x?.title).toLowerCase()
          if (!step) return false
          return verbs.some((v) => step.startsWith(v + ' ') || step === v)
        }).length
        return hits >= Math.ceil(items.length * 0.6)
      }

      const buildFallbackRoadmapFromActionPlan = (actionPlan, lang) => {
        const items = (Array.isArray(actionPlan) ? actionPlan : [])
          .map((item) => ({
            text: normalizeExecutionText(item?.details || item?.step || item?.title),
            validation_gate: normalizeExecutionText(item?.done_when),
          }))
          .filter((item) => item.text || item.validation_gate)
        if (!items.length) return []
        const titles =
          lang === 'en'
            ? ['Reduce the riskiest unknowns', 'Build and compare the first solution slice', 'Validate use and execution constraints', 'Decide what is ready to commit']
            : ['Ogranicz najważniejsze niewiadome', 'Zbuduj i porównaj pierwszy wariant rozwiązania', 'Sprawdź użycie oraz ograniczenia wykonawcze', 'Podejmij decyzję, co warto rozwijać dalej']
        const chunks = []
        const targetCount = Math.min(4, Math.max(3, Math.ceil(items.length / 3)))
        for (let i = 0; i < targetCount; i += 1) {
          const start = Math.floor((items.length * i) / targetCount)
          const end = Math.floor((items.length * (i + 1)) / targetCount)
          const actions = items.slice(start, Math.max(start + 1, end))
          if (!actions.length) continue
          chunks.push({
            phase_title: titles[i] || (lang === 'en' ? `Phase ${i + 1} — reduce the next uncertainty` : `Etap ${i + 1} — ogranicz kolejną niewiadomą`),
            why_this_phase_matters:
              lang === 'en'
                ? 'This phase keeps the roadmap tied to evidence and prevents the work from becoming generic product progress.'
                : 'Ten etap utrzymuje roadmapę przy dowodach i zapobiega zamianie pracy w ogólny postęp produktowy.',
            key_risk_or_tradeoff:
              lang === 'en'
                ? 'The main risk is committing to a direction before the next technical or product uncertainty has been checked.'
                : 'Główne ryzyko to wejście w kierunek, zanim sprawdzona zostanie kolejna niewiadoma techniczna lub produktowa.',
            concrete_actions: actions
              .map((item) => [item.text, item.validation_gate].filter(Boolean).join(' — '))
              .filter(Boolean)
              .slice(0, 4),
            validation_or_test:
              lang === 'en'
                ? 'Compare the produced evidence against the phase actions and note which assumptions were confirmed, weakened, or still unresolved.'
                : 'Porównaj zebrane dowody z działaniami etapu i zanotuj, które założenia się potwierdziły, osłabły albo nadal są nierozstrzygnięte.',
            decision_unlocked:
              lang === 'en'
                ? 'Move on only after the evidence is strong enough to choose the next build direction.'
                : 'Przejdź dalej dopiero wtedy, gdy zebrane dowody pozwalają wybrać kolejny kierunek budowy.',
          })
        }
        return chunks
      }

      if (
        finalExecutionReport &&
        !(Array.isArray(finalExecutionReport.roadmap_phases) && finalExecutionReport.roadmap_phases.length > 0) &&
        Array.isArray(finalExecutionReport.action_plan) &&
        finalExecutionReport.action_plan.length > 0
      ) {
        try {
          logFinalizeTrace('before_roadmap_from_action_plan', finalExecutionReport, {
            requestId,
            sessionId,
            sourceLabel: finalExecutionReportSource,
          })
          const roadmapPromptForLen = buildRoadmapFromActionPlanPrompt(finalExecutionReport.action_plan, {
            headline: finalExecutionReport.headline,
            goal: finalExecutionReport.goal,
            decisions: finalExecutionReport.decisions,
            triz: finalTrizResolved,
            supporting_items: finalExecutionReport.supporting_items,
          })
          const roadmapRes = await runRoadmapFromActionPlan(finalExecutionReport.action_plan, {
            context: {
              headline: finalExecutionReport.headline,
              goal: finalExecutionReport.goal,
              decisions: finalExecutionReport.decisions,
              triz: finalTrizResolved,
              supporting_items: finalExecutionReport.supporting_items,
            },
          })
          logActionPlanLlmCallResult(
            'report-action-plan-roadmap',
            roadmapPromptForLen.length,
            roadmapRes
          )
          if (roadmapRes?.ok && Array.isArray(roadmapRes.data)) {
            const previousFinalExecutionReport = finalExecutionReport
            finalExecutionReport = normalizeExecutionReport(
              { ...finalExecutionReport, roadmap_phases: roadmapRes.data },
              reportLang
            )
            finalExecutionReportSource = 'fallback'
            logFinalizeAssignment({
              requestId,
              sessionId,
              assignedFrom: 'fallback',
              reason: 'roadmap-from-action-plan llm added roadmap_phases to legacy action_plan',
              previousReport: previousFinalExecutionReport,
              nextReport: finalExecutionReport,
            })
            logActionPlanDiagnosticShape('after-roadmap-from-action-plan-llm', finalExecutionReport, {
              requestId,
              sessionId,
            })
          } else {
            const previousFinalExecutionReport = finalExecutionReport
            finalExecutionReport = normalizeExecutionReport(
              {
                ...finalExecutionReport,
                roadmap_phases: buildFallbackRoadmapFromActionPlan(finalExecutionReport.action_plan, reportLang),
              },
              reportLang
            )
            finalExecutionReportSource = 'fallback'
            logFinalizeAssignment({
              requestId,
              sessionId,
              assignedFrom: 'fallback',
              reason: 'deterministic fallback roadmap built after roadmap-from-action-plan failed',
              previousReport: previousFinalExecutionReport,
              nextReport: finalExecutionReport,
            })
            logActionPlanDiagnosticShape('after-roadmap-from-action-plan-deterministic', finalExecutionReport, {
              requestId,
              sessionId,
            })
          }
        } catch (error) {
          console.error('[report:update] roadmap-from-action-plan exception:', error)
          const previousFinalExecutionReport = finalExecutionReport
          finalExecutionReport = normalizeExecutionReport(
            {
              ...finalExecutionReport,
              roadmap_phases: buildFallbackRoadmapFromActionPlan(finalExecutionReport.action_plan, reportLang),
            },
            reportLang
          )
          finalExecutionReportSource = 'fallback'
          logFinalizeAssignment({
            requestId,
            sessionId,
            assignedFrom: 'fallback',
            reason: 'deterministic fallback roadmap built after roadmap-from-action-plan exception',
            previousReport: previousFinalExecutionReport,
            nextReport: finalExecutionReport,
          })
          logActionPlanDiagnosticShape('after-roadmap-from-action-plan-exception-fallback', finalExecutionReport, {
            requestId,
            sessionId,
          })
        }
      }

      if (Array.isArray(finalExecutionReport?.roadmap_phases) && finalExecutionReport.roadmap_phases.length > 0) {
        const previousFinalExecutionReport = finalExecutionReport
        finalExecutionReport = normalizeExecutionReport(
          {
            ...finalExecutionReport,
            // Roadmap phases are now the primary artifact. Keep legacy checklist tasks out of
            // new saves so old UI adapters cannot dominate the report rendering.
            action_plan: [],
          },
          reportLang
        )
        logFinalizeAssignment({
          requestId,
          sessionId,
          assignedFrom: finalExecutionReportSource || 'unknown',
          reason: 'roadmap_phases present; clearing legacy action_plan before save',
          previousReport: previousFinalExecutionReport,
          nextReport: finalExecutionReport,
        })
        logActionPlanDiagnosticShape('after-clear-legacy-action-plan-for-roadmap', finalExecutionReport, {
          requestId,
          sessionId,
        })
      }

      const shouldPolishActionPlanCopy =
        process.env.REPORT_ACTION_PLAN_COPY_POLISH === '1' &&
        !(Array.isArray(finalExecutionReport?.roadmap_phases) && finalExecutionReport.roadmap_phases.length > 0) &&
        finalExecutionReport &&
	        Array.isArray(finalExecutionReport.action_plan) &&
	        finalExecutionReport.action_plan.length > 0
	      if (shouldPolishActionPlanCopy) {
	        const polishedPlan = await polishActionPlanCopyWithLlm(finalExecutionReport.action_plan, reportLang, {
	          headline: finalExecutionReport.headline,
	          goal: finalExecutionReport.goal,
	        })
        const previousFinalExecutionReport = finalExecutionReport
	        finalExecutionReport = { ...finalExecutionReport, action_plan: polishedPlan }
        logFinalizeAssignment({
          requestId,
          sessionId,
          assignedFrom: finalExecutionReportSource || 'unknown',
          reason: 'REPORT_ACTION_PLAN_COPY_POLISH replaced action_plan copy',
          previousReport: previousFinalExecutionReport,
          nextReport: finalExecutionReport,
        })
        logActionPlanDiagnosticShape('after-action-plan-copy-polish', finalExecutionReport, {
          requestId,
          sessionId,
        })
	      }
      logExecutionReportShape('final', finalExecutionReport)
      logExecutionDecisionCoverage('final', finalExecutionReport)
      logFinalizeTrace('final_execution_report_selected_for_save', finalExecutionReport, {
        requestId,
        sessionId,
        sourceLabel: finalExecutionReportSource,
      })
      console.log('[report:update][step3] action-plan overwrite', actionPlanDecision)

      if (
        reportActionKey === 'report_generate' &&
        !executionPlanOnly &&
        (!finalTrizResolved?.contradictions || finalTrizResolved.contradictions.length === 0)
      ) {
        const tradeoffs = Array.isArray(finalExecutionReport?.decisions)
          ? finalExecutionReport.decisions
              .map((item) => normalizeExecutionText(item?.tradeoff))
              .filter(Boolean)
          : []
        if (tradeoffs.length) {
          const topTradeoffs = [...new Set(tradeoffs)].slice(0, TARGET_TRIZ_CONTRADICTIONS)
          try {
            const leanTriz = await runTrizOnly(undefined, {
              timeoutMs: REPORT_TRIZ_ESCALATION_TIMEOUT_MS,
              forceEscalation: true,
              inputOverride: buildTrizPromptFromTradeoffs(topTradeoffs),
            })
            if (diagnosticsEnabled) {
              console.log('[report:update][triz] tradeoff_only', {
                requestId,
                ok: leanTriz?.ok ?? false,
                hasData: Boolean(leanTriz?.data),
                error: leanTriz?.error ?? null,
                metaTokens: leanTriz?.meta?.tokens ?? null,
                inputTradeoffs: topTradeoffs.length,
              })
            }
            if (leanTriz?.meta) {
              await recordAiUsageBestEffort({
                sessionId: reportRes.data.session_id ?? sessionId,
                reportId: reportRes.data.id ?? null,
                userId,
                actionKey: reportActionKey,
                sourceTask: 'report-triz',
                referenceId: reportRes.data.id ?? null,
                requestId,
                feature: 'report-triz',
                meta: leanTriz.meta,
              })
            }
            if (leanTriz.ok && leanTriz.data) {
              finalTrizResolved = normalizeTriz(leanTriz.data)
            }
          } catch (error) {
            console.error('[report:update] triz tradeoff-only exception:', error)
          }
          if (!finalTrizResolved?.contradictions?.length) {
            finalTrizResolved = normalizeTriz({
              section_title:
                reportLang === 'en'
                  ? 'Key trade-offs in your project'
                  : 'Kluczowe kompromisy w Twoim projekcie',
              section_intro:
                reportLang === 'en'
                  ? 'These tensions appear in your current material. Resolving them makes the next steps clearer and more consistent.'
                  : 'Te napięcia pojawiają się w obecnym materiale. Ich rozstrzygnięcie porządkuje kolejne kroki i zwiększa spójność planu.',
              contradictions: topTradeoffs.map((title) => ({
                title,
                explanation:
                  reportLang === 'en'
                    ? `This is a decision-relevant tension: "${title}". Choose a direction and align priorities and next steps to it.`
                    : `To napięcie decyzyjne: „${title}”. Wybierz kierunek i dostosuj do niego priorytety oraz kolejne kroki.`,
                solution_directions: [],
                approaches: [],
                reflections: [],
                principles: [],
                solutions: [],
              })),
            })
          }
        }
      }

      const nextPayload = {
        ...phaseASanitized,
        summary: finalSummary,
        recommendations: finalRecommendations,
        triz: finalTrizResolved,
        execution_report: finalExecutionReport,
      }
      logFinalizeTrace('summary_json_execution_report_before_db_update', nextPayload.execution_report, {
        requestId,
        sessionId,
        sourceLabel: finalExecutionReportSource,
      })
      logActionPlanDiagnosticShape('before-save-payload-execution-report', nextPayload.execution_report, {
        requestId,
        sessionId,
      })
      const sanitized = sanitizeReportPayload(nextPayload)
      logFinalizeTrace('db_update_payload_shape', sanitized.execution_report, {
        requestId,
        sessionId,
        sourceLabel: finalExecutionReportSource,
      })
      logActionPlanDiagnosticShape('after-sanitize-save-payload-execution-report', sanitized.execution_report, {
        requestId,
        sessionId,
      })
      console.log('[REPORT FINALIZE DEBUG][backend][before-save]', {
        requestId,
        sessionId,
        reportId: reportRes.data?.id ?? null,
        executionReportStage: finalExecutionReport?.stage ?? null,
        roadmapPhasesLen: Array.isArray(finalExecutionReport?.roadmap_phases)
          ? finalExecutionReport.roadmap_phases.length
          : null,
        actionPlanLen: Array.isArray(finalExecutionReport?.action_plan)
          ? finalExecutionReport.action_plan.length
          : null,
        validationLoopLen: Array.isArray(finalExecutionReport?.validation_loop)
          ? finalExecutionReport.validation_loop.length
          : null,
        decisionsLen: Array.isArray(finalExecutionReport?.decisions)
          ? finalExecutionReport.decisions.length
          : null,
        isPlanGenerated: finalExecutionReport?.stage === 'plan_generated',
      })
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
        .select(REPORT_SELECT_FIELDS)
        .maybeSingle()
      if (updateRes.error) {
        console.log('[REPORT FINALIZE DEBUG][backend][after-save]', {
          requestId,
          sessionId,
          reportId: reportRes.data?.id ?? null,
          ok: false,
          error: updateRes.error?.message ?? null,
        })
        res.status(500).json({ ok: false, error: updateRes.error })
        return
      }
      console.log('[REPORT FINALIZE DEBUG][backend][after-save]', {
        requestId,
        sessionId,
        reportId: reportRes.data?.id ?? null,
        ok: true,
        returnedReport: Boolean(updateRes.data),
      })
      const savedExecRawFromUpdate =
        updateRes?.data?.summary_json?.execution_report &&
        typeof updateRes.data.summary_json.execution_report === 'object'
          ? updateRes.data.summary_json.execution_report
          : null
      const savedExecFromUpdate = savedExecRawFromUpdate
        ? normalizeExecutionReport(savedExecRawFromUpdate, reportLang)
        : null
      logFinalizeTrace('db_readback_shape_after_save', savedExecFromUpdate, {
        requestId,
        sessionId,
        sourceLabel: finalExecutionReportSource,
      })
      console.log('[REPORT FINALIZE DEBUG][backend][saved-shape]', {
        requestId,
        sessionId,
        reportId: updateRes.data?.id ?? reportRes.data?.id ?? null,
        ...getActionPlanPersistenceShape(savedExecFromUpdate, updateRes.data?.summary_json ?? null),
      })
      console.log('[REPORT FINALIZE DEBUG][backend][db-readback]', {
        requestId,
        sessionId,
        reportId: updateRes.data?.id ?? reportRes.data?.id ?? null,
        dbReadbackExists: Boolean(updateRes.data),
        executionReportExists: Boolean(savedExecFromUpdate),
        stage: savedExecFromUpdate?.stage ?? null,
        roadmapPhasesLen: Array.isArray(savedExecFromUpdate?.roadmap_phases)
          ? savedExecFromUpdate.roadmap_phases.length
          : null,
        actionPlanLen: Array.isArray(savedExecFromUpdate?.action_plan)
          ? savedExecFromUpdate.action_plan.length
          : null,
        validationLoopLen: Array.isArray(savedExecFromUpdate?.validation_loop)
          ? savedExecFromUpdate.validation_loop.length
          : null,
        decisionsLen: Array.isArray(savedExecFromUpdate?.decisions) ? savedExecFromUpdate.decisions.length : null,
      })
      console.log('[REPORT FINALIZE DEBUG][backend][response-shape]', {
        requestId,
        sessionId,
        returnedExecutionReportStage: savedExecFromUpdate?.stage ?? null,
	        returnedActionPlanLen: Array.isArray(savedExecFromUpdate?.action_plan)
	          ? savedExecFromUpdate.action_plan.length
	          : null,
	        returnedRoadmapPhasesLen: Array.isArray(savedExecFromUpdate?.roadmap_phases)
	          ? savedExecFromUpdate.roadmap_phases.length
	          : null,
        returnedDecisionsLen: Array.isArray(savedExecFromUpdate?.decisions)
          ? savedExecFromUpdate.decisions.length
          : null,
        returnedPrioritiesLen: Array.isArray(savedExecFromUpdate?.priorities)
          ? savedExecFromUpdate.priorities.length
          : null,
        returnedValidationLoopLen: Array.isArray(savedExecFromUpdate?.validation_loop)
          ? savedExecFromUpdate.validation_loop.length
          : null,
      })
      logActionPlanDiagnosticShape('before-response-return', savedExecFromUpdate, {
        requestId,
        sessionId,
        responseSource: 'updateRes',
      })
      logFinalizeTrace('final_response_execution_report_shape', savedExecFromUpdate, {
        requestId,
        sessionId,
        sourceLabel: finalExecutionReportSource,
      })
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
        const savedExecRaw =
          finalReportRes.data?.summary_json?.execution_report &&
          typeof finalReportRes.data.summary_json.execution_report === 'object'
            ? finalReportRes.data.summary_json.execution_report
            : null
        const savedExec = savedExecRaw ? normalizeExecutionReport(savedExecRaw, reportLang) : null
        logFinalizeTrace('db_readback_shape_after_save', savedExec, {
          requestId,
          sessionId,
          sourceLabel: finalExecutionReportSource,
        })
        console.log('[REPORT FINALIZE DEBUG][backend][db-readback]', {
          requestId,
          sessionId,
          reportId: finalReportRes.data?.id ?? null,
          dbReadbackExists: Boolean(finalReportRes.data),
          executionReportExists: Boolean(savedExec),
          stage: savedExec?.stage ?? null,
          roadmapPhasesLen: Array.isArray(savedExec?.roadmap_phases) ? savedExec.roadmap_phases.length : null,
          actionPlanLen: Array.isArray(savedExec?.action_plan) ? savedExec.action_plan.length : null,
          validationLoopLen: Array.isArray(savedExec?.validation_loop) ? savedExec.validation_loop.length : null,
          decisionsLen: Array.isArray(savedExec?.decisions) ? savedExec.decisions.length : null,
        })
        console.log('[REPORT FINALIZE DEBUG][backend][after-save]', {
          requestId,
          sessionId,
          reportId: finalReportRes.data?.id ?? null,
          ok: true,
          returnedUpdatedAt: finalReportRes.data?.updated_at ?? null,
          returnedSourceUpdatedAt: finalReportRes.data?.source_updated_at ?? null,
	          returnedExecutionReportStage: savedExec?.stage ?? null,
	          returnedActionPlanLen: Array.isArray(savedExec?.action_plan) ? savedExec.action_plan.length : null,
	          returnedRoadmapPhasesLen: Array.isArray(savedExec?.roadmap_phases)
	            ? savedExec.roadmap_phases.length
	            : null,
	        })
        logActionPlanDiagnosticShape('after-save-refetch', savedExec, {
          requestId,
          sessionId,
        })
        logActionPlanDiagnosticShape('before-response-return', savedExec, {
          requestId,
          sessionId,
          responseSource: 'refetch',
        })
        logFinalizeTrace('final_response_execution_report_shape', savedExec, {
          requestId,
          sessionId,
          sourceLabel: finalExecutionReportSource,
        })
        res.status(200).json({
          ok: true,
          report: finalReportRes.data ?? null,
          execution_report: savedExecRaw,
          planGenerated: responseExecution.planGenerated,
          planSkippedReason: responseExecution.planSkippedReason,
          ...(Object.keys(responseMeta).length ? { meta: responseMeta } : {}),
          execution: responseExecution,
        })
        return
      }
      const responseReport = updateRes.data
        ? {
            id: updateRes.data.id,
            session_id: updateRes.data.session_id,
            summary_json: updateRes.data.summary_json,
            updated_at: updateRes.data.updated_at,
            source_updated_at: updateRes.data.source_updated_at,
          }
        : {
            id: reportRes.data?.id ?? null,
            session_id: reportRes.data?.session_id ?? sessionId,
            summary_json: sanitized,
            updated_at: new Date().toISOString(),
            source_updated_at: latestBoardItemAt || Date.now(),
          }
      res.status(200).json({
        ok: true,
        execution_report: savedExecRawFromUpdate,
        report: responseReport,
        planGenerated: responseExecution.planGenerated,
        planSkippedReason: responseExecution.planSkippedReason,
        ...(Object.keys(responseMeta).length ? { meta: responseMeta } : {}),
        execution: responseExecution,
      })
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
