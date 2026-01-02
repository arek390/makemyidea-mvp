import http from 'node:http'
import { URL } from 'node:url'
import { initEngineDb } from './engine/db.mjs'
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
  listBoardItems,
  listSessions,
  listAskedQuestionIds,
  recordAskedQuestion,
  recordSessionAnswer,
  updateBoardItem,
  updateBoardItemLabel,
  updateSessionState,
  updateSessionStateRow,
  updateSessionName,
} from './engine/sessionRepository.mjs'
import { suggestNextQuestion, computeAnswerSignal } from './engine/suggester.mjs'

const PORT = Number(process.env.PORT || 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'
const DEBUG_UI = process.env.DEBUG_UI === 'true'
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

const callOpenAI = async (messages, maxTokens = 800) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Missing content from OpenAI')
  }
  return content.trim()
}

const normalizeLanguage = (language) => {
  if (!language) return 'English'
  return language === 'Swiss' ? 'German' : language
}

const normalizeEngineLanguage = (language) => {
  if (!language) return 'pl'
  const normalized = language.toLowerCase()
  if (normalized.startsWith('en') || normalized.includes('english')) return 'en'
  if (normalized.startsWith('de') || normalized.includes('german')) return 'de'
  if (normalized.startsWith('pl') || normalized.includes('polish')) return 'pl'
  if (normalized.startsWith('es') || normalized.includes('spanish')) return 'es'
  if (normalized.startsWith('hi') || normalized.includes('hindi')) return 'hi'
  if (normalized.startsWith('zh') || normalized.includes('chinese')) return 'zh'
  return normalized.slice(0, 2)
}

const parseJsonArray = (value) => {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch {
    return null
  }
  return null
}

const containsPolishChars = (value) => /[ąćęłńóśżź]/i.test(value)

const translateList = async (items, language) => {
  const messages = [
    {
      role: 'system',
      content: `Translate the provided list into ${language}. Return only a JSON array of strings.`,
    },
    {
      role: 'user',
      content: `Translate this JSON array into ${language}. Output ONLY a JSON array of strings.\\n\\n${JSON.stringify(items)}`,
    },
  ]
  const content = await callOpenAI(messages, 400)
  const translated = parseJsonArray(content)
  if (!translated) throw new Error('Invalid translation response')
  return translated
}

const parseJsonObject = (value) => {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    return null
  }
  return null
}

const nowMs = () => Date.now()

