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
  return value.map((item) => itemNormalizer(item)).filter(Boolean).slice(0, limit)
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

const normalizeExecutionReport = (value) => {
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
    action_plan: normalizeExecutionList(report.action_plan, (item) => {
      if (typeof item === 'string') {
        const text = item.trim()
        if (!text) return null
        return {
          title: text,
          what_to_do: text,
          why_now: '',
          expected_result: '',
          source_type: null,
          source_ref: null,
          derived_from_user_choice: null,
        }
      }
      if (!item || typeof item !== 'object') return null
      const taskText = normalizeExecutionText(item.task || item.krok)
      const title = normalizeExecutionText(item.title || item.step || item.action || item.task || item.krok)
      const whatToDo = normalizeExecutionText(item.what_to_do || item.what || item.do || item.task || item.krok)
      if (!title && !whatToDo) return null
      return {
        title: title || taskText,
        what_to_do: whatToDo || title || taskText,
        why_now: '',
        expected_result: '',
        source_type:
          item.source_type === 'decision' || item.source_type === 'triz' || item.source_type === 'analysis'
            ? item.source_type
            : null,
        source_ref: typeof item.source_ref === 'string' && item.source_ref.trim() ? item.source_ref.trim() : null,
        derived_from_user_choice:
          typeof item.derived_from_user_choice === 'boolean' ? item.derived_from_user_choice : null,
      }
    }, MAX_EXEC_ACTION_PLAN_ITEMS),
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
  const actionPlan = Array.isArray(report?.action_plan) ? report.action_plan : []
  const decisions = Array.isArray(report?.decisions) ? report.decisions : []
  const validationLoop = Array.isArray(report?.validation_loop) ? report.validation_loop : []
  const countMeaningful = (items, keys) =>
    items.filter((item) => {
      if (!item || typeof item !== 'object') return false
      return keys.every((key) => normalizeExecutionText(item[key]).length > 0)
    }).length

  const prioritiesComplete = countMeaningful(priorities, ['title'])
  const actionPlanComplete = countMeaningful(actionPlan, ['title'])
  const decisionsComplete = decisions.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return normalizeExecutionText(item.tradeoff).length > 0
  }).length
  const validationComplete = countMeaningful(validationLoop, ['check'])

  const prioritiesDistinct = countDistinctNonEmpty(priorities.map((item) => item?.title))
  const actionPlanDistinct = countDistinctNonEmpty(actionPlan.map((item) => item?.title))
  const decisionsDistinct = countDistinctNonEmpty(decisions.map((item) => item?.tradeoff))
  const validationDistinct = countDistinctNonEmpty(validationLoop.map((item) => item?.check))

  const countTooShort = (items, key, minLen) =>
    items.filter((item) => normalizeExecutionText(item?.[key]).length > 0 && normalizeExecutionText(item?.[key]).length < minLen)
      .length
  const prioritiesTooShort = countTooShort(priorities, 'title', 12)
  const actionPlanTooShort = countTooShort(actionPlan, 'title', 12)
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
    actionPlanComplete < Math.min(TARGET_EXEC_ACTION_PLAN, 2),
    decisionsComplete < Math.min(TARGET_EXEC_DECISIONS, 1),
    validationComplete < Math.min(TARGET_EXEC_VALIDATION, 1),
  ].filter(Boolean).length

  const sectionsWithContent = [
    prioritiesComplete > 0,
    actionPlanComplete > 0,
    decisionsComplete > 0,
    validationComplete > 0,
  ].filter(Boolean).length

  const duplicatePenalty = [
    prioritiesDistinct < Math.min(prioritiesComplete, 2),
    actionPlanDistinct < Math.min(actionPlanComplete, 2),
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

  const qualityScore = sectionsWithContent * 3 + Math.min(4, prioritiesComplete) + Math.min(4, actionPlanComplete) +
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
    hasMeaningfulItem(actionPlan, ['title', 'what_to_do', 'why_now', 'expected_result']),
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
    hasMeaningfulItem(actionPlan, ['title', 'what_to_do', 'why_now', 'expected_result']),
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

const mergeDecisionConsequences = (baseReport, enrichedDecisions) => {
  const report = normalizeExecutionReport(baseReport)
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
    execution_report: normalizeExecutionReport(null),
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
  const execution_report = normalizeExecutionReport(value.execution_report)
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
    ? normalizeExecutionText(report.action_plan?.[0]?.title)
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
  const actionPlan = Array.isArray(report.action_plan) ? report.action_plan : []
  const validationLoop = Array.isArray(report.validation_loop) ? report.validation_loop : []
  const meaningfulPriorities = priorities.filter((item) => normalizeExecutionText(item?.title).length > 0).length
  const meaningfulActions = actionPlan.filter((item) => normalizeExecutionText(item?.title).length > 0).length
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
    actionPlan: Array.isArray(report.action_plan) ? report.action_plan.length : null,
    decisions: Array.isArray(report.decisions) ? report.decisions.length : null,
    validationLoop: Array.isArray(report.validation_loop) ? report.validation_loop.length : null,
    hasNextSessionFocus: Boolean(
      typeof report.next_session_focus === 'string' && report.next_session_focus.trim()
    ),
    supportingItems: Array.isArray(report.supporting_items) ? report.supporting_items.length : null,
  })
}

