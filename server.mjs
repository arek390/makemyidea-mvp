import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import { initEngineDb } from './engine/db.mjs'
import { getDbHealth } from './engine/dbHealth.mjs'
import { seedQuestionsIfEmpty } from './engine/seedQuestions.mjs'
import { insertQuestions, getQuestionById } from './engine/questionRepository.mjs'
import {
  addBoardItem,
  createSession,
  deleteBoardItem,
  deleteSession,
  ensureSessionState,
  getBoardItem,
  getSession,
  getSessionState,
  incrementAskedCount,
  incrementSessionTokens,
  listBoardItems,
  listSessions,
  listAskedQuestionIds,
  recordSessionAnswer,
  updateBoardItem,
  updateBoardItemLabel,
  updateSessionStateRow,
  updateSessionName,
} from './engine/sessionRepository.mjs'
import { computeAnswerSignal } from './engine/suggester.mjs'
import { finalizeSelection, selectQuestion } from './engine/questionSelector.mjs'
import {
  runLlmTask,
  createRateLimiter,
  parseJsonArray,
  parseJsonObject,
} from './llm/llmRouter.mjs'
import coachHandler from './api/coach.js'
import coreHandler from './api/core.js'
import devHandler from './api/dev.js'
import adminHandler from './api/admin.js'
import boardItemsHandler from './api/board-items.js'
import billingHandler from './api/billing.js'
import reportHandler from './api/report.js'
import { createSupabaseServerClient } from './src/lib/server/supabaseServer.js'
import { chargeUserBalance, normalizeBillingError } from './src/lib/server/billing.js'
import {
  buildContextPrompt,
  buildQuestionPrompt,
  inferProductName,
  normalizeContextPayload,
} from './src/lib/llm/contextInterpreter.mjs'

const stripWrappingQuotes = (value) => {
  const trimmed = String(value || '').trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) continue
    const eqIndex = raw.indexOf('=')
    if (eqIndex <= 0) continue
    const key = raw.slice(0, eqIndex).trim()
    if (!key || process.env[key] != null) continue
    const value = stripWrappingQuotes(raw.slice(eqIndex + 1))
    process.env[key] = value
  }
}

const loadLocalEnv = () => {
  const cwd = process.cwd()
  loadEnvFile(path.join(cwd, '.env'))
  loadEnvFile(path.join(cwd, '.env.local'))
}

if (!process.env.VERCEL) {
  loadLocalEnv()
}

const runtimeCwd = process.cwd()
const envFilePath = path.join(runtimeCwd, '.env')
const envLocalFilePath = path.join(runtimeCwd, '.env.local')

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'
const DEBUG_UI = process.env.DEBUG_UI === 'true'
const DEBUG_ENGINE = process.env.DEBUG_ENGINE === '1'
const isVercel = Boolean(process.env.VERCEL)
const AI_SUPPORT_DISABLED = process.env.AI_SUPPORT_DISABLED === 'true'
const LLM_MODELS = {
  default: process.env.OPENAI_MODEL_DEFAULT || 'gpt-4.1-mini',
  preprocess: process.env.OPENAI_MODEL_PREPROCESS || 'gpt-5-nano',
  escalation: process.env.OPENAI_MODEL_ESCALATION || 'gpt-5-mini',
}
const llmRateLimiter = createRateLimiter({ windowMs: 60_000, max: 30 })

if (process.env.NODE_ENV !== 'production') {
  console.info('[server][env][supabase]', {
    cwd: runtimeCwd,
    hasDotEnv: fs.existsSync(envFilePath),
    hasDotEnvLocal: fs.existsSync(envLocalFilePath),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  })
}

const generateCorrelationId = () =>
  `noq-${Date.now()}-${Math.random().toString(16).slice(2)}`
const ENTRY_LABELS = [
  'pomysł',
  'problem do rozwiązania',
  'ryzyko / blokada',
  'pytanie do klienta',
  'pytanie do dostawcy / partnera',
  'założenie do weryfikacji',
  'decyzja',
  'następny krok (action)',
]

const fallbackNameSeeds = ['Nova', 'Pulse', 'Craft', 'Shift', 'Spark', 'Flow', 'Nest']