const buildQuestionQuery = (filters) => {
  const where = ['q.is_active = 1']
  const params = {}

  if (filters.lang) {
    where.push('q.lang = @lang')
    params.lang = filters.lang
  }
  if (filters.groupCode) {
    where.push('q.group_code = @groupCode')
    params.groupCode = filters.groupCode
  }
  if (filters.modeCode) {
    where.push('q.mode_code = @modeCode')
    params.modeCode = filters.modeCode
  }
  if (filters.categoryCode) {
    where.push('q.category_code = @categoryCode')
    params.categoryCode = filters.categoryCode
  }
  if (filters.intentCode) {
    where.push('q.intent_code = @intentCode')
    params.intentCode = filters.intentCode
  }
  if (filters.minDifficulty) {
    where.push('q.difficulty >= @minDifficulty')
    params.minDifficulty = filters.minDifficulty
  }
  if (filters.maxDifficulty) {
    where.push('q.difficulty <= @maxDifficulty')
    params.maxDifficulty = filters.maxDifficulty
  }

  let join = ''
  if (filters.tags && filters.tags.length) {
    join = 'JOIN question_tags qt ON qt.question_id = q.id'
    where.push(`qt.tag IN (${filters.tags.map((_, i) => `@tag${i}`).join(',')})`)
    filters.tags.forEach((tag, index) => {
      params[`tag${index}`] = tag
    })
  }

  return {
    sql: `
      SELECT q.* FROM questions q
      ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY q.priority DESC, q.difficulty ASC
      LIMIT 1
    `,
    params,
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, hasKey: Boolean(OPENAI_API_KEY) })
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
    sendJson(res, 201, createSession({ name: name || null }))
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
    const sanitizedType = type && ['idea', 'observation', 'doubt', 'question'].includes(type) ? type : 'idea'
    const sanitizedEntryType = entryType === 'facilitated_input' ? 'facilitated_input' : 'free_input'
    const sanitizedLabel =
      label == null ? null : ENTRY_LABELS.includes(String(label)) ? String(label) : null
    if (label != null && sanitizedLabel == null) {
      sendJson(res, 400, { error: 'Invalid label.' })
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
    const engineDb = initEngineDb()
    warnLowQuestionCount()
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

    const { sql, params } = buildQuestionQuery(filters)
    const question = engineDb.prepare(sql).get(params)
    if (!question) {
      sendJson(res, 200, { question: null })
      return
    }

    recordAskedQuestion({ sessionId, questionId: question.id })
    updateSessionState({
      sessionId,
      last_group_code: groupCode ?? null,
      last_mode_code: modeCode ?? null,
      last_category_code: categoryCode ?? null,
    })

    sendJson(res, 200, { question })
    return
  }










  if (url.pathname === '/coach/suggest' && req.method === 'POST') {
    initEngineDb()
    warnLowQuestionCount()

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

    ensureSessionState(sessionId)

    const question = suggestNextQuestion({
      sessionId,
      lang: normalizeEngineLanguage(language),
      action,
      modeCode,
      categoryCode,
      intentCode,
    })

    if (!question) {
      sendJson(res, 200, { question: null })
      return
    }

    recordAskedQuestion({ sessionId, questionId: question.id })

    updateSessionState({
      sessionId,
      last_group_code: question.group_code,
      last_mode_code: question.mode_code,
      last_category_code: question.category_code,
    })

    sendJson(res, 200, { question })
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

  if (!OPENAI_API_KEY) {
    sendJson(res, 401, { error: 'OPENAI_API_KEY is not set on the server.' })
    return
  }

  if (url.pathname === '/api/generate-questions' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { productName, spaceDef, timeDef, count = 30 } = body
    if (!productName || !spaceDef || !timeDef) {
      sendJson(res, 400, { error: 'Missing productName, spaceDef, or timeDef.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content:
          'You generate focused, practical guiding questions. Return only JSON arrays of strings.',
      },
      {
        role: 'user',
        content: `Generate ${count} concise, insightful guiding questions for product "${productName}". The questions must reflect the intersection of space "${spaceDef}" and observation level "${timeDef}". Mix technical, business, user-need, trends, standards, connectivity, and price-vs-performance angles. Output ONLY a JSON array of strings, no extra text.`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 900)
      const questions = parseJsonArray(content)
      if (!questions) throw new Error('Invalid JSON array')
      sendJson(res, 200, { questions })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-names' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { description, count = 5 } = body
    if (!description) {
      sendJson(res, 400, { error: 'Missing description.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content:
          'You generate short, brandable product names. Return only JSON arrays of strings.',
      },
      {
        role: 'user',
        content: `Generate ${count} short, brandable product names (1-3 words) based on this description. Avoid punctuation. Output ONLY a JSON array of strings, no extra text.\\n\\nDescription:\\n${description}`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 300)
      const names = parseJsonArray(content)
      if (!names) throw new Error('Invalid JSON array')
      sendJson(res, 200, { names })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-ideas' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { productName, cells = [], ideasPerCell = 3 } = body
    if (!productName || !Array.isArray(cells) || !cells.length) {
      sendJson(res, 400, { error: 'Missing productName or cells.' })
      return
    }

    const promptCells = cells
      .map((cell) => `- ${cell.id}: space="${cell.spaceDef}", level="${cell.timeDef}"`)
      .join('\n')

    const messages = [
      {
        role: 'system',
        content:
          'You generate short, practical idea prompts. Return only JSON objects mapping cell ids to arrays of ideas.',
      },
      {
        role: 'user',
        content: `Generate ${ideasPerCell} concise ideas (max 50 words each) for each cell for product "${productName}". Each idea must relate to both the space and observation level. Return ONLY a JSON object where keys are cell ids and values are arrays of ideas.\n\nCells:\n${promptCells}`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 1200)
      const ideas = parseJsonObject(content)
      if (!ideas) throw new Error('Invalid JSON object')
      sendJson(res, 200, { ideas })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-space-options' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const {
      productName,
      description = '',
      worldCount = 10,
      elementCount = 10,
      language = 'English',
    } = body
    const outputLanguage = normalizeLanguage(language)
    if (!productName) {
      sendJson(res, 400, { error: 'Missing productName.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content: `You generate concise option lists in ${outputLanguage}. Return ONLY a JSON object with arrays.`,
      },
      {
        role: 'user',
        content: `Product: "${productName}". Description: "${description}".\n\nTask:\n1) Generate ${worldCount} options for where this product can exist, be used, or be found (near context and broader context). These are for the "World" category.\n2) Generate ${elementCount} options describing components, materials, subassemblies, or parts the product can be made of. These are for the "Elements" category.\n\nRequirements:\n- Write ONLY in ${outputLanguage}.\n- Each option 1-6 words.\n- Return ONLY a JSON object: {"worldOptions":[...],"elementOptions":[...]}\n- No extra text.`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 400)
      const parsed = parseJsonObject(content)
      if (!parsed || !Array.isArray(parsed.worldOptions) || !Array.isArray(parsed.elementOptions)) {
        throw new Error('Invalid JSON object')
      }
      sendJson(res, 200, {
        worldOptions: parsed.worldOptions,
        elementOptions: parsed.elementOptions,
      })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  if (url.pathname === '/api/generate-time-options' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body) {
      sendJson(res, 400, { error: 'Invalid JSON body.' })
      return
    }
    const { productName, count = 15, language = 'English' } = body
    const outputLanguage = normalizeLanguage(language)
    if (!productName) {
      sendJson(res, 400, { error: 'Missing productName.' })
      return
    }

    const messages = [
      {
        role: 'system',
        content:
          `You generate concise time/process/observation level options in ${outputLanguage}. Return only JSON arrays of strings.`,
      },
      {
        role: 'user',
        content: `Generate ${count} concise observation/time/process options (1-6 words) for product \"${productName}\". Write ONLY in ${outputLanguage}. Do not use any other language. Output ONLY a JSON array of strings, no extra text.`,
      },
    ]

    try {
      const content = await callOpenAI(messages, 400)
      let options = parseJsonArray(content)
      if (!options) throw new Error('Invalid JSON array')
      options = await translateList(options, outputLanguage)
      sendJson(res, 200, { options })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`LLM server running on http://localhost:${PORT}`)
})
