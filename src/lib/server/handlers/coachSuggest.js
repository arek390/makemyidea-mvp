import { runLlmTask, createRateLimiter } from '../../../llm/llmRouter.mjs'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { recordSessionAiUsageEvent } from '../aiCostEvents.js'
import { getSessionState, getSessionStoreType, updateSessionStateRow } from '../../../engine/storage/sessionStore.mjs'
import {
  getEntryContextStats,
  normalizeBoardEntriesForLlm,
} from '../llmBoardEntryContext.js'
import {
  buildMeta,
  readJsonBody,
  resolveAiSupportEnabled,
  resolveDiagnosticsEnabled,
  sendError,
  sendJson,
} from '../http.js'
import {
  analyzeSeedLikeText,
} from '../seedAnalysis.js'

const limiter = createRateLimiter({ windowMs: 60_000, max: 20 })

const recordCoachUsageEvent = async ({ sessionId, currentUserId, actionKey, requestId, meta }) => {
  if (!sessionId || !meta) return
  await recordSessionAiUsageEvent(getSupabaseAdmin(), {
    sessionId,
    userId: currentUserId || null,
    actionKey,
    sourceTask: actionKey,
    referenceId: sessionId,
    requestId: requestId || null,
    feature: actionKey,
    meta,
  })
}

const normalizeLang = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw.startsWith('pol')) return 'pl'
  if (raw.startsWith('eng')) return 'en'
  if (raw.startsWith('en')) return 'en'
  if (raw.startsWith('pl')) return 'pl'
  return raw || 'pl'
}

const sanitizeQuestionText = (input) => {
  let value = String(input || '')
  value = value.replace(/\(\s*(?:[ABC][123]\s*(?:,\s*[ABC][123]\s*)*)\)/g, '')
  value = value.replace(
    /(^|[\s\u00A0])([ABC][123])(?=([\s\u00A0]*[.,;:!?)]|[\s\u00A0]*$))/g,
    '$1'
  )
  value = value.replace(/\(\s*\)/g, '')
  value = value.replace(/\s+/g, ' ').replace(/\s+([.,;:!?\)])/g, '$1').trim()
  return value
}

const sanitizeTranscriptCorrectionText = (input) =>
  String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s])/g, '$1 ')
    .trim()

const cellKey = (group, mode) => `${group}:${mode}`

const perspectiveToMode = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'as_is') return 1
  if (raw === 'not_working') return 2
  if (raw === 'should_be') return 3
  return null
}

const normalizeQuestion = (input) => {
  if (!input) return null
  if (typeof input === 'string') {
    const text = input.trim()
    return text ? { text } : null
  }
  if (typeof input === 'object') {
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (!text) return null
    return { ...input, text }
  }
  return null
}

const assertQuestionShape = (question, context) => {
  if (process.env.NODE_ENV === 'production') return
  if (!question) return
  const valid = typeof question === 'object' && typeof question.text === 'string'
  if (!valid) {
    console.error('[coach/suggest][question_shape_invalid]', {
      context,
      type: typeof question,
      value: question,
    })
  }
}

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const sessionMemory = new Map()

const getSessionMemory = (sessionId) => {
  if (!sessionId) return null
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      currentCell: null,
      recentCells: [],
      visitCounts: {},
      cellPointers: {},
    })
  }
  return sessionMemory.get(sessionId)
}

const safeParseJson = (value, fallback) => {
  if (!value || typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

const TARGET_AREA_TO_MODE = {
  as_is: 1,
  not_working: 2,
  should_be: 3,
}

const modeToTargetArea = (mode) => {
  const numeric = Number(mode)
  if (numeric === 1) return 'as_is'
  if (numeric === 2) return 'not_working'
  if (numeric === 3) return 'should_be'
  return null
}

const normalizeTargetArea = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'as_is' || raw === 'asis' || raw === 'as-is') return 'as_is'
  if (raw === 'not_working' || raw === 'not-working' || raw === 'notworking') return 'not_working'
  if (raw === 'should_be' || raw === 'should-be' || raw === 'shouldbe') return 'should_be'
  return null
}

const resolveTargetArea = ({ requestedPerspective, requestedMode, currentModeCode, action }) =>
  normalizeTargetArea(requestedPerspective) ||
  modeToTargetArea(requestedMode) ||
  modeToTargetArea(currentModeCode) ||
  (String(action || '').toUpperCase() === 'PERSPECTIVE' ? 'not_working' : 'not_working')

const normalizeBoardArea = (value) => normalizeTargetArea(value) || modeToTargetArea(value)

const clipLine = (value, max = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trim()}…`
}

const groupBoardEntriesByArea = (items) => {
  const grouped = {
    as_is: [],
    not_working: [],
    should_be: [],
    unassigned: [],
  }
  const source = Array.isArray(items) ? items : []
  source.forEach((item) => {
    const answer = typeof item === 'string' ? item : item?.answer ?? item?.text
    const clipped = clipLine(answer)
    if (!clipped) return
    const question = typeof item === 'object' ? clipLine(item?.question, 220) : ''
    const area = typeof item === 'object' ? normalizeBoardArea(item.area ?? item.matrix_col) : null
    const meta = typeof item === 'object'
      ? [item?.matrix_cell ? `cell=${item.matrix_cell}` : null, item?.entry_type ? `type=${item.entry_type}` : null]
          .filter(Boolean)
          .join(', ')
      : ''
    const prefix = typeof item === 'object' && item?.id ? `${item.id}: ` : ''
    const entry = question
      ? `${prefix}${meta ? `[${meta}] ` : ''}Question: ${question} | Answer: ${clipped}`
      : `${prefix}${meta ? `[${meta}] ` : ''}${clipped}`
    if (area && grouped[area]) {
      grouped[area].push(entry)
    } else {
      grouped.unassigned.push(entry)
    }
  })
  return grouped
}

const formatAreaSection = (label, items) => {
  const limited = items.slice(-12)
  if (!limited.length) return `${label}:\n- [empty]`
  return `${label}:\n${limited.map((item) => `- ${item}`).join('\n')}`
}

const buildContextualQuestionPrompt = ({
  lang,
  targetArea,
  sessionName,
  boardEntriesRaw,
  askedTexts,
  lastQuestionText,
}) => {
  const grouped = groupBoardEntriesByArea(boardEntriesRaw)
  const recentQuestions = [
    ...askedTexts.slice(-6),
    lastQuestionText,
  ]
    .map((item) => clipLine(item, 180))
    .filter(Boolean)
  const languageName = lang === 'pl' ? 'pl' : 'en'
  const sessionText = clipLine(sessionName, 260) || '[not provided]'
  return [
    'SYSTEM:',
    'You are a product discovery facilitator for early-stage product ideas. Your job is to ask one precise contextual question that helps the founder add a valuable board entry. The question should help reveal contradictions, tradeoffs, risks, constraints, failure modes, or decision criteria. Do not brainstorm solutions unless the target area is should_be and the question is about desired outcome or success criteria. Return strict JSON only.',
    '',
    'USER:',
    `Language: ${languageName}`,
    `Target area: ${targetArea}`,
    '',
    'Meaning of target area:',
    '- as_is: ask about current situation, existing behavior, assumptions, constraints, dependencies, usage context, or current workaround.',
    '- not_working: ask about contradiction, tension, failure mode, bottleneck, risk, unwanted compromise, or mismatch.',
    '- should_be: ask about desired state, success condition, acceptable tradeoff, decision criterion, or target behavior.',
    '',
    'Session / idea:',
    sessionText,
    '',
    'Current board entries grouped by area:',
    formatAreaSection('AS_IS', grouped.as_is),
    formatAreaSection('NOT_WORKING', grouped.not_working),
    formatAreaSection('SHOULD_BE', grouped.should_be),
    grouped.unassigned.length ? formatAreaSection('UNASSIGNED', grouped.unassigned) : '',
    '',
    'Recently asked questions:',
    recentQuestions.length ? recentQuestions.map((item) => `- ${item}`).join('\n') : '- [none]',
    '',
    'Interpretation rules for board entries:',
    '- Interpret facilitated entries as a pair: the question defines the meaning of the answer.',
    '- Do not infer a facilitated answer in isolation when question context exists.',
    '- Use the Q/A pair to decide what is already covered, what is ambiguous, and what contradiction or gap should be explored next.',
    '- Avoid asking about something already covered in previous questions, answers, or the combined meaning of a question and answer.',
    '',
    'Generate one new question for the target area.',
    'The question must:',
    '- be one sentence',
    '- be specific to the current idea',
    '- be answerable by the founder',
    '- help create a useful board entry',
    '- avoid repeating recent questions',
    '- avoid generic discovery wording',
    '- avoid mentioning matrix, cells, TRIZ, system, analysis, user',
    '- return strict JSON only',
    '',
    'Return:',
    '{"question":"...","target_area":"as_is|not_working|should_be","reason":"...","contradiction_signal":"..."}',
  ]
    .filter(Boolean)
    .join('\n')
}

const hasForbiddenFacilitationTerm = (text) =>
  /\b(?:matrix|triz|system|analysis|user|[ABC][123])\b/i.test(text) ||
  /\b(?:matryca|analiza|użytkownik|uzytkownik)\b/i.test(text)

const hasMarkdownSyntax = (text) => /[`*_#>\[\]\n\r]/.test(text)

const isLikelyWrongLanguage = (text, lang) => {
  const normalized = normalizeText(text)
  if (lang === 'pl') {
    const englishStart = /^(what|where|which|how|when|why|who|is|are|does|do|can|could|should)\b/.test(normalized)
    const hasPolishSignal = /[ąćęłńóśżź]/i.test(text) || /\b(co|gdzie|który|ktory|jaki|jak|czy|po czym|które|ktore|w którym|w ktorym)\b/.test(normalized)
    return englishStart && !hasPolishSignal
  }
  const polishStart = /^(co|gdzie|który|ktory|jaki|jak|czy|dlaczego|po czym|w którym|w ktorym)\b/.test(normalized)
  return /[ąćęłńóśżź]/i.test(text) || polishStart
}

const tokenSet = (text) =>
  new Set(
    normalizeText(text)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  )

const isNearDuplicateQuestion = (text, previousTexts) => {
  const normalized = normalizeText(text)
  if (!normalized) return true
  return previousTexts.some((previous) => {
    const prev = normalizeText(previous)
    if (!prev) return false
    if (prev === normalized) return true
    if (prev.length > 24 && (prev.includes(normalized) || normalized.includes(prev))) return true
    const a = tokenSet(normalized)
    const b = tokenSet(prev)
    if (a.size < 4 || b.size < 4) return false
    const intersection = [...a].filter((token) => b.has(token)).length
    const union = new Set([...a, ...b]).size
    return union > 0 && intersection / union >= 0.82
  })
}