const logExecutionReportSamples = (label, report) => {
  if (!report || typeof report !== 'object') {
    console.log(`[report:update][step3] ${label} action-plan samples: missing`)
    return
  }
  console.log(`[report:update][step3] ${label} action-plan samples`, {
    priority0: Array.isArray(report.priorities) ? report.priorities[0] ?? null : null,
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
            ? normalizeExecutionReport(body.execution_report)
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
      const normalizedExecutionReport = normalizeExecutionReport(normalizedReport.execution_report ?? null)
      const invalidatesPlan = selectionChanged && normalizedExecutionReport?.stage === 'plan_generated'
      const nextExecutionReport = invalidatesPlan
        ? normalizeExecutionReport({
            ...normalizedExecutionReport,
            stage: 'awaiting_decisions',
            priorities: [],
            action_plan: [],
            validation_loop: [],
            next_session_focus: '',
          })
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
        ? normalizeExecutionReport(body.execution_report)
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
      let executionReportCandidate = normalizeExecutionReport(phaseASanitized.execution_report)
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
                action_plan: [
                  {
                    title: 'string',
                    expected_result: 'string',
                    what_to_do: 'string',
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
              'Do not use string shortcuts instead of objects inside priorities, action_plan, decisions, or validation_loop.',
              'Lean shape only. Prioritize durable fields that will be persisted and displayed: priorities.title, action_plan.title, action_plan.what_to_do, action_plan.expected_result, decisions.tradeoff, decisions.option_a, decisions.option_b, decisions.consequence_a, decisions.consequence_b, validation_loop.check, next_session_focus, map_context.coverage_summary, goal, headline.',
              'Make titles specific and project-grounded, not generic labels.',
              'Each priorities item must contain exactly: title.',
              'Action plan must have two conceptual layers.',
              'Layer 1: contradiction-linked actions. Start from the selected or strongly supported contradictions that the user chose to work with. For each selected contradiction, create one or more concrete actions only when the material supports it.',
              'Layer 2: broader synthesis actions. After contradiction-linked actions, add actions derived from the full board material, summary, recommendations, perspective map, supporting items, and the user’s choices in Key decisions to make.',
              'The user must be able to see why actions were created: actions should visibly connect either to a selected contradiction or to a concrete decision/user choice.',
              'Use contradictions as visible anchors, not as cages. Do not limit the content of actions to the contradiction title.',
              'For contradiction-linked actions, include the contradiction title or a short recognizable version of it in the action title.',
              'For broader synthesis actions, ground them in selected decision directions, unresolved risks, repeated patterns, missing validation steps, or practical constraints from the material.',
              'Order the action plan as follows: first actions linked to selected/supported contradictions, then broader synthesis actions.',
              'Each action must be concrete enough that the user knows what to do next, on what object/scope, and what practical result it should produce.',
              'Avoid generic action titles such as "Analyze options", "Define priorities", "Validate assumptions", unless the title includes a concrete project-specific object.',
              'Do not force one action per contradiction. Prefer fewer useful actions over mechanical coverage.',
              'Do not create artificial actions only to match the number of contradictions.',
              'If a contradiction is selected but the material does not support a concrete action, reflect it through a broader validation or decision action instead of inventing a weak action.',
              'Use Key decisions to make as decision context. If the user has already chosen a direction, the action should operationalize that choice instead of reopening the decision.',
              'If a key decision is still unresolved, create an action that helps resolve it through a small test, comparison, prototype, or constraint check.',
              'Validation loop should test the most important assumptions behind the selected contradictions and key decisions, not generic product quality.',
              'Each action_plan item must contain exactly: title, what_to_do, expected_result.',
              'A good action changes the project state.',
              'A good action creates something, tests something, compares something, prototypes something, implements something, removes a constraint, reduces uncertainty, or validates a risky assumption using a concrete artifact or experiment.',
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
              'Do not return action_plan items with title only; every action must have title, what_to_do, expected_result.',
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
              `action_plan: target exactly ${TARGET_EXEC_ACTION_PLAN} items when material supports it; otherwise return 3 to 6 items, in logical order.`,
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

      const buildExecutionReportTaskInstructions = (strictJson = false) =>
        reportLang === 'en'
          ? `Return a single valid JSON object only. No markdown. No text before or after JSON. Keys: execution_report. Build an action-oriented execution report with priorities, decisions, a two-layer action plan, validation, and next session focus.\n\nFor this task, act as a product execution strategist, not a workshop facilitator. Do not moderate discussion, ask the user to clarify, or generate meta-workshop prompts. Generate actions that move the project forward in the real world.\n\nThe action plan must first include actions visibly linked to selected/supported contradictions, using the contradiction title or a short recognizable version of it in the action title. Then add broader synthesis actions derived from the full material and the user’s choices in Key decisions to make.\n\nEach action_plan item must contain exactly title, what_to_do, and expected_result. A good action changes the project state: it creates, tests, compares, prototypes, implements, removes a constraint, reduces uncertainty, or validates a risky assumption using a concrete artifact or experiment.\n\nAvoid meta-workshop actions whose only output is discussion, clarification, definition, prioritization, or choosing later. Do not write actions such as 'Define acceptance criteria', 'Set acceptance criteria', 'Define a success signal', 'Set a success signal', 'Clarify priorities', 'Pick a priority', 'Analyze options', 'Validate assumptions', 'Turn a signal into an experiment', 'Add a kill condition', 'Narrow the MVP', or 'Set one hard constraint' unless the action immediately specifies the concrete project object, scope, method, and expected output.\n\nIf validation is needed, specify what will be built/tested, with whom or under what condition, what will be measured, and what decision the result will enable. If the user has already chosen a decision direction, operationalize it instead of reopening the decision. If the material is ambiguous, choose the smallest concrete next move supported by the material instead of asking the user to clarify.\n\nBe concrete, concise, project-specific, and grounded in the provided material. Use contradictions as anchors, not cages. Do not force one action per contradiction and do not invent weak actions just to cover every contradiction. Avoid generic filler, template phrasing, and meta-instruction wording.${strictJson ? ' STRICT JSON MODE: JSON only, exact keys only, do not translate keys, do not use aliases or synonyms such as krok, decyzja, cel, metoda, task, output, and omit incomplete items rather than returning malformed ones.' : ''}`
          : `Zwróć tylko jeden poprawny obiekt JSON. Bez markdown. Bez tekstu przed lub po JSON. Klucz: execution_report. Zbuduj raport nastawiony na działanie: priorytety, decyzje, dwuwarstwowy plan działania, walidację i fokus kolejnej sesji.\n\nW tym zadaniu działaj jak strateg wykonania produktu, a nie moderator warsztatu. Nie moderuj dyskusji, nie proś użytkownika o doprecyzowanie i nie generuj promptów warsztatowych. Generuj akcje, które realnie przesuwają projekt do przodu.\n\nPlan działania powinien najpierw zawierać akcje wyraźnie powiązane z wybranymi lub dobrze wspartymi sprzecznościami, używając tytułu sprzeczności albo krótkiej rozpoznawalnej wersji tego tytułu w tytule akcji. Następnie dodaj szersze akcje syntetyczne wynikające z całego materiału i wyborów użytkownika w sekcji Key decisions to make.\n\nKażdy element action_plan musi zawierać dokładnie: title, what_to_do i expected_result. Dobra akcja zmienia stan projektu: tworzy coś, testuje coś, porównuje coś, prototypuje coś, wdraża coś, usuwa ograniczenie, zmniejsza niepewność albo waliduje ryzykowne założenie przez konkretny artefakt lub eksperyment.\n\nUnikaj meta-akcji warsztatowych, których jedynym wynikiem jest dyskusja, doprecyzowanie, definiowanie, priorytetyzowanie albo późniejszy wybór. Nie pisz akcji typu: 'Define acceptance criteria', 'Set acceptance criteria', 'Define a success signal', 'Set a success signal', 'Clarify priorities', 'Pick a priority', 'Analyze options', 'Validate assumptions', 'Turn a signal into an experiment', 'Add a kill condition', 'Narrow the MVP', 'Set one hard constraint', chyba że akcja od razu wskazuje konkretny obiekt projektu, zakres, metodę i oczekiwany rezultat.\n\nJeśli potrzebna jest walidacja, wskaż co ma zostać zbudowane lub przetestowane, z kim albo w jakich warunkach, co będzie mierzone i jaką decyzję umożliwi wynik. Jeśli użytkownik wybrał już kierunek decyzji, przełóż go na działanie zamiast ponownie otwierać decyzję. Jeśli materiał jest niejednoznaczny, wybierz najmniejszy konkretny następny ruch wsparty materiałem zamiast prosić użytkownika o doprecyzowanie.\n\nPisz konkretnie, zwięźle, projektowo i wyłącznie na podstawie dostarczonego materiału. Traktuj sprzeczności jako kotwice, a nie ograniczenia. Nie wymuszaj jednej akcji na każdą sprzeczność i nie wymyślaj słabych akcji tylko po to, żeby pokryć każdą sprzeczność. Unikaj generycznych wypełniaczy, szablonowych sformułowań i meta-instrukcji.${strictJson ? ' TRYB ŚCISŁEGO JSON: tylko JSON, tylko dokładnie zdefiniowane klucze, nie tłumacz kluczy, nie używaj aliasów ani synonimów takich jak krok, decyzja, cel, metoda, task, output i pomijaj niekompletne elementy zamiast zwracać błędne.' : ''}`

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
            return raw && typeof raw === 'object' ? raw : null
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
        })

      const buildActionPlanRewritePrompt = (actions) =>
        JSON.stringify({
          lang: reportLang,
          actions: Array.isArray(actions)
            ? actions.map((item) => ({
                title: normalizeExecutionText(item?.title),
                what_to_do: normalizeExecutionText(item?.what_to_do),
                expected_result: normalizeExecutionText(item?.expected_result),
                source_type: item?.source_type ?? null,
                derived_from_user_choice: Boolean(item?.derived_from_user_choice),
              }))
            : [],
          requirements: {
            output_schema: {
              action_plan: [
                {
                  title: 'string',
                  what_to_do: 'string',
                  expected_result: 'string',
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
              'Do NOT include any source labels like "Decyzja:", "Podejście TRIZ:", "Z tablicy:", "From the board:" in titles or text.',
              'Write in one consistent style: concrete, specific, natural language.',
              'Act as a product execution strategist, not a workshop facilitator. Do not generate meta-workshop prompts.',
              'A good rewrite keeps the action concrete and state-changing: build, test, compare, prototype, implement, remove a constraint, reduce uncertainty, or validate a risky assumption with a concrete artifact or experiment.',
              'Avoid meta-workshop actions whose only output is discussion, clarification, definition, prioritization, or choosing later.',
              'Do not write or preserve action titles that are only process, such as: "Define acceptance criteria", "Set acceptance criteria", "Define a success signal", "Set a success signal", "Clarify priorities", "Pick a priority", "Analyze options", "Validate assumptions", "Turn a signal into an experiment", "Add a kill condition", "Narrow the MVP", "Set one hard constraint" unless immediately followed by a concrete project object, scope, method, and expected output.',
              'Be specific about what to build, what to test, with whom/under what conditions, what you measure, and what decision the result enables.',
              'Avoid dry template verbs like "wdroż wybraną opcję", "zweryfikuj", "zrób pierwszy prototyp/test", or "z jasnym sygnałem pass/fail". Replace with concrete project actions and concrete artifacts.',
              'Across the whole plan, vary action types by real-world artifacts and steps (prototype build, user test setup, implementation slice, integration, content/spec creation, instrumentation, packaging/ops), not workshop moves.',
              'Avoid repeating the same sentence pattern across actions (especially not one pattern per category).',
              'Do not start most bullets with the same words. Vary phrasing naturally.',
              'Paraphrase input material; do not copy full decision titles or full board sentences as the core of the bullet.',
              'For expected_result, include a short measurable outcome or acceptance criterion when possible.',
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
        })

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
                const generated = normalizeExecutionReport(execResult.data)
                executionReportCandidate = normalizeExecutionReport({
                  ...executionReportDefaults,
                  ...generated,
                  stage: 'plan_generated',
                  // Preserve the user's selected decisions (incl. selected_option) as the committed context.
                  decisions: existingDecisions,
                  supporting_items: executionSupportingItems,
                  source_snapshot: phaseASanitized.source_snapshot ?? null,
                })
                executionReportCandidate = ensureExecutionNextSessionFocus(executionReportCandidate, reportLang)
                executionReportValidation = validateExecutionPlanOnly(executionReportCandidate)
                responseExecution.planGenerated =
                  Array.isArray(executionReportCandidate?.action_plan) && executionReportCandidate.action_plan.length > 0
                console.log('[REPORT FINALIZE DEBUG][backend][after-final-plan-llm]', {
                  requestId,
                  sessionId,
                  llmOk: Boolean(execResult?.ok),
                  hasData: Boolean(execResult?.data),
                  normalizedStage: executionReportCandidate?.stage ?? null,
                  prioritiesLen: Array.isArray(executionReportCandidate?.priorities)
                    ? executionReportCandidate.priorities.length
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
                console.log('[REPORT FINALIZE DEBUG][backend][after-final-plan-llm]', {
                  requestId,
                  sessionId,
                  llmOk: Boolean(execResult?.ok),
                  hasData: Boolean(execResult?.data),
                  normalizedStage: null,
                  prioritiesLen: null,
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
            const planResult = await runExecutionPlanFromDecisions(undefined, { strictJson: true })
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

              const toActionTitle = (value) => normalizeExecutionText(value?.title || value?.task || value?.step || value?.action || value)
              const toActionBody = (value) => normalizeExecutionText(value?.what_to_do || value?.what || value?.do || '')
              const toSuccess = (value) => normalizeExecutionText(value?.success_criteria || value?.success || value?.criteria || '')

              const choiceActions = llmChoiceActionsRaw
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                  title: toActionTitle(item),
                  what_to_do: toActionBody(item),
                  expected_result: toSuccess(item),
                  source_ref: normalizeExecutionText(item?.source_ref),
                }))
                .filter((item) => item.title)

              const analysisActions = llmAnalysisActionsRaw
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                  title: toActionTitle(item),
                  what_to_do: toActionBody(item),
                  expected_result: toSuccess(item),
                }))
                .filter((item) => item.title)

              const looksLikeSourceLabel = (title) =>
                /^(\s*(decyzja|podejście triz|triz approach|z tablicy|from the board)\s*:)/i.test(String(title || '').trim())

              const sanitizeActionText = (text) => {
                const value = normalizeExecutionText(text)
                if (!value) return ''
                return value.replace(/^(\s*(decyzja|podejście triz|triz approach|z tablicy|from the board)\s*:)\s*/i, '')
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
                  (tradeoff, opt) =>
                    `Zawęź MVP dla tego wyboru: co wchodzi / nie wchodzi (opcja ${opt}) — 3 punkty zakresu`,
                  (tradeoff, opt) =>
                    `Ustal kryteria akceptacji dla wybranego kierunku (opcja ${opt}) — 2 miary + 1 warunek odrzucenia`,
                  (tradeoff, opt) =>
                    `Podejmij świadomy kompromis: co poświęcamy, żeby wygrać w opcji ${opt} — 1 zdanie + konsekwencja`,
                  (tradeoff, opt) =>
                    `Porównaj warianty w mikroteście: jak rozpoznamy, że opcja ${opt} jest lepsza w praktyce`,
                  (tradeoff, opt) =>
                    `Uprość rozwiązanie pod opcję ${opt}: usuń 1 element, który nie zwiększa wartości dla użytkownika`,
                ]
                const decisionMovesEn = [
                  (tradeoff, opt) =>
                    `Narrow the MVP for this choice (option ${opt}): what is in vs out — 3 scope bullets`,
                  (tradeoff, opt) =>
                    `Set acceptance criteria for the chosen direction (option ${opt}): 2 metrics + 1 kill condition`,
                  (tradeoff, opt) =>
                    `Make the trade-off explicit for option ${opt}: what you sacrifice and why it’s worth it — 1 sentence`,
                  (tradeoff, opt) =>
                    `Run a quick A/B check: what observable behavior would favor option ${opt}`,
                  (tradeoff, opt) =>
                    `Simplify toward option ${opt}: remove one element that adds complexity without user value`,
                ]
                const trizMovesPl = [
                  (label) =>
                    `Zdefiniuj sygnał sukcesu dla tego kierunku: 1 miara + próg, który uznasz za “działa”`,
                  (label) =>
                    `Określ ograniczenie projektowe dla tego podejścia (np. gabaryt, koszt, czas pakowania) — 1 twarda liczba`,
                  (label) =>
                    `Zaproponuj najprostszy wariant tego podejścia, który można pokazać użytkownikowi w 1 dniu`,
                  (label) =>
                    `Wybierz priorytet: która część tego podejścia jest krytyczna, a co może poczekać`,
                  (label) =>
                    `Wskaż warunek odrzucenia: kiedy uznasz, że ten kierunek nie ma sensu`,
                ]
                const trizMovesEn = [
                  (label) =>
                    `Define a success signal for this direction: 1 metric + a threshold you’ll accept as “works”`,
                  (label) =>
                    `Set one hard constraint for this approach (size, cost, pack-time, durability) — a number`,
                  (label) =>
                    `Draft the simplest version of this approach you can show a user in 1 day`,
                  (label) =>
                    `Pick a priority inside this approach: what must work first vs what can wait`,
                  (label) =>
                    `Write a kill condition: when you would drop this direction`,
                ]
                const items = []
                selectedDecisions.forEach((d) => {
                  const opt = String(d.selected).toUpperCase()
                  const seed = hashSeed(`${d.tradeoff}:${opt}`)
                  const base = shorten(d.tradeoff, 8)
                  const move = reportLang === 'en' ? pick(decisionMovesEn, seed) : pick(decisionMovesPl, seed)
                  items.push({
                    title:
                      reportLang === 'en'
                        ? `${move(base, opt)}`
                        : `${move(base, opt)}`,
                    what_to_do: '',
                    expected_result: '',
                    source_type: 'decision',
                    source_ref: `decision:${normalizeQualityKey(d.tradeoff)}:${String(d.selected)}`,
                    derived_from_user_choice: true,
                  })
                })
                selectedTrizApproaches.forEach((a) => {
                  const label = shorten(a.approach_title || a.contradiction_title || '', 9)
                  const seed = hashSeed(`triz:${a.contradiction_index}:${a.approach_index}:${label}`)
                  const move = reportLang === 'en' ? pick(trizMovesEn, seed) : pick(trizMovesPl, seed)
                  items.push({
                    title:
                      reportLang === 'en'
                        ? `${move(label)}`
                        : `${move(label)}`,
                    what_to_do: '',
                    expected_result: '',
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
                  (x) => `Zamień sygnał w eksperyment: co zmieniamy i co mierzymy, żeby potwierdzić/obalić założenie`,
                  (x) => `Ustal ograniczenie MVP wynikające z materiału: 1 rzecz, której nie robimy (żeby nie komplikować)`,
                  (x) => `Zdefiniuj test zachowania użytkownika: co ma się wydarzyć przy pakowaniu, żeby uznać kierunek za dobry`,
                  (x) => `Wybierz priorytet na najbliższy tydzień: co odblokuje pozostałe decyzje`,
                  (x) => `Dodaj warunek odrzucenia: kiedy przestajemy inwestować w ten kierunek`,
                ]
                const analysisMovesEn = [
                  (x) => `Turn a signal into an experiment: what changes and what you measure to confirm/deny the assumption`,
                  (x) => `Set an MVP constraint from the material: one thing you deliberately won’t do to keep it simple`,
                  (x) => `Define a user-behavior test: what must happen during packing to count as success`,
                  (x) => `Pick a one-week priority that unlocks the next decisions`,
                  (x) => `Add a kill condition: when you stop investing in this direction`,
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
                  const short = shorten(hint, 10) || (reportLang === 'en' ? 'a key assumption' : 'kluczowe założenie')
                  const seed = hashSeed(`analysis:${i}:${short}`)
                  const move = reportLang === 'en' ? pick(analysisMovesEn, seed) : pick(analysisMovesPl, seed)
                  actions.push({
                    title: `${move(short)}`,
                    what_to_do: '',
                    expected_result: '',
                    source_type: 'analysis',
                    source_ref: `analysis:${i}`,
                    derived_from_user_choice: false,
                  })
                }
                return actions
              }

              let finalChoiceActions = choiceActions.map((a, index) => ({
                title: sanitizeActionText(a.title),
                what_to_do: sanitizeActionText(a.what_to_do),
                expected_result: sanitizeActionText(a.expected_result),
                why_now: '',
                source_type: a.source_ref && String(a.source_ref).startsWith('triz:') ? 'triz' : 'decision',
                source_ref: a.source_ref || `choice:${index}`,
                derived_from_user_choice: true,
              }))
              const usedChoiceRepair =
                finalChoiceActions.some((a) => looksLikeSourceLabel(a.title)) ||
                finalChoiceActions.length !== requiredChoiceCount
              if (finalChoiceActions.some((a) => looksLikeSourceLabel(a.title)) || finalChoiceActions.length !== requiredChoiceCount) {
                finalChoiceActions = buildChoiceRepairActions()
              }

              let finalAnalysisActions = analysisActions.map((a, index) => ({
                title: sanitizeActionText(a.title),
                what_to_do: sanitizeActionText(a.what_to_do),
                expected_result: sanitizeActionText(a.expected_result),
                why_now: '',
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

              let forcedActionPlan = [...finalChoiceActions, ...finalAnalysisActions].slice(0, MAX_EXEC_ACTION_PLAN_ITEMS)

              if (usedChoiceRepair || usedAnalysisRepair) {
                try {
                  const rewriteResult = await runActionPlanRewrite(forcedActionPlan, { strictJson: true })
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
                        title: sanitizeActionText(normalizeExecutionText(item?.title)),
                        what_to_do: sanitizeActionText(normalizeExecutionText(item?.what_to_do)),
                        expected_result: sanitizeActionText(normalizeExecutionText(item?.expected_result)),
                      }))
                      .filter((item) => normalizeExecutionText(item?.title))
                    if (rewritten.length === forcedActionPlan.length) {
                      forcedActionPlan = rewritten
                    }
                  }
                } catch (error) {
                  console.error('[report:update] action-plan-rewrite exception:', error)
                }
              }

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
              })
              executionReportCandidate = ensureExecutionNextSessionFocus(executionReportCandidate, reportLang)
              executionReportValidation = validateExecutionPlanOnly(executionReportCandidate)
              responseExecution.planGenerated = true
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
              })
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
            })
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
        ? normalizeExecutionReport(phaseASanitized.execution_report)
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
      let finalExecutionReport = null
      let actionPlanDecision = 'execution_report_lean_not_persisted_empty_fallback'
      if (generatedExecutionReadyForSave) {
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
        )
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
        )
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
              decisionsEnrichResult.data
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
              finalExecutionReport = enrichedExecutionReport
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
      logExecutionReportShape('final', finalExecutionReport)
      logExecutionDecisionCoverage('final', finalExecutionReport)
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
      const sanitized = sanitizeReportPayload(nextPayload)
      console.log('[REPORT FINALIZE DEBUG][backend][before-save]', {
        requestId,
        sessionId,
        reportId: reportRes.data?.id ?? null,
        executionReportStage: finalExecutionReport?.stage ?? null,
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
        const savedExec =
          finalReportRes.data?.summary_json?.execution_report &&
          typeof finalReportRes.data.summary_json.execution_report === 'object'
            ? normalizeExecutionReport(finalReportRes.data.summary_json.execution_report)
            : null
        console.log('[REPORT FINALIZE DEBUG][backend][after-save]', {
          requestId,
          sessionId,
          reportId: finalReportRes.data?.id ?? null,
          ok: true,
          returnedUpdatedAt: finalReportRes.data?.updated_at ?? null,
          returnedSourceUpdatedAt: finalReportRes.data?.source_updated_at ?? null,
          returnedExecutionReportStage: savedExec?.stage ?? null,
          returnedActionPlanLen: Array.isArray(savedExec?.action_plan) ? savedExec.action_plan.length : null,
        })
        res.status(200).json({
          ok: true,
          report: finalReportRes.data ?? null,
          ...(Object.keys(responseMeta).length ? { meta: responseMeta } : {}),
          execution: responseExecution,
        })
        return
      }
      res.status(200).json({
        ok: true,
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