const buildNameFallbacks = (description, count = 5) => {
  const words = String(description || '')
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśżź\s-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4)
  const unique = [...new Set(words)]
  const base = unique.length ? unique.slice(0, count) : fallbackNameSeeds
  const names = []
  base.forEach((word, index) => {
    const cap = word.charAt(0).toUpperCase() + word.slice(1)
    names.push(cap)
    if (names.length < count) names.push(`${cap} Lab`)
    if (names.length < count) names.push(`${cap} Hub`)
    if (names.length < count && fallbackNameSeeds[index]) names.push(`${cap} ${fallbackNameSeeds[index]}`)
  })
  return names.slice(0, count)
}

const applySessionTokenUpdate = (sessionId, meta) => {
  if (!sessionId || !meta?.tokens) return
  const input = Number(meta.tokens.input ?? 0)
  const output = Number(meta.tokens.output ?? 0)
  if (!input && !output) return
  incrementSessionTokens({ sessionId, tokensIn: input, tokensOut: output })
}

const mergeTokens = (base, extra) => {
  const safe = (value) => ({
    input: Number(value?.input ?? 0),
    output: Number(value?.output ?? 0),
    total: Number(value?.total ?? 0),
  })
  const a = safe(base)
  const b = safe(extra)
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    total: a.total + b.total,
  }
}

const createResShim = (res) => {
  let statusCode = 200
  const api = {
    status: (code) => {
      statusCode = code
      return api
    },
    json: (payload) => {
      sendJson(res, statusCode, payload)
    },
    end: () => {
      res.writeHead(statusCode)
      res.end()
    },
    setHeader: (...args) => res.setHeader(...args),
  }
  return api
}

const getAuthUserId = async (req, res) => {
  try {
    const supabase = createSupabaseServerClient(req, res)
    const { data, error } = await supabase.auth.getUser()
    if (error) return null
    return data?.user?.id || null
  } catch {
    return null
  }
}

const handleBillingError = (res, error) => {
  const normalized = normalizeBillingError(error)
  if (!normalized) return false
  sendJson(res, normalized.status, { ok: false, error: normalized.code })
  return true
}

const buildIdeaFallbacks = (cells, ideasPerCell = 3) => {
  const ideas = {}
  cells.forEach((cell) => {
    const list = []
    for (let i = 0; i < ideasPerCell; i += 1) {
      list.push(`Idea for ${cell.spaceDef} (${cell.timeDef})`)
    }
    ideas[cell.id] = list
  })
  return ideas
}

const buildSpaceFallbacks = (productName) => {
  const base = String(productName || 'Product').trim() || 'Product'
  return {
    worldOptions: [
      `${base} usage`,
      `${base} market`,
      `${base} ecosystem`,
      'Home',
      'Workplace',
      'Public space',
      'Retail',
      'Logistics',
      'Healthcare',
      'Education',
    ],
    elementOptions: [
      'Core module',
      'Housing',
      'Materials',
      'Sensors',
      'Power unit',
      'Interface layer',
      'Connectivity',
      'Packaging',
      'Fasteners',
      'Support parts',
    ],
  }
}

const buildTimeFallbacks = () => [
  'Past constraints',
  'Current state',
  'Future trends',
  'Existing workflow',
  'Pain points',
  'Desired outcome',
  'Market evolution',
  'Technology shift',
  'User habits',
  'Regulation changes',
  'Lifecycle stage',
  'Maintenance phase',
  'Scaling stage',
  'Adoption barriers',
  'Optimization phase',
]

const buildQuestionFallbacks = ({ productName, spaceDef, timeDef, count = 10 }) => {
  const base = `What matters for ${productName} in ${spaceDef} at ${timeDef}?`
  return Array.from({ length: Math.min(count, 10) }, () => base)
}

const detectMatrixColumnShift = (text) => {
  const value = String(text || '').toLowerCase()
  const notWorking = ['nie działa', 'problem', 'blokuje'].some((phrase) => value.includes(phrase))
  const shouldBe = ['powinno', 'chciałbym', 'idealnie'].some((phrase) => value.includes(phrase))
  if (notWorking) return 'NOT_WORKING'
  if (shouldBe) return 'SHOULD_BE'
  return null
}