const validateContextualQuestionPayload = ({ payload, targetArea, lang, previousQuestions }) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'not_object' }
  }
  const rawQuestion = String(payload.question || '').trim()
  if (hasMarkdownSyntax(rawQuestion)) return { ok: false, reason: 'markdown_or_newline' }
  if (hasForbiddenFacilitationTerm(rawQuestion)) return { ok: false, reason: 'forbidden_term' }
  const question = sanitizeQuestionText(rawQuestion)
  if (!question) return { ok: false, reason: 'missing_question' }
  if (!question.endsWith('?')) return { ok: false, reason: 'question_mark_required' }
  if ((question.match(/\?/g) || []).length !== 1) return { ok: false, reason: 'multiple_questions' }
  if (/[.!]\s+\S/.test(question.slice(0, -1))) return { ok: false, reason: 'multiple_sentences' }
  if (normalizeTargetArea(payload.target_area) !== targetArea) return { ok: false, reason: 'target_area_mismatch' }
  if (isNearDuplicateQuestion(question, previousQuestions)) return { ok: false, reason: 'duplicate_or_near_duplicate' }
  if (isLikelyWrongLanguage(question, lang)) return { ok: false, reason: 'language_mismatch' }
  return {
    ok: true,
    data: {
      question,
      target_area: targetArea,
      reason: clipLine(payload.reason, 260),
      contradiction_signal: clipLine(payload.contradiction_signal, 260),
    },
  }
}

const parseContextualQuestionResponse = ({ value, targetArea, lang, previousQuestions }) => {
  const trimmed = String(value || '').trim()
  if (!trimmed || trimmed.startsWith('```') || !trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { ok: false, reason: 'strict_json_required' }
  }
  const parsed = safeParseJson(trimmed, null)
  return validateContextualQuestionPayload({
    payload: parsed,
    targetArea,
    lang,
    previousQuestions,
  })
}

const buildQuestionRepairPrompt = ({
  originalPrompt,
  rawResponse,
  validationReason,
  targetArea,
  lang,
}) =>
  [
    originalPrompt,
    '',
    'REPAIR:',
    `The previous response was invalid because: ${validationReason || 'invalid_response'}.`,
    `Return one corrected strict JSON object only for target_area "${targetArea}" and language "${lang}".`,
    'The question must end with exactly one question mark, contain no markdown, no forbidden words, and no second question.',
    'Previous invalid response:',
    String(rawResponse || '').slice(0, 1200),
  ].join('\n')

const contextualFallbackQuestions = {
  pl: {
    as_is: [
      'Które obecne założenie lub ograniczenie najmocniej wpływa na to, jak ten pomysł działa dzisiaj?',
      'Jaki fakt z obecnej sytuacji najbardziej ogranicza możliwe decyzje wokół tego pomysłu?',
    ],
    not_working: [
      'Gdzie w tym pomyśle pojawia się napięcie między tym, czego oczekujesz, a tym, co obecnie ogranicza rozwiązanie?',
      'Który kompromis w tym pomyśle może później stać się najtrudniejszy do zaakceptowania?',
    ],
    should_be: [
      'Po czym poznasz, że docelowe rozwiązanie poprawia sytuację bez przenoszenia problemu w inne miejsce?',
      'Jakie kryterium pokaże, że wybrany kierunek jest lepszy mimo koniecznych kompromisów?',
    ],
  },
  en: {
    as_is: [
      'Which current assumption or constraint most shapes how this idea works today?',
      'What fact about the current situation limits the decisions around this idea the most?',
    ],
    not_working: [
      'Where does this idea create tension between what you want and what currently limits the solution?',
      'Which compromise in this idea could become the hardest one to accept later?',
    ],
    should_be: [
      'How will you know the target solution improves the situation without moving the problem somewhere else?',
      'What criterion will show that the chosen direction is better despite the tradeoffs it requires?',
    ],
  },
}

const buildContextualFallbackQuestion = ({ lang, targetArea, previousQuestions }) => {
  const locale = lang === 'pl' ? 'pl' : 'en'
  const options = contextualFallbackQuestions[locale][targetArea] || contextualFallbackQuestions[locale].not_working
  return options.find((question) => !isNearDuplicateQuestion(question, previousQuestions)) || options[0]
}

const hashQuestionId = (text) => {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

const mergeLlmMetas = (...metas) => {
  const tokens = metas.reduce(
    (acc, meta) => {
      const input = Number(meta?.tokens?.input ?? 0)
      const output = Number(meta?.tokens?.output ?? 0)
      const total = Number(meta?.tokens?.total ?? input + output)
      return {
        input: acc.input + input,
        output: acc.output + output,
        total: acc.total + total,
      }
    },
    { input: 0, output: 0, total: 0 }
  )
  const lastMeta = [...metas].reverse().find((meta) => meta?.modelUsed) || {}
  return {
    aiSupportEnabled: metas.some((meta) => meta?.aiSupportEnabled !== false),
    modelUsed: lastMeta.modelUsed ?? null,
    escalated: metas.some((meta) => Boolean(meta?.escalated)),
    tokens,
  }
}

const buildContextualQuestionObject = ({ text, targetArea, groupCode, reason, contradictionSignal, source }) => ({
  id: `llm_contextual_${targetArea}_${hashQuestionId(text)}`,
  text,
  group_code: groupCode || null,
  mode_code: TARGET_AREA_TO_MODE[targetArea],
  category_code: 'llm_contextual',
  intent_code: targetArea,
  source,
  target_area: targetArea,
  reason: reason || '',
  contradiction_signal: contradictionSignal || '',
})

const pickCellTexts = (cells, keys) =>
  keys.flatMap((key) =>
    Array.isArray(cells?.[key])
      ? cells[key].map((text) => String(text || '').trim()).filter(Boolean)
      : []
  )

const buildSummaryPrompt = ({ locale, sessionName, cells }) => {
  const section = (label, keys) => {
    const items = pickCellTexts(cells, keys).slice(0, 30)
    const header = `${label} (cells ${keys.join('+')}):`
    if (!items.length) return `${header}\n- [EMPTY]`
    return `${header}\n${items.map((text) => `- ${text}`).join('\n')}`
  }
  const summaryInput = [
    `Session: ${sessionName || '—'}`,
    section(locale === 'pl' ? 'TODAY' : 'TODAY', ['A1', 'B1', 'C1']),
    section(locale === 'pl' ? 'CHANGE' : 'CHANGE', ['A2', 'B2', 'C2']),
    section(locale === 'pl' ? 'PRODUCT' : 'PRODUCT', ['A3', 'B3', 'C3']),
  ].join('\n\n')

  const instructions = [
    'You are a facilitation assistant. Summarize only what is present in the input.',
    'Ignore unreadable, mistaken paste, or irrelevant entries.',
    'Do NOT hallucinate new facts. Do NOT mention excluded items.',
    'Return STRICT JSON ONLY in this shape:',
    '{"today":"...","change":"...","product":"..."}',
    'Each field should be 2-6 sentences or short bullets.',
    'If content is too sparse, write a short "insufficient data" note.',
    locale === 'pl'
      ? 'Write in Polish.'
      : 'Write in English.',
  ].join(' ')

  return { summaryInput, instructions }
}

const MODEL_PRICING_USD = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-5-mini': { input: 0.25, output: 2.0 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
}

const resolveFxUsdPln = () => {
  const raw = Number(process.env.FX_USD_PLN || 0)
  return Number.isFinite(raw) && raw > 0 ? raw : 4.0
}

const buildUsagePayload = (meta) => {
  const model = meta?.modelUsed || null
  const inputTokens = Number(meta?.tokens?.input ?? 0)
  const outputTokens = Number(meta?.tokens?.output ?? 0)
  const totalTokens = Number(meta?.tokens?.total ?? inputTokens + outputTokens)
  const pricing = model && MODEL_PRICING_USD[model]
  const costUsd = pricing
    ? (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
    : 0
  const fxUsdPln = resolveFxUsdPln()
  const costPln = costUsd * fxUsdPln
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    fxUsdPln,
    costPln,
  }
}

const buildSummaryFallback = (locale, errorCategory, note) => {
  const noData = locale === 'pl'
    ? 'Brak wystarczających danych do podsumowania.'
    : 'Insufficient data to generate a summary.'
  const base = note || noData
  return {
    ok: true,
    source: 'fallback',
    summary: {
      today: base,
      change: base,
      product: base,
    },
    usage: {
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      fxUsdPln: resolveFxUsdPln(),
      costPln: 0,
    },
    meta: {
      aiSupportEnabled: false,
      modelUsed: null,
      escalated: false,
      tokens: { input: 0, output: 0, total: 0 },
      errorCategory,
    },
  }
}

const isValidCellId = (value) => /^[ABC][123]$/.test(String(value || '').trim())

const coerceCellId = (value) => {
  const raw = String(value || '').trim().toUpperCase()
  return isValidCellId(raw) ? raw : null
}

const clampConfidence = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric < 0) return 0
  if (numeric > 1) return 1
  return numeric
}

const normalizeSeedKind = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return 'note'
  if (raw === 'idea') return 'idea'
  if (raw === 'observation') return 'observation'
  if (raw === 'problem') return 'problem'
  if (raw === 'need') return 'need'
  if (raw === 'conclusion') return 'conclusion'
  if (raw === 'question') return 'question'
  if (raw === 'note') return 'note'
  return 'note'
}

const normalizeSeedText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

