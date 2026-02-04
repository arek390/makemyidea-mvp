import fs from 'node:fs'
import path from 'node:path'
import { runLlmTask, createRateLimiter } from '../../llm/llmRouter.mjs'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getSessionState, getSessionStoreType, updateSessionStateRow } from '../../engine/storage/sessionStore.mjs'
import {
  buildMeta,
  readJsonBody,
  resolveAiSupportEnabled,
  resolveDiagnosticsEnabled,
  sendError,
  sendJson,
} from '../_lib/http.js'

let cachedDataset = null
const limiter = createRateLimiter({ windowMs: 60_000, max: 20 })

const parseCsvRow = (line, delimiter) => {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result.map((value) => value.trim())
}

const parseCsv = (contents) => {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const delimiter = ';'
  const headers = parseCsvRow(lines[0], delimiter)
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line, delimiter)
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
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

const resolveCsvPath = () =>
  path.join(process.cwd(), 'public', 'questions_enriched_pl_eng.csv')

const loadQuestionsFromCsvOnce = () => {
  if (cachedDataset) return cachedDataset
  const csvPath = resolveCsvPath()
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV_NOT_FOUND at ${csvPath}`)
  }
  const contents = fs.readFileSync(csvPath, 'utf8')
  const rows = parseCsv(contents)
  if (rows.length <= 1000) {
    throw new Error(`CSV_INVALID: rows=${rows.length}`)
  }
  const byId = new Map()
  const langSet = new Set()
  rows.forEach((row) => {
    const id = row.id
    if (!id) return
    const lang = normalizeLang(row.lang)
    langSet.add(lang)
    const entry = byId.get(id) || {
      id,
      group_code: row.group_code,
      mode_code: Number(row.mode_code),
      category_code: row.category_code,
      intent_code: row.intent_code,
      difficulty: Number(row.difficulty),
      priority: row.priority ? Number(row.priority) : 50,
      is_active: row.is_active ? Number(row.is_active) : 1,
      texts: {},
    }
    entry.texts[lang] = row.text ?? ''
    byId.set(id, entry)
  })
  const uniqueIds = byId.size
  if (uniqueIds < 800 || uniqueIds > 900) {
    throw new Error(`CSV_INVALID: uniqueIds=${uniqueIds}`)
  }
  if (!langSet.has('pl') || !langSet.has('en')) {
    throw new Error(`CSV_INVALID: langs=${Array.from(langSet).join(',')}`)
  }
  cachedDataset = {
    byId,
    list: Array.from(byId.values()),
    stats: { rows: rows.length, uniqueIds, langs: Array.from(langSet) },
    csvPath,
  }
  return cachedDataset
}

const sortByNumericSuffix = (items) =>
  [...items].sort((a, b) => {
    const aNum = Number(String(a.id).split('_')[1] || 0)
    const bNum = Number(String(b.id).split('_')[1] || 0)
    if (aNum === bNum) return String(a.id).localeCompare(String(b.id))
    return aNum - bNum
  })

const pickFirst = (items) => (items.length ? items[0] : null)

const pickRandom = (items) => {
  if (!items.length) return null
  return items[Math.floor(Math.random() * items.length)]
}

const listNeighborCells = (group, mode) => {
  const groups = ['A', 'B', 'C']
  const groupIndex = groups.indexOf(group)
  if (groupIndex === -1) return []
  const neighbors = []
  for (let g = -1; g <= 1; g += 1) {
    for (let m = -1; m <= 1; m += 1) {
      if (g === 0 && m === 0) continue
      const nextGroup = groups[groupIndex + g]
      const nextMode = mode + m
      if (!nextGroup) continue
      if (nextMode < 1 || nextMode > 3) continue
      neighbors.push({ group: nextGroup, mode: nextMode })
    }
  }
  return neighbors
}

const CELL_GROUPS = ['A', 'B', 'C']
const CELL_MODES = [1, 2, 3]

const cellKey = (group, mode) => `${group}:${mode}`

const listAllCells = () =>
  CELL_GROUPS.flatMap((group) => CELL_MODES.map((mode) => ({ group, mode })))

const listNeighborCellsChebyshev = (group, mode) => {
  const neighbors = []
  const groupIndex = CELL_GROUPS.indexOf(group)
  if (groupIndex === -1) return neighbors
  for (let dg = -1; dg <= 1; dg += 1) {
    for (let dm = -1; dm <= 1; dm += 1) {
      if (dg === 0 && dm === 0) continue
      const nextGroup = CELL_GROUPS[groupIndex + dg]
      const nextMode = mode + dm
      if (!nextGroup) continue
      if (nextMode < 1 || nextMode > 3) continue
      neighbors.push({ group: nextGroup, mode: nextMode })
    }
  }
  return neighbors
}

const getCellQuestions = (dataset, group, mode) =>
  sortByNumericSuffix(
    dataset.list.filter(
      (q) => Number(q.is_active) === 1 && q.group_code === group && Number(q.mode_code) === Number(mode)
    )
  )

const pickSequentialFromCell = ({ dataset, group, mode, pointer = 0, askedSet }) => {
  const list = getCellQuestions(dataset, group, mode)
  if (!list.length) return { question: null, nextPointer: pointer }
  const start = pointer % list.length
  let idx = start
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[idx]
    if (!askedSet || !askedSet.has(candidate.id)) {
      return { question: candidate, nextPointer: (idx + 1) % list.length }
    }
    idx = (idx + 1) % list.length
  }
  return { question: list[start], nextPointer: (start + 1) % list.length }
}

const pickRandomFromCell = ({ dataset, group, mode, askedSet }) => {
  const list = getCellQuestions(dataset, group, mode)
  if (!list.length) return null
  if (askedSet && askedSet.size) {
    const unasked = list.filter((q) => !askedSet.has(q.id))
    if (unasked.length) {
      return unasked[Math.floor(Math.random() * unasked.length)]
    }
  }
  return list[Math.floor(Math.random() * list.length)]
}

const mapQuestion = (question, lang) => ({
  id: question.id,
  text: question.texts[lang] || question.texts.pl || '',
  group_code: question.group_code,
  mode_code: question.mode_code,
  category_code: question.category_code,
  intent_code: question.intent_code,
  difficulty: question.difficulty,
  priority: question.priority,
})

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

const buildReclassPrompt = ({ locale, sessionName, entries }) => {
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
    'If uncertain or unreadable, keep current cell and set confidence < 0.6 with shouldMove=false.',
    'Do not hallucinate.',
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

export default async function handler(req, res) {
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
    const sessionName = String(body.sessionName || '').trim()
    const boardEntriesRaw = Array.isArray(body.boardEntries)
      ? body.boardEntries
      : Array.isArray(body.boardItems)
        ? body.boardItems
        : []
    const boardEntries = boardEntriesRaw
      .map((item) => (typeof item === 'string' ? item : item?.text))
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

    if (actionNormalized === 'ASSIGN_NA') {
      const locale = normalizeLang(body.locale || body.language || 'pl')
      const items = Array.isArray(body.items) ? body.items : []
      const matrixDefinition = body.matrixDefinition
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
      const instructions = [
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
          .filter((entry) => entry.id && entry.cellCode)
        if (!normalized.length) return null
        return normalized
      }
      const callAssign = async (modelSet) =>
        runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'assign-na',
          input: `Matrix definition: ${JSON.stringify(matrixDefinition)}\n${promptInput}`,
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
      })
      try {
        const result = await runLlmTask({
          apiKey: process.env.OPENAI_API_KEY,
          aiSupportEnabled: true,
          task: 'report-reclass',
          input,
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

    const dataset = loadQuestionsFromCsvOnce()

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

    const resolveCurrentCell = () => {
      if (currentGroupCode && Number.isFinite(Number(currentModeCode))) {
        return { group: String(currentGroupCode), mode: Number(currentModeCode) }
      }
      return memory.currentCell
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

    const pickPerspectiveCell = () => {
      const current = resolveCurrentCell()
      if (!current) return null
      const neighbors = listNeighborCellsChebyshev(current.group, Number(current.mode))
      const avoidKey =
        previousGroupCode && Number.isFinite(Number(previousModeCode))
          ? `${previousGroupCode}:${Number(previousModeCode)}`
          : null
      const recentSet = new Set([...memory.recentCells, ...recentCells])
      const scored = neighbors.map((cell) => {
        const key = cellKey(cell.group, cell.mode)
        const visitScore = memory.visitCounts[key] || 0
        let score = -visitScore
        if (!recentSet.has(key)) score += 2
        if (avoidKey && key === avoidKey) score -= 3
        return { cell, key, score }
      })
      scored.sort((a, b) => b.score - a.score)
      const bestScore = scored[0]?.score ?? 0
      const best = scored.filter((s) => s.score === bestScore)
      const pick = best[Math.floor(Math.random() * best.length)] || scored[0]
      if (process.env.DEBUG_PERSPECTIVE === '1') {
        console.log('[coach/suggest][perspective]', {
          requestId,
          prevCell: `${current.group}:${Number(current.mode)}`,
          avoidCell: avoidKey,
          recentCells: [...recentSet],
          candidates: scored.map((s) => ({ key: s.key, score: s.score })),
          chosen: pick?.key ?? null,
        })
      }
      return pick ? pick.cell : null
    }

    const pickRandomCell = () => {
      const current = resolveCurrentCell()
      const all = listAllCells()
      const eligible = current
        ? all.filter((cell) => cell.group !== current.group || cell.mode !== Number(current.mode))
        : all
      return eligible[Math.floor(Math.random() * eligible.length)] || null
    }

    const selectBaseQuestion = (localAskedIds = [], mode) => {
      const askedSet = new Set(localAskedIds.filter(Boolean))
      const current = resolveCurrentCell()
      const pickFromCell = (cell) => {
        if (!cell) return { question: null, cell: null, pointer: null }
        const key = cellKey(cell.group, cell.mode)
        const pointer = memory.cellPointers[key] || 0
        const { question, nextPointer } = pickSequentialFromCell({
          dataset,
          group: cell.group,
          mode: Number(cell.mode),
          pointer,
          askedSet,
        })
        memory.cellPointers[key] = nextPointer
        updateMemoryCell(cell)
        return { question, cell, pointer: nextPointer }
      }
      if (mode === 'DEEPEN') {
        const target = current || pickRandomCell()
        return pickFromCell(target)
      }
      if (mode === 'PERSPECTIVE') {
        const nextCell = pickPerspectiveCell() || pickRandomCell()
        return pickFromCell(nextCell)
      }
      if (mode === 'NEXT') {
        const nextCell = pickRandomCell()
        if (!nextCell) return { question: null, cell: null, pointer: null }
        const question = pickRandomFromCell({
          dataset,
          group: nextCell.group,
          mode: Number(nextCell.mode),
          askedSet,
        })
        updateMemoryCell(nextCell)
        return { question, cell: nextCell, pointer: null }
      }
      return { question: null, cell: null, pointer: null }
    }

    const buildBaseLog = (payload) =>
      console.log('[coach/suggest][base_select]', {
        requestId,
        ...payload,
      })

    const shouldRejectDuplicateText = (text) => {
      const normalized = normalizeText(text)
      if (!normalized) return true
      if (lastQuestionText && normalizeText(lastQuestionText) === normalized) return true
      if (askedTextSet.has(normalized)) return true
      return false
    }

    if (!aiSupportEnabled) {
      logStage('llm', { aiSupportEnabled: false })
      sendJson(res, 200, {
        ok: false,
        code: 'LLM_DISABLED',
        message: 'LLM disabled.',
        meta: buildMeta({ aiSupportEnabled: false, modelUsed: null, escalated: false }),
      })
      return
    }
    logStage('llm', { aiSupportEnabled: true })
    const limitedEntries = boardEntries.slice(0, 10).map((entry) => String(entry || '').trim()).filter(Boolean)
    const templateUsed = limitedEntries.length === 0 ? 'empty_board' : 'context'
    const buildPrompt = (baseQuestionText) => {
      if (lang === 'pl') {
        if (templateUsed === 'empty_board') {
          return [
            'Masz zredagować jedno pytanie facylitacyjne dla użytkownika.',
            `Tytuł sesji: ${sessionName || ''}`,
            `Bazowe pytanie (CSV): ${baseQuestionText}`,
            'Przepisz bazowe pytanie na naturalne pytanie w 2. osobie. Jedno zdanie.',
            'Bez słów: użytkownik, system, analiza, matryca. Nie wspominaj, że tablica jest pusta.',
            'Zachowaj sens bazowego pytania. Zwróć tylko pytanie.',
          ].join('\n')
        }
        return [
          'Masz zredagować jedno pytanie facylitacyjne.',
          `Tytuł sesji: ${sessionName || ''}`,
          `Bazowe pytanie (CSV): ${baseQuestionText}`,
          `Wpisy użytkownika (skrócone):\n${limitedEntries
            .map((item) => `- ${item}`)
            .join('\n')}`,
          'Przepisz bazowe pytanie na naturalne pytanie w 2. osobie, które nawiązuje do wpisów (bez cytowania dosłownie długich fragmentów).',
          'Jedno zdanie. Zachowaj cel bazowego pytania.',
          'Nie używaj słów: użytkownik, system, analiza, matryca. Nie używaj kodów A1..C3.',
          'Zwróć tylko pytanie.',
        ].join('\n')
      }
      if (templateUsed === 'empty_board') {
        return [
          'You must rewrite a single facilitation question for the user.',
          `Session title: ${sessionName || ''}`,
          `Base question (CSV): ${baseQuestionText}`,
          'Rewrite the base question into a natural second-person question. One sentence.',
          'Do not use the words: user, system, analysis, matrix. Do not mention the board is empty.',
          'Keep the intent of the base question. Return only the question.',
        ].join('\n')
      }
      return [
        'You must rewrite a single facilitation question.',
        `Session title: ${sessionName || ''}`,
        `Base question (CSV): ${baseQuestionText}`,
        `User entries (short):\n${limitedEntries.map((item) => `- ${item}`).join('\n')}`,
        'Rewrite the base question into a natural second-person question that references the entries (no long quotes).',
        'One sentence. Keep the intent of the base question.',
        'Do not use the words: user, system, analysis, matrix. Do not use A1..C3 codes.',
        'Return only the question.',
      ].join('\n')
    }

    const runRewrite = async (baseQuestionText) =>
      runLlmTask({
        apiKey: process.env.OPENAI_API_KEY,
        aiSupportEnabled: true,
        task: 'coach-rewrite',
        input: buildPrompt(baseQuestionText),
        language: lang === 'pl' ? 'Polish' : 'English',
        taskInstructions:
          lang === 'pl'
            ? 'Zwróć wyłącznie treść jednego pytania. Bez JSON. Bez komentarzy.'
            : 'Return only the final question text. No JSON, no commentary.',
        parseResponse: (value) => {
          const text = sanitizeQuestionText(String(value || ''))
          if (!text) return null
          return { text }
        },
        fallbackData: null,
        models: {
          default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
          preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
          escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
        },
        maxOutputTokens: 200,
        rateLimiter: limiter,
        rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      })

    const baseSelection = selectBaseQuestion(askedIds, actionNormalized)
    const baseQuestion = baseSelection.question
    const baseMapped = baseQuestion ? mapQuestion(baseQuestion, lang) : null
    if (!baseMapped || !baseMapped.text) {
      console.error('[coach/suggest][base_missing]', {
        requestId,
        action: actionNormalized,
        board_items_count: boardEntries.length,
        payload: {
          sessionId: body.sessionId || null,
          sessionName: sessionName || null,
          language: lang,
          action: actionNormalized,
          askedIdsCount: Array.isArray(askedIds) ? askedIds.length : 0,
          boardEntriesCount: Array.isArray(boardEntries) ? boardEntries.length : 0,
        },
      })
      sendJson(res, 200, {
        ok: false,
        code: 'BASE_QUESTION_MISSING',
        message: 'Base question missing.',
        meta: buildMeta({ aiSupportEnabled: true, modelUsed: null, escalated: false }),
      })
      return
    }
    console.log('[coach/suggest][base_selected]', {
      requestId,
      action: actionNormalized,
      base_question_id: baseMapped.id,
      base_question_text_len: baseMapped.text.length,
      board_items_count: boardEntries.length,
      prompt_template_used: templateUsed,
    })
    buildBaseLog({
      action: actionNormalized,
      attempt: 0,
      baseQuestionId: baseQuestion.id,
      baseQuestionCell: `${baseQuestion.group_code}:${baseQuestion.mode_code}`,
      neighborCandidates: recentCells,
      prevCell: currentGroupCode && currentModeCode ? `${currentGroupCode}:${currentModeCode}` : null,
      avoidCell:
        previousGroupCode && Number.isFinite(Number(previousModeCode))
          ? `${previousGroupCode}:${Number(previousModeCode)}`
          : null,
      nextCell: baseSelection.cell
        ? `${baseSelection.cell.group}:${Number(baseSelection.cell.mode)}`
        : null,
      pointer: baseSelection.pointer ?? null,
      template_used: templateUsed,
      board_items_count: limitedEntries.length,
    })
    console.log('[coach/suggest][rewrite]', {
      requestId,
      action: actionNormalized,
      baseQuestionId: baseMapped.id,
      llm_called: true,
      raw_question_shown: false,
      template_used: templateUsed,
      board_items_count: limitedEntries.length,
    })
    let result
    try {
      result = await runRewrite(baseMapped.text)
    } catch (err) {
      console.error('[coach/suggest] llm_error', {
        requestId,
        name: err?.name,
        message: err?.message,
        stack: typeof err?.stack === 'string' ? err.stack.slice(0, 800) : null,
        status: err?.status || err?.response?.status || null,
      })
      sendJson(res, 200, {
        ok: false,
        code: 'LLM_FAILED',
        message: 'LLM failed.',
        meta: buildMeta({ aiSupportEnabled: true, modelUsed: null, escalated: false }),
      })
      return
    }
    if (!result.ok || !result.data?.text) {
      sendJson(res, 200, {
        ok: false,
        code: 'LLM_FAILED',
        message: 'LLM failed.',
        meta: buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null, escalated: false }),
      })
      return
    }
    const finalText = sanitizeQuestionText(result.data.text)
    if (!finalText) {
      sendJson(res, 200, {
        ok: false,
        code: 'LLM_EMPTY',
        message: 'LLM empty.',
        meta: buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null, escalated: false }),
      })
      return
    }
    if (shouldRejectDuplicateText(finalText)) {
      sendJson(res, 200, {
        ok: false,
        code: 'DUPLICATE_TEXT',
        message: 'Duplicate text.',
        meta: buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null, escalated: false }),
      })
      return
    }
    const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
    const finalQuestion = normalizeQuestion({ ...baseMapped, text: finalText })
    assertQuestionShape(finalQuestion, 'llm_rewrite_success')
    console.log('[coach/suggest][result]', {
      requestId,
      action: actionNormalized,
      prevCell: currentGroupCode && currentModeCode ? `${currentGroupCode}:${currentModeCode}` : null,
      baseQuestionId: baseMapped.id,
      baseQuestionText: baseMapped.text,
      finalQuestionText: finalQuestion?.text ?? null,
      nextCell: baseSelection.cell
        ? `${baseSelection.cell.group}:${Number(baseSelection.cell.mode)}`
        : null,
      pointer: baseSelection.pointer ?? null,
      modelUsed: meta.modelUsed,
      tokens: meta.tokens,
      source: 'llm',
      templateUsed,
    })
    sendJson(res, 200, {
      ok: true,
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