const baseMappingForPrompt = (promptType) => {
  if (promptType === 'DEEPEN') return { row: 'ELEMENTS', col: 'AS_IS' }
  if (promptType === 'PERSPECTIVE') return { row: 'WORLD', col: 'AS_IS' }
  if (promptType === 'RESET') return { row: 'WORLD', col: 'NOT_WORKING' }
  return { row: 'PRODUCT', col: 'AS_IS' }
}

const followupMappingForPrompt = (promptType) => {
  if (promptType === 'DEEPEN') return { row: 'ELEMENTS', col: 'AS_IS' }
  if (promptType === 'PERSPECTIVE') return { row: 'WORLD', col: 'AS_IS' }
  if (promptType === 'RESET') return { row: 'PRODUCT', col: 'NOT_WORKING' }
  return { row: 'PRODUCT', col: 'AS_IS' }
}

const resolveMatrixPlacement = ({ text, entryType, promptType, lastPromptType }) => {
  let base = { row: 'PRODUCT', col: 'AS_IS' }
  if (entryType === 'facilitated_input' && promptType) {
    base = baseMappingForPrompt(promptType)
  } else if (entryType === 'free_input' && lastPromptType) {
    base = followupMappingForPrompt(lastPromptType)
  }
  const shift = detectMatrixColumnShift(text)
  const col = shift || base.col
  return { row: base.row, col }
}


let didWarnLowQuestionCount = false
const warnLowQuestionCount = () => {
  if (didWarnLowQuestionCount) return
  if (process.env.NODE_ENV === 'production') return
  const db = initEngineDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM questions').get()
  if (row?.count < 100) {
    console.warn(`[engine] Low question count detected (${row.count}). Did you seed the DB?`)
  }
  didWarnLowQuestionCount = true
}

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ai-support',
  })
  res.end(JSON.stringify(payload))
}

const readJsonBody = async (req) => {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  if (Array.isArray(forwarded)) return forwarded[0]
  return req.socket?.remoteAddress || 'unknown'
}

const resolveAiSupportEnabled = (req, body) => {
  if (AI_SUPPORT_DISABLED) return false
  const header = req.headers['x-ai-support']
  const headerValue = Array.isArray(header) ? header[0] : header
  if (typeof headerValue === 'string') {
    const normalized = headerValue.toLowerCase().trim()
    if (['on', 'true', '1', 'yes'].includes(normalized)) return true
    if (['off', 'false', '0', 'no'].includes(normalized)) return false
  }
  if (body && typeof body.aiSupportEnabled === 'boolean') return body.aiSupportEnabled
  return true
}

const normalizeLanguage = (language) => {
  if (!language) return 'English'
  return language
}

const normalizeEngineLanguage = (language) => {
  if (!language) return 'pl'
  const normalized = language.toLowerCase()
  if (normalized.startsWith('en') || normalized.includes('english')) return 'en'
  if (normalized.startsWith('pl') || normalized.includes('polish')) return 'pl'
  return 'en'
}

const nowMs = () => Date.now()
const isKeyError = (error) => String(error || '').includes('OPENAI_API_KEY')
const isRateLimitError = (error) => String(error || '').includes('Rate limit')