// Near-exact dedupe only: lowercase + normalize whitespace + drop punctuation.
// Avoid fuzzy/semantic dedupe here to preserve recall for seed_from_brief.
const seedDedupKey = (value) =>
  normalizeSeedText(value)
    .toLowerCase()
    // Avoid Unicode property escapes for broader runtime compatibility.
    .replace(/[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const resolveSeedMaxEntries = () => {
  const raw = Number(process.env.SEED_MAX_ENTRIES ?? 64)
  if (!Number.isFinite(raw) || raw <= 0) return 64
  return Math.min(256, Math.floor(raw))
}

const resolveSeedClassificationMode = () => {
  const raw = String(process.env.SEED_CLASSIFICATION_MODE || '').trim()
  if (raw === 'column_first') return 'column_first'
  return 'full_3x3'
}

const normalizeSeedEntries = (items, maxEntries = resolveSeedMaxEntries()) => {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const normalized = []
  for (const item of items) {
    if (normalized.length >= maxEntries) break
    const text =
      typeof item === 'string'
        ? normalizeSeedText(item)
        : normalizeSeedText(item?.text)
    if (!text) continue
    const dedupKey = seedDedupKey(text)
    if (!dedupKey || seen.has(dedupKey)) continue
    seen.add(dedupKey)
    normalized.push({
      text,
      cellCode: typeof item === 'string' ? null : coerceCellId(item?.cellCode),
      confidence: typeof item === 'string' ? null : clampConfidence(item?.confidence),
      kind: typeof item === 'string' ? null : normalizeSeedKind(item?.kind),
    })
  }
  return normalized
}

const parseSeedEntriesPayload = (payload, maxEntries = resolveSeedMaxEntries()) => {
  if (!payload) return null
  const source = Array.isArray(payload)
    ? payload
    : payload?.entries ||
      payload?.items ||
      payload?.seeds ||
      payload?.ideas ||
      payload?.data?.entries ||
      payload?.data?.items ||
      payload?.result?.entries ||
      payload?.result?.items
  const entries = normalizeSeedEntries(source, maxEntries)
  if (!entries.length) return null
  return entries
}

const coerceSeedColumnCode = (value) => {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw === '1' || raw === '2' || raw === '3') return raw
  if (raw === 'B1') return '1'
  if (raw === 'B2') return '2'
  if (raw === 'B3') return '3'
  return null
}

const coerceSeedColumnCodeLoose = (value) => {
  const raw = String(value ?? '').trim().toUpperCase()
  const direct = coerceSeedColumnCode(raw)
  if (direct) return direct
  const bMatch = raw.match(/B\s*([123])\b/)
  if (bMatch) return bMatch[1]
  const digitMatch = raw.match(/\b([123])\b/)
  if (digitMatch) return digitMatch[1]
  const fallbackDigit = raw.match(/([123])/)
  if (fallbackDigit) return fallbackDigit[1]
  return null
}

function mapColumnToLegacyCellCode(column) {
  switch (String(column || '').trim()) {
    case '1':
      return 'B1'
    case '2':
      return 'B2'
    case '3':
      return 'B3'
    default:
      return null
  }
}

const normalizeColumnFirstComparableText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')

const columnFirstMatchKey = (value) =>
  normalizeColumnFirstComparableText(value)
    .toLowerCase()
    // Avoid Unicode property escapes for broader runtime compatibility.
    .replace(/[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const buildColumnFirstClassificationFromLlm = ({ inputEntries, llmPayload }) => {
  const raw =
    llmPayload?.entries ||
    llmPayload?.items ||
    llmPayload?.data?.entries ||
    llmPayload?.result?.entries ||
    null
  const safeList = Array.isArray(raw) ? raw : []
  const byId = new Map()
  const byKey = new Map()
  for (const item of safeList) {
    const safeId = String(item?.id ?? '').trim()
    if (safeId && !byId.has(safeId)) {
      byId.set(safeId, {
        llmRawColumn: item?.column ?? item?.col ?? item?.cellCode ?? null,
        column: coerceSeedColumnCodeLoose(item?.column ?? item?.col ?? item?.cellCode),
        confidence: item?.confidence ?? null,
        kind: item?.kind ?? null,
      })
    }
    const key = columnFirstMatchKey(item?.text)
    if (!key) continue
    if (byKey.has(key)) continue
    byKey.set(key, {
      llmRawColumn: item?.column ?? item?.col ?? item?.cellCode ?? null,
      column: coerceSeedColumnCodeLoose(item?.column ?? item?.col ?? item?.cellCode),
      confidence: item?.confidence ?? null,
      kind: item?.kind ?? null,
    })
  }

  const mapped = (Array.isArray(inputEntries) ? inputEntries : []).map((entry) => {
    const safeId = String(entry?.id ?? '').trim()
    const text = normalizeColumnFirstComparableText(entry?.text)
    const picked = (safeId ? byId.get(safeId) : null) || byKey.get(columnFirstMatchKey(text)) || null
    const column = picked?.column ?? null
    return {
      text,
      column,
      cellCode: mapColumnToLegacyCellCode(column),
      confidence: clampConfidence(picked?.confidence),
      kind: normalizeSeedKind(picked?.kind),
    }
  })

  const total = mapped.length
  const classified = mapped.filter((entry) => entry.cellCode != null).length
  const c1 = mapped.filter((entry) => entry.cellCode === 'B1').length
  const c2 = mapped.filter((entry) => entry.cellCode === 'B2').length
  const c3 = mapped.filter((entry) => entry.cellCode === 'B3').length
  const nullCount = total - classified
  return {
    entries: normalizeSeedEntries(mapped, resolveSeedMaxEntries()),
    stats: { total, classified, nullCount, byColumn: { 1: c1, 2: c2, 3: c3 } },
  }
}

const inferCellMeaning = (cellCode) => {
  const safe = coerceCellId(cellCode)
  if (!safe) return { row: null, col: null }
  const rowMap = {
    A: 'world',
    B: 'product',
    C: 'elements',
  }
  const colMap = {
    1: 'as_is',
    2: 'not_working',
    3: 'should_be',
  }
  return {
    row: rowMap[safe[0]] || null,
    col: colMap[safe[1]] || null,
  }
}

const buildSeedDiagnosticFlags = (value) => {
  const text = String(value || '').toLowerCase()
  return {
    hasShouldSignal:
      /powin|mógłby|mogłaby|miałby|pozw|ułatw|pomóc|cecha|łatwa do|should|could|allow|make it easier|feature|easy to|must remain|needs to|has to|ideally|target state|i want it to|i would like it to/.test(
        text
      ),
    hasProblemSignal:
      /problem|niszc|zgniec|uszkodz|utrud|trzeba|musi|dodatkowa czynność|niepotrzebna|ryzyko|przykryw|nie działa|trudno|ciężk|brak|problem|damage|crush|crushed|harm|friction|must|have to|extra step|unnecessary|risk|difficult|doesn't work|does not work|hard to|lack|missing|prevents|gets in the way/.test(
        text
      ),
    hasAsIsSignal:
      /obecne|dzisiaj|używane|występuje|jest|są|currently|today|existing|current|are|is|used/.test(
        text
      ),
    looksLikeMarketStatement: /market|rynek|konkur|competition|pricing|cena|prices|price|availability|dostępn|saturated|nasycon|selection|wyb[oó]r|trend|trends|category|kategoria/.test(
      text
    ),
  }
}

const normalizeSeedSentenceStart = (value, maxChars = 60) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxChars)

const detectLeadingSeedIntent = (value) => {
  const start = normalizeSeedSentenceStart(value, 60)
  // Inspect the first clause to reduce false positives from later "because/so that" parts.
  const head = start.split(/[.;:—–-]/)[0] || start

  // If the entry begins with a human/user actor, obligation language is usually PROBLEM (extra effort / friction).
  if (/^(klient|klienci|użytkownik|użytkownicy|customer|customers|user|users|i|we|you|they)\b/.test(head)) {
    if (/\b(musi|muszą|must|have to|has to|needs to|need to)\b/.test(head)) return '2'
  }

  // Requirement framing: "X must be ..." / "X musi być ..." is typically SHOULD_BE (expected property).
  if (/^(musi|must)\s+(być|be)\b/.test(head)) return '3'
  if (/^\S.{0,32}\b(musi|must)\s+(być|be)\b/.test(head)) return '3'

  const leadDesired =
    /^(powin|mógłby|mogłaby|miałby|warto|dobrze gdyby|pozwol|należy|it would help if|should|could|could help|should be)\b/.test(head) ||
    // Noun-led proposal (e.g. "Produkt powinien…", "The system should…", "Divider could…")
    /^\S.{0,28}\b(powin|mógłby|mogłaby|miałby|pozwol|should|could|should be|could help)\b/.test(head)
  if (leadDesired) return '3'

  const leadProblem =
    /^(problem|kłopot|trudność|utrudnia|powoduje|niszczy|uszkadza|trzeba|musi|muszą|musisz|musimy|nie działa|nie da się|issue|difficulty|friction|causes|damages|breaks|must|have to|needs to|does not work|cannot)\b/.test(
      head
    )
  if (leadProblem) return '2'

  const leadAsIs =
    /^(obecnie|dzisiaj|teraz|obecne|aktualnie|są|jest|w innych|inne|currently|today|now|current|existing|is|are|in other|other)\b/.test(
      head
    )
  if (leadAsIs) return '1'

  return null
}

const hasSeedShouldBeSignals = (value) => {
  const text = String(value || '').toLowerCase()
  // Desired / proposal / requirement markers. Should dominate over burden/problem when present.
  return /powin|mógłby|mogłaby|miałby|warto|dobrze gdyby|pozw|ułatw|pomóc|cecha|łatwa do|stabiln|nie może się|należy|wymaga|wymagane|should|could|could help|should be|allow|make it easier|feature|stable|easy to|must be|require|requires|required/.test(
    text
  )
}

const hasSeedNotWorkingSignals = (value) => {
  const text = String(value || '').toLowerCase()

  // User burden / friction / forced actions / extra steps.
  const burden =
    /musi|muszą|musisz|musimy|trzeba|należy|wymaga|wymagane|dodatkow|niepotrzebn|utrud|problem|kłopot|trudno|nie da się|ponownie|za każdym razem|must|have to|has to|need to|needs to|requires|extra|unnecessary|difficult|problem|issue|hard to|each time|again/.test(
      text
    )

  // Harm / risk / negative outcomes.
  const harm =
    /zniszcz|uszkodz|zgni|zgniec|ryzyko|szkoda|strat|damage|break|crush|crushed|risk|harm/.test(text)

  // Workaround phrasing ("aby/żeby/in order to") should only count when combined with burden signals.
  const workaroundJoiner = /\b(aby|żeby|in order to)\b/.test(text)
  const workaroundAmplifier = /\b(musi|muszą|trzeba|należy|must|have to|need to|needs to|again|ponownie|za każdym razem)\b/.test(
    text
  )

  return harm || burden || (workaroundJoiner && workaroundAmplifier)
}

const deriveSeedColumnFromMarkersV2 = (value) => {
  const text = String(value || '').trim()
  const lower = text.toLowerCase()
  const leading = detectLeadingSeedIntent(lower)

  // Column 1 should NOT be a technical fallback. We only assign "1" when we have
  // positive observation/benchmark evidence and no dominant problem/solution intent.
  const observationSignals =
    /^(obecnie|dzisiaj|teraz|obecne|aktualnie|w innych|inne|currently|today|now|current|existing|in other|other)\b/.test(
      lower.trim()
    ) ||
    /\b(obecne|dzisiaj|używa|używane|występuje|jest|są|current|currently|today|existing|are|is|used)\b/.test(lower)

  const benchmarkSignals =
    /\b(w innych|inne|porówn|lepsz|gorsz|mniejsz|większ|szersz|wyższ|better|worse|smaller|larger|wider|taller|in other|other)\b/.test(
      lower
    )

  const desired = hasSeedShouldBeSignals(lower)
  const notWorking = hasSeedNotWorkingSignals(lower)

  const scores = { 1: 0, 2: 0, 3: 0 }
  const reasons = { 1: [], 2: [], 3: [] }

  // Leading intent is the strongest signal.
  if (leading === '3') {
    scores[3] += 4
    reasons[3].push('leading_desired')
  } else if (leading === '2') {
    scores[2] += 4
    reasons[2].push('leading_problem')
  } else if (leading === '1') {
    scores[1] += 3
    reasons[1].push('leading_observation')
  }

  // Global semantic signals (weaker than leading intent, but consistent).
  if (desired) {
    scores[3] += 3
    reasons[3].push('desired_markers')
  }
  if (notWorking) {
    scores[2] += 3
    reasons[2].push('not_working_markers')
  }

  // Observation/benchmark signals only help column 1 if problem/solution intent is not dominant.
  if (observationSignals) {
    scores[1] += 2
    reasons[1].push('observation_markers')
  }
  if (benchmarkSignals) {
    scores[1] += 1
    reasons[1].push('benchmark_markers')
  }

  const ordered = [
    { col: 1, score: scores[1] },
    { col: 2, score: scores[2] },
    { col: 3, score: scores[3] },
  ].sort((a, b) => b.score - a.score)
  const best = ordered[0]
  const second = ordered[1]
  const gap = (best?.score ?? 0) - (second?.score ?? 0)

  // No neutral fallback to 1: if we don't have real evidence, keep null and let LLM decide.
  // Small recall boost for AS_IS: allow clear observations/benchmarks to land in 1 with weaker evidence.
  // This prevents obvious "as-is" statements from becoming N/A when LLM output is missing/unparseable.
  if (!best) return { column: null, confidence: 'low', scores, reasons }
  if (best.score < 3) {
    const canBeAsIs =
      best.col === 1 &&
      best.score >= 2 &&
      (observationSignals || benchmarkSignals || leading === '1') &&
      scores[2] === 0 &&
      scores[3] === 0
    if (canBeAsIs) {
      return { column: 1, confidence: 'medium', scores, reasons }
    }
    return { column: null, confidence: 'low', scores, reasons }
  }

  // Prevent column 1 from winning when there is a clear problem/solution signal.
  if (best.col === 1 && (scores[2] >= 3 || scores[3] >= 3)) {
    return { column: null, confidence: 'low', scores, reasons }
  }

  const confidence =
    best.score >= 6 && gap >= 2 ? 'high' : best.score >= 4 && gap >= 1 ? 'medium' : 'low'
  return { column: best.col, confidence, scores, reasons }
}

const resolveSeedColumn = ({ llmColumn, derived }) => {
  const llm = coerceSeedColumnCode(llmColumn)
  const safeDerivedColumn =
    derived && (derived.column === 1 || derived.column === 2 || derived.column === 3)
      ? String(derived.column)
      : null

  // Backend heuristic is a sanity-check: override LLM only when we are highly confident.
  // Why: LLM remains the primary classifier; heuristics are brittle and should not flatten semantics.
  if (derived?.confidence === 'high' && safeDerivedColumn) return safeDerivedColumn
  if (llm) return llm
  if ((derived?.confidence === 'medium' || derived?.confidence === 'high') && safeDerivedColumn) return safeDerivedColumn
  // No technical fallback to "1": column 1 means "observation/benchmark", not "nothing detected".
  return null
}

const applySeedColumnFirstSafetyCheck = (entries) => {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => {
    const llmColumn = coerceSeedColumnCode(entry?.column)
    const derived = deriveSeedColumnFromMarkersV2(entry?.text)
    const column = resolveSeedColumn({ llmColumn, derived })
    if (process.env.NODE_ENV !== 'production') {
      console.log('[seed][column_first][resolve]', {
        text: String(entry?.text || '').trim(),
        llmRawColumn: entry?.llmRawColumn ?? null,
        llmNormalizedColumn: llmColumn,
        derivedColumn: derived?.column ?? null,
        derivedConfidence: derived?.confidence ?? null,
        derivedScores: derived?.scores ?? null,
        resolvedColumn: column,
      })
    }
    return { ...entry, column }
  })
}

const shouldNullConflictingSeedCellCode = (entry) => {
  const confidence = clampConfidence(entry?.confidence)
  const inferred = inferCellMeaning(entry?.cellCode)
  const flags = buildSeedDiagnosticFlags(entry?.text)
  // If text contains both strong problem and strong desired/requirement signals, prefer null (mixed semantics).
  if (flags.hasProblemSignal && flags.hasShouldSignal) {
    return confidence == null || confidence < 0.995
  }
  if (flags.hasShouldSignal && inferred.col && inferred.col !== 'should_be') {
    return confidence == null || confidence < 0.995
  }
  if (flags.hasProblemSignal && inferred.col && inferred.col !== 'not_working') {
    return confidence == null || confidence < 0.995
  }
  // Do not overcorrect neutral/market/context facts: avoid nulling cellCode for them.
  if (
    flags.hasAsIsSignal &&
    inferred.col &&
    inferred.col !== 'as_is' &&
    !flags.hasProblemSignal &&
    !flags.looksLikeMarketStatement
  ) {
    return confidence == null || confidence < 0.995
  }
  return false
}

const applySeedClassificationSafetyCheck = (entries) => {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => {
    if (!shouldNullConflictingSeedCellCode(entry)) return entry
    // Conservative safeguard: keep the text, but drop obviously contradictory cell guesses.
    return {
      ...entry,
      cellCode: null,
    }
  })
}