const sendLlmResponse = (res, result, dataBuilder) => {
  if (!result.ok) {
    const status = isKeyError(result.error) ? 401 : isRateLimitError(result.error) ? 429 : 500
    sendJson(res, status, {
      ok: false,
      error: result.error || 'LLM request failed.',
      meta: result.meta || { aiSupportEnabled: true, modelUsed: null, escalated: false },
    })
    return
  }
  sendJson(res, 200, {
    ok: true,
    data: dataBuilder(result.data),
    meta: result.meta,
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ai-support',
    })
    res.end()
    return
  }

  if (url.pathname === '/api/core') {
    const resShim = createResShim(res)
    await coreHandler(req, resShim)
    return
  }

  if (url.pathname === '/api/coach') {
    const resShim = createResShim(res)
    try {
      await coachHandler(req, resShim)
    } catch (error) {
      console.error('[server][coach] unhandled error', {
        name: error?.name,
        message: error?.message,
      })
      sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: 'Server error.' })
    }
    return
  }

  if (url.pathname === '/api/board-items') {
    const resShim = createResShim(res)
    try {
      await boardItemsHandler(req, resShim)
    } catch (error) {
      console.error('[server][board-items] unhandled error', {
        name: error?.name,
        message: error?.message,
      })
      sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: 'Server error.' })
    }
    return
  }

  if (url.pathname === '/api/billing') {
    const resShim = createResShim(res)
    try {
      await billingHandler(req, resShim)
    } catch (error) {
      console.error('[server][billing] unhandled error', {
        name: error?.name,
        message: error?.message,
      })
      sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: 'Server error.' })
    }
    return
  }

  if (url.pathname === '/api/report') {
    const resShim = createResShim(res)
    try {
      await reportHandler(req, resShim)
    } catch (error) {
      console.error('[server][report] unhandled error', {
        name: error?.name,
        message: error?.message,
      })
      sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: 'Server error.' })
    }
    return
  }

  if (url.pathname === '/api/dev') {
    const resShim = createResShim(res)
    await devHandler(req, resShim)
    return
  }

  if (url.pathname === '/api/admin') {
    const resShim = createResShim(res)
    await adminHandler(req, resShim)
    return
  }

  if (url.pathname === '/debug/db-health' && req.method === 'GET') {
    if (!DEBUG_ENGINE) {
      sendJson(res, 404, { error: 'Not available' })
      return
    }
    const db = initEngineDb()
    const health = getDbHealth(db)
    sendJson(res, 200, {
      ok: true,
      env: isVercel ? 'vercel' : 'local',
      health,
    })
    return
  }
  if (url.pathname === '/api/engine/sessions' && req.method === 'GET') {
    initEngineDb()
    warnLowQuestionCount()
    const limit = Number(url.searchParams.get('limit') || 20)
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 20
    sendJson(res, 200, { sessions: listSessions({ limit: safeLimit }) })
    return
  }

  if (url.pathname === '/api/engine/sessions' && req.method === 'POST') {
    initEngineDb()
    warnLowQuestionCount()
    const body = await readJsonBody(req)
    const name = body?.name ? String(body.name).trim() : ''
    const userId = await getAuthUserId(req, res)
    if (!userId) {
      sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
      return
    }
    try {
      await chargeUserBalance(userId, 'session_create')
    } catch (error) {
      if (handleBillingError(res, error)) return
      sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
      return
    }
    const created = createSession({ name: name || null })
    const session = created?.sessionId ? getSession(created.sessionId) : null
    sendJson(res, 201, { sessionId: created.sessionId, session })
    return
  }


  if (url.pathname.startsWith('/api/engine/sessions/') && req.method === 'GET') {
    initEngineDb()
    warnLowQuestionCount()
    const sessionId = url.pathname.replace('/api/engine/sessions/', '')
    if (!sessionId) {
      sendJson(res, 400, { error: 'Missing sessionId.' })
      return
    }
    const session = getSession(sessionId)
    if (!session) {
      sendJson(res, 200, { session: null, boardItems: [], askedQuestionIds: [] })
      return
    }
    const boardItems = listBoardItems({ sessionId, limit: 200 })
    const askedQuestionIds = listAskedQuestionIds(sessionId)
    sendJson(res, 200, { session, boardItems, askedQuestionIds })
    return
  }

  if (url.pathname.startsWith('/api/engine/sessions/') && req.method === 'DELETE') {
    initEngineDb()
    warnLowQuestionCount()
    const sessionId = url.pathname.replace('/api/engine/sessions/', '')
    if (!sessionId) {
      sendJson(res, 400, { error: 'Missing sessionId.' })
      return
    }
    const result = deleteSession(sessionId)
    sendJson(res, 200, { ok: true, deleted: result?.changes || 0 })
    return
  }

  if (url.pathname === '/api/engine/board-items' && req.method === 'POST') {
    initEngineDb()
    warnLowQuestionCount()
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { sessionId, type, text, entryType, promptType, sessionName, label } = body
    if (!sessionId || !text) {
      sendJson(res, 400, { error: 'Missing sessionId or text.' })
      return
    }
    const userId = await getAuthUserId(req, res)
    if (!userId) {
      sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
      return
    }
    const sanitizedType = type && ['idea', 'observation', 'doubt', 'question'].includes(type) ? type : 'idea'
    const sanitizedEntryType = entryType === 'facilitated_input' ? 'facilitated_input' : 'free_input'
    const sanitizedLabel =
      label == null ? null : ENTRY_LABELS.includes(String(label)) ? String(label) : null
    if (label != null && sanitizedLabel == null) {
      sendJson(res, 400, { error: 'Invalid label.' })
      return
    }

    try {
      await chargeUserBalance(userId, 'session_item_add_or_edit', sessionId)
    } catch (error) {
      if (handleBillingError(res, error)) return
      sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
      return
    }

    if (sessionName && String(sessionName).trim()) {
      updateSessionName({ sessionId, name: String(sessionName).trim() })
    }

    const recentItems = listBoardItems({ sessionId, limit: 20 })
    const lastPromptItem = recentItems.find((item) => item.prompt_type)
    const lastPromptType = lastPromptItem?.prompt_type || null
    const placement = resolveMatrixPlacement({
      text,
      entryType: sanitizedEntryType,
      promptType: promptType || null,
      lastPromptType,
    })

    sendJson(
      res,
      201,
      addBoardItem({
        sessionId,
        type: sanitizedType,
        text,
        label: sanitizedLabel,
        entry_type: sanitizedEntryType,
        prompt_type: promptType || null,
        matrix_row: placement.row,
        matrix_col: placement.col,
      })
    )
    return
  }

  if (url.pathname.startsWith('/api/engine/entries/') && req.method === 'PATCH') {
    initEngineDb()
    warnLowQuestionCount()
    const entryId = url.pathname.replace('/api/engine/entries/', '').replace('/label', '')
    if (!entryId || !url.pathname.endsWith('/label')) {
      sendJson(res, 400, { error: 'Missing entryId.' })
      return
    }
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const nextLabel = body.label
    const sanitizedLabel =
      nextLabel == null ? null : ENTRY_LABELS.includes(String(nextLabel)) ? String(nextLabel) : null
    if (nextLabel != null && sanitizedLabel == null) {
      sendJson(res, 400, { error: 'Invalid label.' })
      return
    }
    const userId = await getAuthUserId(req, res)
    if (!userId) {
      sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
      return
    }
    try {
      await chargeUserBalance(userId, 'session_item_add_or_edit', entryId)
    } catch (error) {
      if (handleBillingError(res, error)) return
      sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
      return
    }
    updateBoardItemLabel({ id: entryId, label: sanitizedLabel })
    const entry = getBoardItem(entryId)
    sendJson(res, 200, { entry })
    return
  }

  if (url.pathname.startsWith('/api/engine/board-items/') && req.method === 'PATCH') {
    initEngineDb()
    warnLowQuestionCount()
    const itemId = url.pathname.replace('/api/engine/board-items/', '')
    if (!itemId) {
      sendJson(res, 400, { error: 'Missing itemId.' })
      return
    }
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { text } = body
    if (!text) {
      sendJson(res, 400, { error: 'Missing text.' })
      return
    }
    const userId = await getAuthUserId(req, res)
    if (!userId) {
      sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' })
      return
    }
    try {
      await chargeUserBalance(userId, 'session_item_add_or_edit', itemId)
    } catch (error) {
      if (handleBillingError(res, error)) return
      sendJson(res, 500, { ok: false, error: 'BILLING_FAILED' })
      return
    }
    const result = updateBoardItem({ id: itemId, text })
    sendJson(res, 200, { ok: true, changes: result.changes })
    return
  }

  if (url.pathname.startsWith('/api/engine/board-items/') && req.method === 'DELETE') {
    initEngineDb()
    warnLowQuestionCount()
    const itemId = url.pathname.replace('/api/engine/board-items/', '')
    if (!itemId) {
      sendJson(res, 400, { error: 'Missing itemId.' })
      return
    }
    const result = deleteBoardItem(itemId)
    sendJson(res, 200, { ok: true, changes: result.changes })
    return
  }

  if (url.pathname === '/api/engine/questions' && req.method === 'POST') {
    initEngineDb()
    warnLowQuestionCount()
    const body = await readJsonBody(req)
    if (!body || !Array.isArray(body.questions)) {
      sendJson(res, 400, { error: 'Provide questions array.' })
      return
    }
    const result = insertQuestions(body.questions)
    sendJson(res, 201, result)
    return
  }

  if (url.pathname === '/api/engine/next-question' && req.method === 'POST') {
    initEngineDb()
    warnLowQuestionCount()
    const seedInfo = seedQuestionsIfEmpty()
    if (DEBUG_ENGINE && seedInfo?.seeded) {
      console.log(JSON.stringify({ event: 'questions_seeded', ...seedInfo }))
    }
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const {
      sessionId,
      language,
      groupCode,
      modeCode,
      categoryCode,
      intentCode,
      tags,
      minDifficulty,
      maxDifficulty,
    } = body
    if (!sessionId) {
      sendJson(res, 400, { error: 'Missing sessionId.' })
      return
    }

    const filters = {
      lang: normalizeEngineLanguage(language),
      groupCode,
      modeCode,
      categoryCode,
      intentCode,
      minDifficulty,
      maxDifficulty,
      tags,
    }

    const { question, meta } = selectQuestion({
      sessionId,
      ...filters,
      action: body?.action ?? 'AUTO',
    })

    if (process.env.DEBUG_SUGGESTER === '1') {
      console.log(
        JSON.stringify({
          event: 'selection',
          endpoint: 'api/engine/next-question',
          sessionId,
          action: meta?.action,
          cellKey: meta?.cellKey ?? null,
          candidatesInCell: meta?.candidatesInCell ?? null,
          askedInCell: meta?.askedInCell ?? null,
          exhausted: meta?.exhausted ?? null,
          selected: question?.id ?? null,
        })
      )
    }

    if (!question) {
      if (DEBUG_ENGINE) {
        sendJson(res, 200, {
          question: null,
          error: 'NO_QUESTION',
          debug: {
            lang: filters.lang,
            action: body?.action ?? 'AUTO',
            sessionId,
            totalCandidatesBeforeFilters: meta?.totalCandidates ?? null,
            candidatesAfterFilters: meta?.candidatesAfterFilters ?? null,
            askedCount: meta?.askedIdsCount ?? null,
            currentCell: meta?.cellKey ?? null,
            dbHealth: getDbHealth(initEngineDb()),
          },
        })
        return
      }
      const correlationId = generateCorrelationId()
      console.error(
        `NO_QUESTION correlationId=${correlationId} sessionId=${sessionId} action=${body?.action ?? 'AUTO'} lang=${filters.lang}`
      )
      sendJson(res, 200, { question: null, correlationId })
      return
    }

    finalizeSelection({ sessionId, question })

    sendJson(res, 200, { question })
    return
  }










  if (
    (url.pathname === '/coach/suggest' || url.pathname === '/api/coach/suggest') &&
    req.method === 'POST'
  ) {
    initEngineDb()
    warnLowQuestionCount()
    const seedInfo = seedQuestionsIfEmpty()
    if (DEBUG_ENGINE && seedInfo?.seeded) {
      console.log(JSON.stringify({ event: 'questions_seeded', ...seedInfo }))
    }

    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }

    const {
      sessionId,
      action = 'AUTO',
      modeCode,
      categoryCode,
      intentCode,
      language,
    } = body

    if (!sessionId) {
      sendJson(res, 400, { error: 'Missing sessionId.' })
      return
    }

    const aiSupportEnabled = resolveAiSupportEnabled(req, body)
    const aiMeta = { aiSupportEnabled, modelUsed: null, escalated: false }

    ensureSessionState(sessionId)

    const { question, meta } = selectQuestion({
      sessionId,
      lang: normalizeEngineLanguage(language),
      action,
      modeCode,
      categoryCode,
      intentCode,
    })

    if (!question) {
      if (DEBUG_ENGINE) {
        sendJson(res, 200, {
          ok: true,
          data: { question: null },
          meta: aiMeta,
          error: 'NO_QUESTION',
          debug: {
            lang: normalizeEngineLanguage(language),
            action,
            sessionId,
            totalCandidatesBeforeFilters: meta?.totalCandidates ?? null,
            candidatesAfterFilters: meta?.candidatesAfterFilters ?? null,
            askedCount: meta?.askedIdsCount ?? null,
            currentCell: meta?.cellKey ?? null,
            dbHealth: getDbHealth(initEngineDb()),
          },
        })
        return
      }
      const correlationId = generateCorrelationId()
      console.error(
        `NO_QUESTION correlationId=${correlationId} sessionId=${sessionId} action=${action} lang=${normalizeEngineLanguage(language)}`
      )
      sendJson(res, 200, {
        ok: true,
        data: { question: null },
        meta: aiMeta,
        correlationId,
      })
      return
    }

    if (process.env.DEBUG_SUGGESTER === '1') {
      console.log(
        JSON.stringify({
          event: 'selection',
          endpoint: 'coach/suggest',
          sessionId,
          action: meta?.action,
          cellKey: meta?.cellKey ?? null,
          candidatesInCell: meta?.candidatesInCell ?? null,
          askedInCell: meta?.askedInCell ?? null,
          exhausted: meta?.exhausted ?? null,
          selected: question?.id ?? null,
        })
      )
    }

    finalizeSelection({ sessionId, question })

    sendJson(res, 200, { ok: true, data: { question }, meta: aiMeta })
    return
  }

  if (url.pathname === '/coach/answer' && req.method === 'POST') {
    initEngineDb()
    warnLowQuestionCount()

    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }

    const { sessionId, questionId, answer } = body
    if (!sessionId || !questionId || answer == null) {
      sendJson(res, 400, { error: 'Missing sessionId, questionId, or answer.' })
      return
    }

    ensureSessionState(sessionId)

    const signal = computeAnswerSignal(String(answer))
    const question = getQuestionById(questionId)
    const matrixRow = question?.group_code === 'A'
      ? 'SUPER_SYSTEM'
      : question?.group_code === 'B'
      ? 'SYSTEM'
      : 'SUB_SYSTEM'
    const matrixCol = question?.mode_code === 1
      ? 'PAST'
      : question?.mode_code === 2
      ? 'PRESENT'
      : 'FUTURE'

    recordSessionAnswer({
      sessionId,
      questionId,
      answer: String(answer),
      answer_signal: signal,
      matrix_row: matrixRow,
      matrix_col: matrixCol,
    })

    incrementAskedCount(sessionId)

    const sessionState = getSessionState(sessionId)
    const lastHardStreak = sessionState?.hard_streak ?? 0
    let nextHardStreak = 0

    if (question && question.difficulty >= 4 && (signal === 'MEDIUM' || signal === 'HIGH')) {
      nextHardStreak = lastHardStreak + 1
    }

    updateSessionStateRow({
      sessionId,
      hard_streak: nextHardStreak,
    })

    sendJson(res, 200, { ok: true, answer_signal: signal })
    return
  }


















  if (url.pathname === '/api/debug/matrix' && req.method === 'GET') {
    const debugParam = url.searchParams.get('debug')
    if (!DEBUG_UI && debugParam !== '1') {
      sendJson(res, 404, { error: 'Not available' })
      return
    }
    initEngineDb()
    warnLowQuestionCount()
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) {
      sendJson(res, 400, { error: 'Missing sessionId.' })
      return
    }

    const entries = listBoardItems({ sessionId, limit: 500 })

    const baseMatrix = {
      WORLD: { AS_IS: [], NOT_WORKING: [], SHOULD_BE: [] },
      PRODUCT: { AS_IS: [], NOT_WORKING: [], SHOULD_BE: [] },
      ELEMENTS: { AS_IS: [], NOT_WORKING: [], SHOULD_BE: [] },
    }

    const matrix = JSON.parse(JSON.stringify(baseMatrix))

    const short = (text) => {
      const trimmed = String(text || '').trim()
      if (!trimmed) return ''
      if (trimmed.length <= 140) return trimmed
      return trimmed.slice(0, 140) + '…'
    }

    entries.forEach((entry) => {
      const row = entry.matrix_row || 'PRODUCT'
      const col = entry.matrix_col || 'AS_IS'
      if (!matrix[row] || !matrix[row][col]) return
      matrix[row][col].push({
        id: entry.id,
        short_text: short(entry.text),
        entry_type: entry.entry_type || 'free_input',
        promptType: entry.prompt_type || null,
        created_at: entry.created_at,
      })
    })

    let filledCells = 0
    Object.keys(matrix).forEach((row) => {
      Object.keys(matrix[row]).forEach((col) => {
        if (matrix[row][col].length > 0) filledCells += 1
      })
    })

    const timeline = entries
      .slice(0, 10)
      .map((entry) => ({
        id: entry.id,
        matrix_row: entry.matrix_row || 'PRODUCT',
        matrix_col: entry.matrix_col || 'AS_IS',
        short_text: short(entry.text),
        created_at: entry.created_at,
      }))

    sendJson(res, 200, {
      matrix,
      coverage: { filledCells, totalCells: 9 },
      timeline,
    })
    return
  }

  if (url.pathname === '/api/generate-questions' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const {
      productName,
      spaceDef,
      timeDef,
      count = 30,
      boardItems = [],
      sessionTitle = '',
      matrixContext = null,
      sessionId,
    } = body
    if (!productName || !spaceDef || !timeDef) {
      sendJson(res, 400, { error: 'Missing productName, spaceDef, or timeDef.' })
      return
    }

    const aiSupportEnabled = resolveAiSupportEnabled(req, body)
    let contextPayload = null
    let contextTokens = null
    if (aiSupportEnabled && Array.isArray(boardItems) && boardItems.length) {
      const contextInput = buildContextPrompt({ boardItems, sessionTitle, matrixContext })
      const contextResult = await runLlmTask({
        apiKey: OPENAI_API_KEY,
        aiSupportEnabled,
        task: 'context-interpreter',
        input: contextInput,
        language: 'English',
        taskInstructions:
          'Summarize the board content into JSON: ' +
          '{"productName":null,"productType":"product|service|unknown","summary":"","keyTerms":[],"assumptions":[],"openThreads":[]} ' +
          'Keep summary under 240 chars. Return ONLY JSON.',
        parseResponse: parseJsonObject,
        fallbackData: null,
        models: LLM_MODELS,
        maxOutputTokens: 220,
        temperature: 0.2,
        rateLimiter: llmRateLimiter,
        rateLimitKey: getClientIp(req),
      })
      const normalized = normalizeContextPayload(contextResult?.data)
      if (normalized) {
        const inferredName = inferProductName(boardItems, sessionTitle)
        contextPayload = {
          ...normalized,
          productName: inferredName,
        }
      }
      contextTokens = contextResult?.meta?.tokens || null
    }

    const questionPrompt = contextPayload
      ? buildQuestionPrompt({ context: contextPayload, matrixContext, count, spaceDef, timeDef })
      : {
          input: `${productName}\n${spaceDef}\n${timeDef}`,
          instructions: `Generate ${count} concise, insightful guiding questions for product "${productName}". The questions must reflect the intersection of space "${spaceDef}" and observation level "${timeDef}". Mix technical, business, user-need, trends, standards, connectivity, and price-vs-performance angles. Output ONLY a JSON array of strings, no extra text.`,
        }
    const result = await runLlmTask({
      apiKey: OPENAI_API_KEY,
      aiSupportEnabled,
      task: 'generate-questions',
      input: questionPrompt.input,
      language: 'English',
      taskInstructions: questionPrompt.instructions,
      parseResponse: parseJsonArray,
      fallbackData: buildQuestionFallbacks({ productName, spaceDef, timeDef, count }),
      models: LLM_MODELS,
      maxOutputTokens: 900,
      rateLimiter: llmRateLimiter,
      rateLimitKey: getClientIp(req),
    })
    if (contextTokens && result?.meta) {
      result.meta.tokens = mergeTokens(result.meta.tokens, contextTokens)
    }
    applySessionTokenUpdate(sessionId, result.meta)
    sendLlmResponse(res, result, (data) => ({ questions: data }))
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`LLM server running on http://${HOST}:${PORT}`)
})