const normalizeSeedEntriesForClassification = (entries) => {
  if (!Array.isArray(entries)) return []
  const seen = new Set()
  const out = []
  const normalize = (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—•*]+/, '')
      .replace(/[\s\-–—•*]+$/, '')
      .replace(/^[\s"'“”‘’]+/, '')
      .replace(/[\s"'“”‘’]+$/, '')
      .trim()
  const dedupKey = (value) =>
    normalize(value)
      .toLowerCase()
      // Avoid Unicode property escapes for broader runtime compatibility.
      .replace(/[^A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const safeShorten = (value, maxLen = 160) => {
    const trimmed = normalize(value)
    if (trimmed.length <= maxLen) return trimmed
    const slice = trimmed.slice(0, maxLen + 1)
    const cutAt =
      Math.max(
        slice.lastIndexOf('.'),
        slice.lastIndexOf(';'),
        slice.lastIndexOf(','),
        slice.lastIndexOf('—'),
        slice.lastIndexOf('-')
      ) || 0
    const candidate = cutAt >= Math.floor(maxLen * 0.7) ? slice.slice(0, cutAt) : slice.slice(0, maxLen)
    return candidate.trim().replace(/[,\-–—;:.]+$/, '').trim()
  }

  for (const item of entries) {
    if (typeof item !== 'string') continue
    let text = normalize(item)
    if (text.length < 3) continue
    if (text.length > 220) continue
    if (text.length > 180) text = safeShorten(text, 160)
    const key = dedupKey(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

const buildSeedFallbackEntries = (text, maxEntries = 8) => {
  const chunks = String(text || '')
    // Avoid RegExp lookbehind for broader runtime compatibility.
    .split(/[\n\r]+|[.!?]\s+/)
    .map((item) => normalizeSeedText(item))
    .filter(Boolean)
  return normalizeSeedEntries(
    chunks.map((chunk) => ({ text: chunk, cellCode: null, confidence: null, kind: 'note' })),
    maxEntries
  )
}

const buildReclassPrompt = ({ locale, sessionName, entries, allowedCellIds = null }) => {
  const lines = entries.slice(0, 120).map((entry) => {
    const text = String(entry.text || '').trim().replace(/\s+/g, ' ')
    const current = coerceCellId(entry.currentCellId) || 'B2'
    return `- id:${entry.id} | current:${current} | text:${text}`
  })
  const allowedCells = Array.isArray(allowedCellIds)
    ? allowedCellIds.map((entry) => coerceCellId(entry)).filter(Boolean)
    : []
  const semantics = [
    'Rows: A=world (otoczenie, rynek, kontekst, ograniczenia zewnętrzne),',
    'B=product (produkt/system jako całość, architektura, jak działa),',
    'C=elements (konstrukcja, budowa, podzespoły, elementy składowe).',
    'Cols: 1=as_is (stan obecny), 2=not_working (problemy, tarcia, co zmienić), 3=should_be (pożądany stan / pomysł).',
    'If uncertain or unreadable, keep current cell and set confidence < 0.6 with shouldMove=false.',
    'Do not hallucinate.',
    allowedCells.length
      ? `You may use ONLY these cells: ${allowedCells.join(', ')}. Keep the column locked and choose only the best row within that set.`
      : '',
  ].join(' ')
  const instructions = [
    'You are an R&D facilitator. Classify each entry into the 3x3 matrix using the semantics above.',
    semantics,
    'Return STRICT JSON ONLY:',
    '{"classifications":[{"id":"...","suggestedCellId":"B2","confidence":0.82,"shouldMove":true,"reason":"..."}]}',
    locale === 'pl' ? 'Write reasons in Polish.' : 'Write reasons in English.',
  ].join(' ')
  const input = [`Session: ${sessionName || '—'}`, ...lines].join('\n')
  return { input, instructions }
}

const buildSummaryWithReclassPrompt = ({ locale, sessionName, entries }) => {
  const lines = entries.slice(0, 120).map((entry) => {
    const text = String(entry.text || '').trim().replace(/\s+/g, ' ')
    const current = coerceCellId(entry.currentCellId) || 'B2'
    return `- id:${entry.id} | current:${current} | text:${text}`
  })
  const semantics = [
    'Rows: A=world (otoczenie, rynek, kontekst, ograniczenia zewnętrzne),',
    'B=product (produkt/system jako całość, architektura, jak działa),',
    'C=elements (konstrukcja, budowa, podzespoły, elementy składowe).',
    'Cols: 1=as_is (stan obecny), 2=not_working (problemy, tarcia, co zmienić), 3=should_be (pożądany stan / pomysł).',
  ].join(' ')
  const instructions = [
    'You are an R&D facilitator. First classify entries into the 3x3 matrix using the semantics.',
    semantics,
    'If uncertain or unreadable, keep current cell and set confidence < 0.6 with shouldMove=false.',
    'Do NOT hallucinate. Ignore irrelevant/unreadable items in summaries.',
    'Use this rule to apply moves: if shouldMove=true AND confidence>=0.75, use suggestedCellId; otherwise keep current.',
    'Then produce three summaries:',
    'today uses A1+B1+C1, change uses A2+B2+C2, product uses A3+B3+C3.',
    'Return STRICT JSON ONLY:',
    '{"classifications":[{"id":"...","suggestedCellId":"B2","confidence":0.82,"shouldMove":true,"reason":"..."}],',
    '"summary":{"today":"...","change":"...","product":"..."}}',
    locale === 'pl' ? 'Write summaries and reasons in Polish.' : 'Write summaries and reasons in English.',
  ].join(' ')
  const input = [`Session: ${sessionName || '—'}`, ...lines].join('\n')
  return { input, instructions }
}

export const handleCoachSuggest = async (req, res) => {
  const requestId =
    req.headers['x-request-id'] ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const logStage = (stage, details = {}) => {
    console.info('[coach/suggest][stage]', {
      requestId,
      stage,
      time: new Date().toISOString(),
      ...details,
    })
  }
  const sendErrorWithId = (status, code, message, errorCategory, meta) => {
    sendJson(res, status, {
      ok: false,
      code,
      message,
      requestId,
      meta: { ...(meta || {}), errorCategory },
    })
  }
  const SUGGEST_DIAG = process.env.SUGGEST_DIAG === '1'
  console.log('[coach/suggest][boot]', {
    requestId,
    time: new Date().toISOString(),
    method: req.method,
    url: req.url,
    hasBody: !!req.body,
    bodyType: typeof req.body,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    vercelEnv: process.env.VERCEL_ENV,
    node: process.version,
  })
  console.info('[coach/suggest][store]', {
    requestId,
    store: getSessionStoreType(),
  })
  if (!req.body) {
    console.error('[coach/suggest][input]', 'Missing request body', { requestId })
  }
  console.info('[coach/suggest] handler entered', {
    requestId,
    time: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    openAIKeyLen: process.env.OPENAI_API_KEY?.length || 0,
  })
  console.info('[coach/suggest] start', {
    requestId,
    method: req.method,
    path: req.url,
    hasAiSupportHeader: Boolean(
      req.headers['x-ai-support'] || (typeof req.headers.get === 'function' && req.headers.get('x-ai-support'))
    ),
    time: new Date().toISOString(),
  })
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] })
    return
  }
  try {
    logStage('parse')
    const body = await readJsonBody(req)
    const isEmptyObject =
      body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0
    if (!body || isEmptyObject) {
      logStage('parse_error', { reason: !body ? 'invalid_json' : 'empty_body' })
      sendErrorWithId(400, 'BAD_REQUEST', 'Invalid JSON body', !body ? 'INVALID_JSON' : 'EMPTY_BODY')
      return
    }
    const sessionId = String(body.sessionId || '').trim()
    const currentUserId = String(body.currentUserId || body.userId || '').trim() || null
    if (SUGGEST_DIAG) {
      console.log('[coach/suggest] sessionId received', { requestId, sessionId: sessionId || null })
    }
    if (!sessionId) {
      sendErrorWithId(400, 'SESSION_ID_REQUIRED', 'Session id is required.', 'SESSION_ID_REQUIRED')
      return
    }
    if (!currentUserId) {
      sendErrorWithId(401, 'AUTH_REQUIRED', 'User authentication required.', 'AUTH_REQUIRED')
      return
    }
    let sessionRow = null
    let sessionLookupError = null
    let publicSessionsHeadCount = null
    let publicSessionsHeadCountError = null
    let rawCount = null
    let rawListError = null
    const envHost = process.env.SUPABASE_URL
      ? (() => {
          try {
            return new URL(process.env.SUPABASE_URL).host
          } catch {
            return null
          }
        })()
      : null
    const diag = {
      envHost,
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      receivedSessionId: sessionId,
      sessionFound: false,
      sessionEcho: null,
      sessionLookupError: null,
      publicSessionsHeadCount: null,
      publicSessionsHeadCountError: null,
      rawCount: null,
      rawListError: null,
      usedAdmin: true,
    }
    try {
      const supabaseAdmin = getSupabaseAdmin()
      const { data, error } = await supabaseAdmin
        .schema('public')
        .from('sessions')
        .select('id,user_id')
        .eq('id', sessionId)
        .maybeSingle()
      if (error) {
        sessionLookupError = error
        diag.sessionLookupError = {
          code: error?.code ?? null,
          message: error?.message ?? null,
          details: error?.details ?? null,
          hint: error?.hint ?? null,
          status: error?.status ?? null,
        }
      } else {
        sessionRow = data || null
        if (sessionRow) {
          diag.sessionFound = true
          diag.sessionEcho = { id: sessionRow.id ?? null, user_id: sessionRow.user_id ?? null }
        }
      }
      const headRes = await supabaseAdmin
        .schema('public')
        .from('sessions')
        .select('id', { count: 'exact', head: true })
      if (headRes.error) {
        publicSessionsHeadCountError = headRes.error
        diag.publicSessionsHeadCountError = {
          code: headRes.error?.code ?? null,
          message: headRes.error?.message ?? null,
          details: headRes.error?.details ?? null,
          hint: headRes.error?.hint ?? null,
          status: headRes.error?.status ?? null,
        }
      } else {
        publicSessionsHeadCount =
          typeof headRes.count === 'number' ? headRes.count : null
        diag.publicSessionsHeadCount = publicSessionsHeadCount
      }
      const rawRes = await supabaseAdmin
        .schema('public')
        .from('sessions')
        .select('id', { count: 'exact' })
        .eq('id', sessionId)
      if (rawRes.error) {
        rawListError = rawRes.error
      } else {
        rawCount = typeof rawRes.count === 'number' ? rawRes.count : (rawRes.data || []).length
        diag.rawCount = rawCount
      }
    } catch (error) {
      sessionLookupError = error
    }
    if (SUGGEST_DIAG) {
      console.log('[coach/suggest] sessionLookup', {
        requestId,
        admin: true,
        found: Boolean(sessionRow),
      })
    }
    if (sessionLookupError || rawListError) {
      diag.sessionLookupError = sessionLookupError
        ? {
            code: sessionLookupError?.code ?? null,
            message: sessionLookupError?.message ?? null,
            details: sessionLookupError?.details ?? null,
            hint: sessionLookupError?.hint ?? null,
            status: sessionLookupError?.status ?? null,
          }
        : null
      diag.rawListError = rawListError
        ? {
            code: rawListError?.code ?? null,
            message: rawListError?.message ?? null,
            details: rawListError?.details ?? null,
            hint: rawListError?.hint ?? null,
            status: rawListError?.status ?? null,
          }
        : null
      console.error('[coach/suggest][session_lookup_failed]', {
        requestId,
        message: sessionLookupError?.message,
        code: sessionLookupError?.code,
        details: sessionLookupError?.details,
      })
      sendErrorWithId(500, 'DB_LOOKUP_FAILED', 'Session lookup failed.', 'SERVER_ERROR', diag)
      return
    }
    if (!sessionRow) {
      sendErrorWithId(404, 'SESSION_NOT_FOUND', 'Session not found. Create a session first.', 'SESSION_NOT_FOUND', diag)
      return
    }
    if (String(sessionRow.user_id) !== currentUserId) {
      sendErrorWithId(403, 'FORBIDDEN', 'Access denied.', 'FORBIDDEN')
      return
    }
    let boardItemsCount = 0
    try {
      const supabaseAdmin = getSupabaseAdmin()
      const { data, error, count } = await supabaseAdmin
        .schema('public')
        .from('board_items')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
      if (error) throw error
      boardItemsCount =
        typeof count === 'number' ? count : Array.isArray(data) ? data.length : 0
    } catch (error) {
      console.error('[coach/suggest][board_items_fetch_failed]', {
        requestId,
        message: error?.message,
      })
    }
    if (SUGGEST_DIAG) {
      console.log('[coach/suggest] boardItemsCount', { requestId, sessionId, boardItemsCount })
    }
    logStage('route')
    const aiSupportEnabled = resolveAiSupportEnabled(req, body)
    const diagnosticsEnabled = await resolveDiagnosticsEnabled(req, res)
    const killSwitch = process.env.AI_SUPPORT_DISABLED === 'true'
    const aiSupportHeader = req.headers['x-ai-support']
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY)
    const openAiKeyLen = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0
    const hasContextFields = Boolean(
      body?.sessionName || (Array.isArray(body?.boardEntries) && body.boardEntries.length)
    )
    console.log('[ai] suggest input', {
      requestId,
      ts: new Date().toISOString(),
      aiSupportHeader,
      aiSupportEnabled,
      killSwitch,
      hasContextFields,
      hasOpenAiKey,
      openAiKeyLen,
      env: process.env.VERCEL ? 'vercel' : 'local',
    })
    console.info('[coach/suggest] llm_prepare', {
      requestId,
      aiSupportEnabled,
      aiSupportDisabledEnv: process.env.AI_SUPPORT_DISABLED || null,
      hasOpenAIKey: hasOpenAiKey,
      openAIKeyLen: openAiKeyLen,
      nodeEnv: process.env.NODE_ENV || null,
    })
    const lang = normalizeLang(body.lang || body.language || body.locale || 'pl')
    const action = body.action || 'NEXT'
    const askedIds = Array.isArray(body.askedIds) ? body.askedIds : []
    const askedTexts = Array.isArray(body.askedTexts)
      ? body.askedTexts.map((text) => String(text || '')).filter(Boolean)
      : []
    const askedTextSet = new Set(askedTexts.map((text) => normalizeText(text)))
    const lastQuestionText = body.lastQuestionText ? String(body.lastQuestionText) : ''
    const recentCells = Array.isArray(body.recentCells) ? body.recentCells : []
    const currentGroupCode = body.currentGroupCode || null
    const currentModeCode = body.currentModeCode || null
    const previousGroupCode = body.previousGroupCode || null
    const previousModeCode = body.previousModeCode || null
    const requestedPerspective = String(body.requestedPerspective || '').trim().toLowerCase() || null
    const requestedMode = perspectiveToMode(requestedPerspective)
    const sessionName = String(body.sessionName || '').trim()
    const boardEntriesRaw = Array.isArray(body.boardEntries)
      ? body.boardEntries
      : Array.isArray(body.boardItems)
        ? body.boardItems
        : []
    const boardEntriesForLlm = normalizeBoardEntriesForLlm(boardEntriesRaw, lang, {
      maxAnswerLen: 280,
      maxQuestionLen: 260,
    }).slice(0, 60)
    const boardEntries = boardEntriesForLlm
      .map((item) => item.text)
      .filter(Boolean)
      .slice(0, 60)
    const matrixContext =
      body.matrixContext ||
      body.matrix ||
      (currentGroupCode || currentModeCode
        ? { currentGroupCode, currentModeCode, action }
        : null)

    if (!aiSupportEnabled) {
      const reason = killSwitch ? 'kill-switch' : 'aiSupport=off'
      console.log(`[ai] LLM skipped: ${reason}`)
      logStage('fallback', { reason })
    }

    const actionNormalized = String(action || 'NEXT').toUpperCase()

    if (actionNormalized === 'SEED_FROM_BRIEF') {
      const locale = normalizeLang(body.locale || body.language || body.lang || 'pl')
      const text = String(body.text || body.brief || '').trim()
      if (!text) {
        sendJson(res, 200, {
          ok: true,
          requestId,
          source: 'fallback',
          entries: [],
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: 'EMPTY_INPUT',
          },
        })
        return
      }
      const result = await analyzeSeedLikeText({
        text,
        locale,
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: aiSupportEnabled && !killSwitch && hasOpenAiKey,
        sessionId,
        rateLimiter: limiter,
        rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        mode: 'brief',
        allowTextFallback: true,
      })
      if (result.ok && result.entries.length) {
        const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
        await recordCoachUsageEvent({
          sessionId,
          currentUserId,
          actionKey: 'seed-from-brief',
          requestId,
          meta,
        })
        sendJson(res, 200, {
          ok: true,
          requestId,
          source: result.source,
          entries: result.entries,
          usage: buildUsagePayload(meta),
          meta,
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        requestId,
        source: 'fallback',
        entries: result.fallbackEntries,
        usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
        meta: {
          ...buildMeta({ aiSupportEnabled: false, modelUsed: null }),
          errorCategory: result.meta?.errorCategory || 'LLM_FAILED',
        },
      })
      return
    }

    if (actionNormalized === 'INTERPRET_TRANSCRIPT') {
      const locale = normalizeLang(body.locale || body.language || body.lang || 'pl')
      const text = sanitizeTranscriptCorrectionText(body.text || body.transcript || '')
      const boardContext = Array.isArray(body.boardContext)
        ? body.boardContext.map((entry) => sanitizeTranscriptCorrectionText(entry)).filter(Boolean).slice(0, 8)
        : []
      if (!text) {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          text: '',
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: 'EMPTY_INPUT',
          },
        })
        return
      }
      if (!aiSupportEnabled || killSwitch || !hasOpenAiKey) {
        const reasonCategory = killSwitch
          ? 'AI_DISABLED'
          : !hasOpenAiKey
            ? 'MISSING_OPENAI_KEY'
            : 'AI_DISABLED'
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          text,
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: reasonCategory,
          },
        })
        return
      }
      const instructions =
        locale === 'pl'
          ? [
              'Poniższy tekst jest transkryptem z rozpoznawania mowy w aplikacji wspierającej rozwój pomysłów na produkty lub usługi.',
              'Kontekst domenowy: rozwój pomysłów, produkty, usługi, analiza sytuacji, użytkownik, rynek, rekomendacje, sesja, tablica.',
              'Ważne słownictwo domenowe: pomysł, użytkownik, produkt, usługa, analiza, kontekst, rekomendacje, sesja, tablica, wpis, raport, perspektywa, obserwacja, problem, rozwiązanie, facylitować, facylitowane, facylitowanie.',
              'Jeśli dostępny jest kontekst tablicy, zawiera on wcześniejsze wpisy użytkownika dotyczące analizowanego problemu lub pomysłu.',
              'Transkrypt może zawierać brak interpunkcji, błędy transkrypcji, ucięte słowa i błędne formy gramatyczne.',
              'Zrekonstruuj najbardziej prawdopodobny sens wypowiedzi.',
              'Popraw oczywiste błędy transkrypcji.',
              'Dodaj interpunkcję i wielkie litery.',
              'Podziel tekst na zdania.',
              'Zachowaj sens wypowiedzi.',
              'Uwzględnij kontekst domenowy.',
              'Jeśli podano wcześniejsze wpisy na tablicy, użyj ich jako kontekstu interpretacyjnego.',
              'Nie dopisuj nowych informacji.',
              'Nie skracaj tekstu.',
              'Zwróć wyłącznie poprawiony tekst.',
            ].join(' ')
          : [
              'The following text is a speech-to-text transcript from an application that helps users develop product or service ideas.',
              'Domain context: idea development, products, services, market analysis, user insights, recommendations, sessions, board entries.',
              'Important domain vocabulary: idea, user, product, service, analysis, context, recommendation, session, board, entry, report, perspective, observation, problem, solution, facilitate, facilitated, facilitation.',
              'If board context is provided, it contains previous notes related to the same idea or problem.',
              'The transcript may contain missing punctuation, transcription errors, truncated words, and grammar mistakes.',
              'Reconstruct the most likely intended meaning.',
              'Correct obvious transcription mistakes.',
              'Add punctuation and capitalization.',
              'Split the text into sentences.',
              'Preserve the original meaning.',
              'Use the domain context when interpreting ambiguous words.',
              'If board context is provided, use it to better interpret the transcript.',
              'Do not add new information.',
              'Do not summarize.',
              'Return only the corrected text.',
            ].join(' ')
      const promptInput = [
        `Transcript:\n${text}`,
        boardContext.length ? `Board context:\n${boardContext.map((entry) => `- ${entry}`).join('\n')}` : 'Board context:\n(none)',
      ].join('\n\n')
      try {
        const result = await runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'speech-transcript-interpret',
          input: promptInput,
          sessionId,
          language: locale === 'pl' ? 'Polish' : 'English',
          taskInstructions: instructions,
          parseResponse: (value) => {
            const correctedText = sanitizeTranscriptCorrectionText(value)
            if (!correctedText) return null
            return { text: correctedText }
          },
          fallbackData: null,
          models: {
            default: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
          },
          maxOutputTokens: 220,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })
        if (result.ok && result.data?.text) {
          const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
          await recordCoachUsageEvent({
            sessionId,
            currentUserId,
            actionKey: 'speech-transcript-interpret',
            requestId,
            meta,
          })
          const usage = buildUsagePayload(meta)
          sendJson(res, 200, {
            ok: true,
            source: 'llm',
            text: result.data.text,
            usage,
            meta,
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          text,
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
        })
        return
      } catch {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          text,
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
        })
        return
      }
    }

    if (actionNormalized === 'ASSIGN_NA') {
      const locale = normalizeLang(body.locale || body.language || 'pl')
      const items = Array.isArray(body.items) ? body.items : []
      const matrixDefinition = body.matrixDefinition
      const seedClassificationMode = resolveSeedClassificationMode()
      if (!Array.isArray(items) || !items.length || !matrixDefinition) {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          assignments: [],
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: 'EMPTY_INPUT',
          },
        })
        return
      }
      if (!aiSupportEnabled || killSwitch || !hasOpenAiKey) {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          assignments: [],
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: killSwitch
              ? 'AI_DISABLED'
              : !hasOpenAiKey
                ? 'MISSING_OPENAI_KEY'
                : 'AI_DISABLED',
          },
        })
        return
      }
      const promptInput = items
        .slice(0, 120)
        .map((item) => `- id:${item.id} | text:${String(item.text || '').trim().replace(/\s+/g, ' ')}`)
        .join('\n')
      const instructions =
        seedClassificationMode === 'column_first'
          ? [
              'You assign each note to a semantic column ONLY (as_is / not_working / should_be), while keeping a fixed default row.',
              'IMPORTANT: Use ONLY these cell codes: B1, B2, B3.',
              'B1 = as_is (stan obecny / neutralny fakt).',
              'B2 = not_working (problem / tarcie / ryzyko / szkoda / niepotrzebny wysiłek).',
              'B3 = should_be (pomysł / propozycja / wymaganie / cecha docelowa).',
              'If a note mixes problem and solution in one sentence and you cannot choose safely, omit it (do not include it in assignments).',
              'Return STRICT JSON ONLY:',
              '{"assignments":[{"id":"...","cellCode":"B2","confidence":0.72}]}',
              locale === 'pl' ? 'Write in Polish.' : 'Write in English.',
            ].join(' ')
          : [
              'You classify workshop notes into a 3x3 matrix.',
              'Rows: A=world (otoczenie, rynek, kontekst, ograniczenia zewnętrzne),',
              'B=product (produkt/system jako całość, architektura, jak działa),',
              'C=elements (konstrukcja, budowa, podzespoły, elementy składowe).',
              'Cols: 1=as_is (stan obecny), 2=not_working (problemy, tarcia, co zmienić), 3=should_be (pożądany stan / pomysł).',
              'Return STRICT JSON ONLY:',
              '{"assignments":[{"id":"...","cellCode":"B2","confidence":0.72}]}',
              'Only use cellCode A1..C3.',
              locale === 'pl' ? 'Write in Polish.' : 'Write in English.',
            ].join(' ')
      const parseAssignments = (payload) => {
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.assignments)) return null
        const normalized = payload.assignments
          .map((entry) => ({
            id: String(entry?.id || '').trim(),
            cellCode: coerceCellId(entry?.cellCode),
            confidence: Number(entry?.confidence ?? 0),
          }))
          .filter((entry) => {
            if (!entry.id || !entry.cellCode) return false
            if (seedClassificationMode !== 'column_first') return true
            return entry.cellCode === 'B1' || entry.cellCode === 'B2' || entry.cellCode === 'B3'
          })
        if (!normalized.length) return null
        return normalized
      }
      const callAssign = async (modelSet) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'assign-na',
          input: `Matrix definition: ${JSON.stringify(matrixDefinition)}\n${promptInput}`,
          sessionId,
          language: locale === 'pl' ? 'Polish' : 'English',
          taskInstructions: instructions,
          parseResponse: (value) => {
            try {
              const parsed = JSON.parse(value)
              return parsed ?? null
            } catch {
              return null
            }
          },
          fallbackData: null,
          models: modelSet,
          maxOutputTokens: 600,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })
      const defaultModels = {
        default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
        preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
        escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
      }
      const escalateModels = {
        default: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
        preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
        escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
      }
      try {
        let result = await callAssign(defaultModels)
        let assignments = result.ok ? parseAssignments(result.data) : null
        const avgConfidence =
          assignments && assignments.length
            ? assignments.reduce((sum, entry) => sum + (entry.confidence || 0), 0) /
              assignments.length
            : 0
        if (!assignments || avgConfidence < 0.6) {
          const retry = await callAssign(escalateModels)
          if (retry.ok) {
            result = retry
            assignments = parseAssignments(retry.data)
          }
        }
        if (result.ok && assignments) {
          const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
          await recordCoachUsageEvent({
            sessionId,
            currentUserId,
            actionKey: 'assign-na',
            requestId,
            meta,
          })
          const usage = buildUsagePayload(meta)
          sendJson(res, 200, {
            ok: true,
            source: 'llm',
            assignments,
            usage,
            meta,
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          assignments: [],
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
        })
        return
      } catch {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          assignments: [],
          usage: buildUsagePayload({ tokens: { input: 0, output: 0, total: 0 }, modelUsed: null }),
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
        })
        return
      }
    }

    if (!aiSupportEnabled && actionNormalized !== 'REPORT_SUMMARY') {
      const fallbackText =
        lang === 'pl'
          ? actionNormalized === 'DEEPEN'
            ? 'Co warto doprecyzować lub pogłębić w tym wątku?'
            : actionNormalized === 'PERSPECTIVE'
              ? 'Z jakiej jeszcze perspektywy warto na to spojrzeć?'
              : 'Co jest tutaj najważniejsze do doprecyzowania?'
          : actionNormalized === 'DEEPEN'
            ? 'What should we clarify or explore deeper here?'
            : actionNormalized === 'PERSPECTIVE'
              ? 'What other perspective is worth considering?'
              : 'What is the most important thing to clarify here?'
      const fallbackQuestion = normalizeQuestion({ text: fallbackText })
      sendJson(res, 200, {
        ok: true,
        source: 'fallback',
        question: fallbackQuestion,
        data: { question: fallbackQuestion },
        meta: buildMeta({ aiSupportEnabled: false, modelUsed: null, escalated: false }),
      })
      return
    }

    if (actionNormalized === 'RECLASSIFY_ENTRIES') {
      const locale = normalizeLang(body.locale || body.language || 'pl')
      const entries = Array.isArray(body.entries) ? body.entries : []
      const allowedCellIds = Array.isArray(body.allowedCellIds)
        ? body.allowedCellIds.map((entry) => coerceCellId(entry)).filter(Boolean)
        : []
      if (!entries.length) {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          classifications: [],
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: 'EMPTY_INPUT',
          },
        })
        return
      }
      if (!aiSupportEnabled || killSwitch || !hasOpenAiKey) {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          classifications: [],
          meta: {
            aiSupportEnabled: false,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: killSwitch
              ? 'AI_DISABLED'
              : !hasOpenAiKey
                ? 'MISSING_OPENAI_KEY'
                : 'AI_DISABLED',
          },
        })
        return
      }
      const { input, instructions } = buildReclassPrompt({
        locale,
        sessionName,
        entries,
        allowedCellIds,
      })
      try {
        const result = await runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-reclass',
          input,
          sessionId,
          language: locale === 'pl' ? 'Polish' : 'English',
          taskInstructions: instructions,
          parseResponse: (value) => {
            try {
              const parsed = JSON.parse(value)
              if (!parsed || typeof parsed !== 'object') return null
              if (!Array.isArray(parsed.classifications)) return null
              return parsed
            } catch {
              return null
            }
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
        if (result.ok && result.data?.classifications) {
          const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
          await recordCoachUsageEvent({
            sessionId,
            currentUserId,
            actionKey: 'report-reclass',
            requestId,
            meta,
          })
          const allowedSet = new Set(allowedCellIds)
          const classifications = result.data.classifications
            .map((entry) => ({
              id: String(entry?.id || ''),
              suggestedCellId: coerceCellId(entry?.suggestedCellId) || 'B2',
              confidence: Number(entry?.confidence ?? 0),
              shouldMove: Boolean(entry?.shouldMove),
              reason: String(entry?.reason || ''),
            }))
            .map((entry) => ({
              ...entry,
              suggestedCellId:
                allowedSet.size && !allowedSet.has(entry.suggestedCellId)
                  ? allowedCellIds[1] || allowedCellIds[0] || 'B2'
                  : entry.suggestedCellId,
            }))
            .filter((entry) => entry.id)
          sendJson(res, 200, {
            ok: true,
            source: 'llm',
            classifications,
            meta,
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          classifications: [],
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
        })
        return
      } catch {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          classifications: [],
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
        })
        return
      }
    }

    if (actionNormalized === 'REPORT_FULL') {
      const locale = normalizeLang(body.locale || body.language || 'pl')
      const cells = body.cells || {}
      const entries = Array.isArray(body.entries) ? body.entries : []
      const allSections = [
        pickCellTexts(cells, ['A1', 'B1', 'C1']),
        pickCellTexts(cells, ['A2', 'B2', 'C2']),
        pickCellTexts(cells, ['A3', 'B3', 'C3']),
      ]
      const hasAnyContent = allSections.some((section) => section.length > 0)
      if (!hasAnyContent && entries.length === 0) {
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          summary: buildSummaryFallback(locale, 'EMPTY_INPUT').summary,
          recommendations: {
            based_on_user_ideas: [],
            morphological: [],
            market_trends: [],
          },
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'EMPTY_INPUT' },
        })
        return
      }
      if (!aiSupportEnabled || killSwitch || !hasOpenAiKey) {
        const reasonCategory = killSwitch
          ? 'AI_DISABLED'
          : !hasOpenAiKey
            ? 'MISSING_OPENAI_KEY'
            : 'AI_DISABLED'
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          summary: buildSummaryFallback(locale, reasonCategory).summary,
          recommendations: {
            based_on_user_ideas: [],
            morphological: [],
            market_trends: [],
          },
          meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: reasonCategory },
        })
        return
      }

      const preprocessInput = [
        `Session: ${sessionName || '—'}`,
        `Entries:`,
        ...entries.map((entry) => `- ${String(entry?.text || '').trim()}`),
      ].join('\n')
      let analysisJson = null
      try {
        const preprocessResult = await runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-preprocess',
          input: preprocessInput,
          sessionId,
          language: locale === 'pl' ? 'Polish' : 'English',
          taskInstructions:
            'Return JSON with keys: key_themes (array), tensions (array), representative_items (array of strings, max 10), user_intent (string).',
          parseResponse: (value) => {
            try {
              const parsed = JSON.parse(value)
              if (!parsed || typeof parsed !== 'object') return null
              if (!Array.isArray(parsed.key_themes)) return null
              if (!Array.isArray(parsed.tensions)) return null
              if (!Array.isArray(parsed.representative_items)) return null
              if (typeof parsed.user_intent !== 'string') return null
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
          await recordCoachUsageEvent({
            sessionId,
            currentUserId,
            actionKey: 'report-preprocess',
            requestId,
            meta: buildMeta(preprocessResult.meta || { aiSupportEnabled: true, modelUsed: null }),
          })
          analysisJson = preprocessResult.data
        }
      } catch {
        analysisJson = null
      }

      const fullPrompt = [
        `Session: ${sessionName || '—'}`,
        `Analysis JSON: ${analysisJson ? JSON.stringify(analysisJson) : 'null'}`,
        `Entries:`,
        ...entries.map((entry) => `- ${String(entry?.text || '').trim()}`),
      ].join('\n')

      const parseFullReport = (value) => {
        try {
          const parsed = JSON.parse(value)
          if (!parsed || typeof parsed !== 'object') return null
          if (!parsed.summary || typeof parsed.summary !== 'object') return null
          if (
            typeof parsed.summary.today !== 'string' ||
            typeof parsed.summary.change !== 'string' ||
            typeof parsed.summary.product !== 'string'
          ) {
            return null
          }
          const recs = parsed.recommendations
          if (!recs || typeof recs !== 'object') return null
          const groups = ['based_on_user_ideas', 'morphological', 'market_trends']
          if (!groups.every((key) => Array.isArray(recs[key]))) return null
          const isValidItem = (item) =>
            item &&
            typeof item.title === 'string' &&
            typeof item.rationale === 'string' &&
            typeof item.how_to_test === 'string' &&
            (!item.methods || Array.isArray(item.methods)) &&
            (!item.confidence || ['low', 'med', 'high'].includes(item.confidence))
          if (!recs.based_on_user_ideas.every(isValidItem)) return null
          if (!recs.morphological.every(isValidItem)) return null
          if (!recs.market_trends.every(isValidItem)) return null
          return parsed
        } catch {
          return null
        }
      }

      const runReportModel = async (modelOverride) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-full',
          input: fullPrompt,
          sessionId,
          language: locale === 'pl' ? 'Polish' : 'English',
          taskInstructions:
            'Return JSON with keys: summary {today, change, product} and recommendations {based_on_user_ideas[], morphological[], market_trends[]}. Each recommendation item must include title, rationale, how_to_test, methods (array), confidence (low|med|high). Keep recommendations tied to entries.',
          parseResponse: parseFullReport,
          fallbackData: null,
          models: {
            default: modelOverride || (process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini'),
            preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
            escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
          },
          maxOutputTokens: 900,
          rateLimiter: limiter,
          rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
        })

      let result = await runReportModel()
      if (!result.ok || !result.data) {
        result = await runReportModel(process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini')
      }
      if (result.ok && result.data) {
        const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
        await recordCoachUsageEvent({
          sessionId,
          currentUserId,
          actionKey: 'report-full',
          requestId,
          meta,
        })
        const usage = buildUsagePayload(meta)
        sendJson(res, 200, {
          ok: true,
          source: 'llm',
          summary: result.data.summary,
          recommendations: result.data.recommendations,
          usage,
          meta,
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        source: 'fallback',
        summary: buildSummaryFallback(locale, 'LLM_FAILED').summary,
        recommendations: {
          based_on_user_ideas: [],
          morphological: [],
          market_trends: [],
        },
        meta: { ...buildMeta({ aiSupportEnabled: false, modelUsed: null }), errorCategory: 'LLM_FAILED' },
      })
      return
    }

    if (actionNormalized === 'REPORT_SUMMARY') {
      const locale = normalizeLang(body.locale || body.language || 'pl')
      const cells = body.cells || {}
      const entries = Array.isArray(body.entries) ? body.entries : []
      const allSections = [
        pickCellTexts(cells, ['A1', 'B1', 'C1']),
        pickCellTexts(cells, ['A2', 'B2', 'C2']),
        pickCellTexts(cells, ['A3', 'B3', 'C3']),
      ]
      const hasAnyContent = allSections.some((section) => section.length > 0)
      if (!hasAnyContent && entries.length === 0) {
        sendJson(res, 200, buildSummaryFallback(locale, 'EMPTY_INPUT'))
        return
      }
      if (!aiSupportEnabled || killSwitch || !hasOpenAiKey) {
        const reasonCategory = killSwitch
          ? 'AI_DISABLED'
          : !hasOpenAiKey
            ? 'MISSING_OPENAI_KEY'
            : 'AI_DISABLED'
        sendJson(res, 200, buildSummaryFallback(locale, reasonCategory))
        return
      }
      const prompt = entries.length
        ? buildSummaryWithReclassPrompt({ locale, sessionName, entries })
        : buildSummaryPrompt({ locale, sessionName, cells })
      try {
        const result = await runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-summary',
          input: prompt.summaryInput || prompt.input,
          sessionId,
          language: locale === 'pl' ? 'Polish' : 'English',
          taskInstructions: prompt.instructions,
          parseResponse: (value) => {
            try {
              const parsed = JSON.parse(value)
              if (!parsed || typeof parsed !== 'object') return null
              if (entries.length) {
                if (!parsed.summary || typeof parsed.summary !== 'object') return null
                if (!Array.isArray(parsed.classifications)) return null
                return parsed
              }
              if (!parsed.today || !parsed.change || !parsed.product) return null
              return parsed
            } catch {
              return null
            }
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
        if (result.ok && result.data) {
          const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
          await recordCoachUsageEvent({
            sessionId,
            currentUserId,
            actionKey: 'report-summary',
            requestId,
            meta,
          })
          const usage = buildUsagePayload(meta)
          if (entries.length && result.data.summary && result.data.classifications) {
            const classifications = result.data.classifications
              .map((entry) => ({
                id: String(entry?.id || ''),
                suggestedCellId: coerceCellId(entry?.suggestedCellId) || 'B2',
                confidence: Number(entry?.confidence ?? 0),
                shouldMove: Boolean(entry?.shouldMove),
                reason: String(entry?.reason || ''),
              }))
              .filter((entry) => entry.id)
            sendJson(res, 200, {
              ok: true,
              source: 'llm',
              summary: result.data.summary,
              classifications,
              usage,
              meta,
            })
          } else {
            sendJson(res, 200, {
              ok: true,
              source: 'llm',
              summary: result.data,
              usage,
              meta,
            })
          }
          return
        }
        sendJson(res, 200, buildSummaryFallback(locale, 'LLM_FAILED'))
        return
      } catch {
        sendJson(res, 200, buildSummaryFallback(locale, 'LLM_FAILED'))
        return
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      if (!sessionName || !Array.isArray(boardEntriesRaw)) {
        sendErrorWithId(400, 'MISSING_CONTEXT', 'Missing session context.', 'MISSING_CONTEXT')
        return
      }
    }

    const memory = getSessionMemory(body.sessionId) || {
      currentCell: null,
      recentCells: [],
      visitCounts: {},
      cellPointers: {},
    }
    if (body.sessionId) {
      const sessionState = await getSessionState(body.sessionId)
      if (sessionState) {
        const storedCell =
          sessionState.current_group_code && Number.isFinite(Number(sessionState.current_mode_code))
            ? { group: sessionState.current_group_code, mode: Number(sessionState.current_mode_code) }
            : null
        if (storedCell) {
          memory.currentCell = storedCell
        }
        memory.recentCells = safeParseJson(sessionState.recent_cells, memory.recentCells)
        memory.visitCounts = safeParseJson(sessionState.visit_counts, memory.visitCounts)
        memory.cellPointers = safeParseJson(sessionState.cell_pointers, memory.cellPointers)
      }
    }

    const persistMemory = () => {
      if (!body.sessionId) return
      void updateSessionStateRow({
        sessionId: body.sessionId,
        current_group_code: memory.currentCell?.group ?? null,
        current_mode_code: memory.currentCell?.mode ?? null,
        recent_cells: JSON.stringify(memory.recentCells || []),
        visit_counts: JSON.stringify(memory.visitCounts || {}),
        cell_pointers: JSON.stringify(memory.cellPointers || {}),
      }).catch((error) => {
        console.error('[coach/suggest][session_state_update_failed]', {
          requestId,
          name: error?.name,
          message: error?.message,
        })
      })
    }

    const updateMemoryCell = (cell) => {
      if (!cell || !cell.group || !cell.mode) return
      memory.currentCell = cell
      const key = cellKey(cell.group, cell.mode)
      memory.recentCells = [key, ...memory.recentCells.filter((k) => k !== key)].slice(0, 5)
      memory.visitCounts[key] = (memory.visitCounts[key] || 0) + 1
      persistMemory()
    }

    const targetArea = resolveTargetArea({
      requestedPerspective,
      requestedMode,
      currentModeCode,
      action: actionNormalized,
    })
    const targetMode = TARGET_AREA_TO_MODE[targetArea]
    const fallbackGroup =
      ['A', 'B', 'C'].includes(String(currentGroupCode))
        ? String(currentGroupCode)
        : memory.currentCell?.group && ['A', 'B', 'C'].includes(String(memory.currentCell.group))
          ? String(memory.currentCell.group)
          : ['A', 'B', 'C'].includes(String(previousGroupCode))
            ? String(previousGroupCode)
            : 'B'
    const targetCell = { group: fallbackGroup, mode: targetMode }
    const previousQuestions = [...askedTexts, lastQuestionText].filter(Boolean)
    const sendQuestion = async ({ source, text, metaInput, reason = '', contradictionSignal = '', errorCategory = null }) => {
      updateMemoryCell(targetCell)
      const meta = {
        ...buildMeta(metaInput || { aiSupportEnabled: source !== 'fallback', modelUsed: null }),
        source,
        errorCategory,
      }
      const finalQuestion = normalizeQuestion(
        buildContextualQuestionObject({
          text,
          targetArea,
          groupCode: targetCell.group,
          reason,
          contradictionSignal,
          source,
        })
      )
      assertQuestionShape(finalQuestion, 'llm_contextual_question')
      if (source !== 'fallback') {
        await recordCoachUsageEvent({
          sessionId,
          currentUserId,
          actionKey: `coach-${String(actionNormalized || '').toLowerCase()}`,
          requestId,
          meta,
        })
      }
      console.log('[coach/suggest][llm-first-question][result]', {
        requestId,
        action: actionNormalized,
        requestedPerspective,
        target_area: targetArea,
        target_cell: `${targetCell.group}:${targetCell.mode}`,
        source,
        modelUsed: meta.modelUsed,
        tokens: meta.tokens,
        reason,
        contradiction_signal: contradictionSignal,
        questionText: finalQuestion?.text ?? null,
      })
      sendJson(res, 200, {
        ok: true,
        source,
        question: finalQuestion,
        data: { questions: [{ ...finalQuestion }] },
        groundedCount: 0,
        meta,
        usage: {
          model: meta.modelUsed,
          tokensIn: meta.tokens.input,
          tokensOut: meta.tokens.output,
        },
      })
    }

    const sendFallbackQuestion = async (errorCategory) => {
      const text = buildContextualFallbackQuestion({ lang, targetArea, previousQuestions })
      await sendQuestion({
        source: 'fallback',
        text,
        metaInput: {
          aiSupportEnabled: false,
          modelUsed: null,
          escalated: false,
          tokens: { input: 0, output: 0, total: 0 },
        },
        reason: 'deterministic fallback after unavailable or invalid LLM response',
        contradictionSignal: targetArea,
        errorCategory,
      })
    }

    console.log('[coach/suggest][llm-first-question][start]', {
      requestId,
      action: actionNormalized,
      requestedPerspective,
      requestedMode,
      target_area: targetArea,
      target_cell: `${targetCell.group}:${targetCell.mode}`,
      board_items_count: boardEntries.length,
      asked_texts_count: askedTexts.length,
      csv_used: false,
    })
    console.log('[coach/suggest][entry_context]', {
      requestId,
      ...getEntryContextStats(boardEntriesForLlm),
    })

    if (!aiSupportEnabled || killSwitch || !hasOpenAiKey) {
      logStage('fallback', {
        reason: killSwitch ? 'kill-switch' : !hasOpenAiKey ? 'missing-openai-key' : 'aiSupport=off',
        target_area: targetArea,
      })
      await sendFallbackQuestion(killSwitch ? 'AI_DISABLED' : !hasOpenAiKey ? 'MISSING_OPENAI_KEY' : 'AI_DISABLED')
      return
    }

    logStage('llm', { aiSupportEnabled: true, mode: 'llm-first-question', target_area: targetArea })
    const prompt = buildContextualQuestionPrompt({
      lang,
      targetArea,
      sessionName,
      boardEntriesRaw: boardEntriesForLlm,
      askedTexts,
      lastQuestionText,
    })
    const runContextualQuestion = async ({ input, repair = false }) => {
      let rawResponse = ''
      let validationReason = ''
      const result = await runLlmTask({
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        task: repair ? 'coach-contextual-question-repair' : 'coach-contextual-question',
        input,
        sessionId,
        language: lang === 'pl' ? 'Polish' : 'English',
        taskInstructions:
          lang === 'pl'
            ? 'Zwróć wyłącznie ścisły JSON z jednym pytaniem po polsku. Bez markdown, bez komentarzy.'
            : 'Return only strict JSON with one English question. No markdown, no commentary.',
        parseResponse: (value) => {
          rawResponse = String(value || '')
          const parsed = parseContextualQuestionResponse({
            value,
            targetArea,
            lang,
            previousQuestions,
          })
          if (!parsed.ok) {
            validationReason = parsed.reason
            return null
          }
          return parsed.data
        },
        fallbackData: null,
        models: {
          default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
          preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
          escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
        },
        maxOutputTokens: 260,
        rateLimiter: limiter,
        rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      })
      return { ...result, rawResponse, validationReason }
    }

    let result
    let firstInvalidResult = null
    try {
      result = await runContextualQuestion({ input: prompt })
    } catch (err) {
      console.error('[coach/suggest][llm-first-question][llm_error]', {
        requestId,
        name: err?.name,
        message: err?.message,
        stack: typeof err?.stack === 'string' ? err.stack.slice(0, 800) : null,
        status: err?.status || err?.response?.status || null,
      })
      await sendFallbackQuestion('LLM_FAILED')
      return
    }

    if (!result.ok || !result.data?.question) {
      firstInvalidResult = result
      console.warn('[coach/suggest][llm-first-question][invalid]', {
        requestId,
        target_area: targetArea,
        reason: result.validationReason || result.error || 'invalid_response',
        raw: String(result.rawResponse || '').slice(0, 800),
      })
      const repairPrompt = buildQuestionRepairPrompt({
        originalPrompt: prompt,
        rawResponse: result.rawResponse,
        validationReason: result.validationReason || result.error,
        targetArea,
        lang,
      })
      try {
        result = await runContextualQuestion({ input: repairPrompt, repair: true })
      } catch (err) {
        console.error('[coach/suggest][llm-first-question][repair_error]', {
          requestId,
          name: err?.name,
          message: err?.message,
          stack: typeof err?.stack === 'string' ? err.stack.slice(0, 800) : null,
        })
        await sendFallbackQuestion('LLM_REPAIR_FAILED')
        return
      }
    }

    if (!result.ok || !result.data?.question) {
      console.warn('[coach/suggest][llm-first-question][repair_invalid]', {
        requestId,
        target_area: targetArea,
        reason: result.validationReason || result.error || 'invalid_repair_response',
        raw: String(result.rawResponse || '').slice(0, 800),
      })
      await sendFallbackQuestion('LLM_INVALID')
      return
    }

    const meta = {
      ...buildMeta(
        firstInvalidResult
          ? mergeLlmMetas(firstInvalidResult.meta, result.meta)
          : result.meta || { aiSupportEnabled: true, modelUsed: null }
      ),
      source: 'llm_contextual',
    }
    await sendQuestion({
      source: 'llm_contextual',
      text: result.data.question,
      metaInput: meta,
      reason: result.data.reason,
      contradictionSignal: result.data.contradiction_signal,
    })
    return
  } catch (error) {
    console.error('[coach/suggest][LLM_ERROR]', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      cause: error?.cause,
    })
    console.error('[coach/suggest] fatal error before LLM', {
      name: error?.name,
      message: error?.message,
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 1000) : null,
    })
    logStage('error', { name: error?.name, message: error?.message })
    if (error?.code === 'ENV_MISSING') {
      sendErrorWithId(500, 'ENV_MISSING', error?.message || 'Missing environment configuration.', 'ENV_MISSING')
      return
    }
    sendErrorWithId(500, 'SERVER_ERROR', 'Server error.', error?.code || 'UNHANDLED_EXCEPTION')
  }
}
