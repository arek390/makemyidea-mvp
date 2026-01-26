import fs from 'node:fs'
import path from 'node:path'
import { runLlmTask, createRateLimiter } from '../../llm/llmRouter.mjs'
import {
  buildMeta,
  readJsonBody,
  resolveAiSupportEnabled,
  sendError,
  sendJson,
  mapLlmError,
} from '../_lib/http.js'
import { buildContextPrompt } from '../../src/lib/llm/contextInterpreter.mjs'

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

const extractKeywords = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9ąćęłńóśżź]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)

const countGroundedQuestions = (questions, keywords) => {
  if (!Array.isArray(questions)) return 0
  if (!keywords.length) return 0
  return questions.filter((q) => {
    const text = String(q?.text || '').toLowerCase()
    return keywords.some((kw) => text.includes(kw))
  }).length
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

const selectQuestion = ({ dataset, lang, action, currentGroupCode, currentModeCode, askedIds }) => {
  const normalizedLang = normalizeLang(lang)
  const askedSet = new Set((askedIds || []).filter(Boolean))
  const all = dataset.list.filter((q) => Number(q.is_active) === 1)
  const actionNormalized = String(action || 'NEXT').toUpperCase()
  const group = currentGroupCode || null
  const mode = Number(currentModeCode)

  if (actionNormalized === 'DEEPEN' && group && Number.isFinite(mode)) {
    const inCell = all.filter(
      (q) => q.group_code === group && Number(q.mode_code) === Number(mode)
    )
    const unasked = inCell.filter((q) => !askedSet.has(q.id))
    const sorted = sortByNumericSuffix(unasked.length ? unasked : inCell)
    return pickFirst(sorted)
  }

  if (actionNormalized === 'PERSPECTIVE' && group && Number.isFinite(mode)) {
    const neighbors = listNeighborCells(group, Number(mode))
    const orderedNeighbors = [
      ...neighbors.filter((cell) => cell.group === group || cell.mode === Number(mode)),
      ...neighbors.filter((cell) => cell.group !== group && cell.mode !== Number(mode)),
    ]
    for (const cell of orderedNeighbors) {
      const inCell = all.filter(
        (q) => q.group_code === cell.group && Number(q.mode_code) === Number(cell.mode)
      )
      const unasked = inCell.filter((q) => !askedSet.has(q.id))
      if (unasked.length) {
        return pickFirst(sortByNumericSuffix(unasked))
      }
    }
    for (const cell of orderedNeighbors) {
      const inCell = all.filter(
        (q) => q.group_code === cell.group && Number(q.mode_code) === Number(cell.mode)
      )
      if (inCell.length) {
        return pickFirst(sortByNumericSuffix(inCell))
      }
    }
  }

  const unaskedAll = all.filter((q) => !askedSet.has(q.id))
  return pickRandom(unaskedAll.length ? unaskedAll : all)
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

export default async function handler(req, res) {
  console.log('[coach/suggest][boot]', {
    time: new Date().toISOString(),
    method: req.method,
    url: req.url,
    hasBody: !!req.body,
    bodyType: typeof req.body,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    vercelEnv: process.env.VERCEL_ENV,
    node: process.version,
  })
  if (!req.body) {
    console.error('[coach/suggest][input]', 'Missing request body')
  }
  console.info('[coach/suggest] handler entered', {
    time: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    openAIKeyLen: process.env.OPENAI_API_KEY?.length || 0,
  })
  console.info('[coach/suggest] start', {
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
    const body = await readJsonBody(req)
    if (!body) {
      sendError(res, 400, 'INVALID_JSON', 'Invalid JSON body.')
      return
    }
    const aiSupportEnabled = resolveAiSupportEnabled(req, body)
    const killSwitch = process.env.AI_SUPPORT_DISABLED === 'true'
    const aiSupportHeader = req.headers['x-ai-support']
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY)
    const openAiKeyLen = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0
    const hasContextFields = Boolean(
      body?.sessionName || (Array.isArray(body?.boardEntries) && body.boardEntries.length)
    )
    console.log('[ai] suggest input', {
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
      aiSupportEnabled,
      aiSupportDisabledEnv: process.env.AI_SUPPORT_DISABLED || null,
      hasOpenAIKey: hasOpenAiKey,
      openAIKeyLen: openAiKeyLen,
      nodeEnv: process.env.NODE_ENV || null,
    })
    const dataset = loadQuestionsFromCsvOnce()
    const lang = normalizeLang(body.lang || body.language || 'pl')
    const action = body.action || 'NEXT'
    const askedIds = Array.isArray(body.askedIds) ? body.askedIds : []
    const currentGroupCode = body.currentGroupCode || null
    const currentModeCode = body.currentModeCode || null
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
    }

    if (process.env.NODE_ENV !== 'production') {
      if (!sessionName || !Array.isArray(boardEntriesRaw)) {
        sendError(res, 400, 'MISSING_CONTEXT', 'Missing session context.')
        return
      }
    }

    if (aiSupportEnabled) {
      const limitedEntries = boardEntries.slice(0, 30)
      const keywords = [
        ...extractKeywords(sessionName),
        ...limitedEntries.flatMap((entry) => extractKeywords(entry)),
      ]
      const contextInput = buildContextPrompt({
        boardItems: limitedEntries,
        sessionTitle: sessionName,
        matrixContext,
      })
      const count = Number(body.count || 4)
      const buildInstructions = (attempt) =>
        [
          `Generate ${count} facilitation questions as JSON.`,
          'You are a facilitation coach. You MUST base questions on the provided session title and the existing board entries.',
          'Do not invent product details not present in the context.',
          'Each question must reference at least one concrete theme from the entries OR the session title.',
          'Return ONLY JSON in this shape:',
          '{"questions":[{"id":"...","text":"...","grounded_in":["entry:...","title"],"why_this_question":"..."}]}',
          attempt > 0
            ? 'STRICT: If a question cannot be grounded, replace it. Grounded_in must be non-empty.'
            : '',
        ].filter(Boolean).join(' ')

      const runSuggest = async (attempt) => {
        try {
          return await runLlmTask({
            apiKey: process.env.OPENAI_API_KEY,
            aiSupportEnabled: true,
            task: 'coach-suggest',
            input: contextInput,
            language: lang === 'pl' ? 'Polish' : 'English',
            taskInstructions: buildInstructions(attempt),
            parseResponse: (value) => {
              try {
                const parsed = JSON.parse(value)
                if (!parsed || typeof parsed !== 'object') return null
                if (!Array.isArray(parsed.questions)) return null
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
            maxOutputTokens: 600,
            rateLimiter: limiter,
            rateLimitKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
          })
        } catch (err) {
          console.error('[coach/suggest][LLM_ERROR]', {
            name: err?.name,
            message: err?.message,
            stack: err?.stack,
            cause: err?.cause,
          })
          throw err
        }
      }

      let result
      try {
        result = await runSuggest(0)
      } catch (err) {
        console.error('[coach/suggest] llm_error', {
          name: err?.name,
          message: err?.message,
          stack: typeof err?.stack === 'string' ? err.stack.slice(0, 800) : null,
          status: err?.status || err?.response?.status || null,
        })
        result = {
          ok: false,
          error: String(err?.message || err),
          meta: { aiSupportEnabled: true, modelUsed: null, escalated: false, tokens: { input: 0, output: 0, total: 0 } },
        }
      }
      if (!result.ok) {
        const mapped = mapLlmError(result.error)
        const errorText = String(result.error || '')
        const reasonCategory = errorText.includes('OPENAI_API_KEY')
          ? 'MISSING_OPENAI_KEY'
          : errorText.includes('401') || errorText.includes('403')
            ? 'OPENAI_AUTH'
            : errorText.includes('timeout') || errorText.includes('ETIMEDOUT')
              ? 'OPENAI_NETWORK'
              : 'LLM_FAILED'
        console.error('[ai] LLM failed', {
          code: mapped.code,
          reasonCategory,
          aiSupportEnabled,
          hasOpenAiKey,
        })
        const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
        const rawQuestion = selectQuestion({
          dataset,
          lang,
          action,
          currentGroupCode,
          currentModeCode,
          askedIds,
        })
        const fallback = rawQuestion || dataset.list.find((q) => Number(q.is_active) === 1)
        const normalizedQuestion = normalizeQuestion(fallback ? mapQuestion(fallback, lang) : null)
        assertQuestionShape(normalizedQuestion, 'llm_failed_fallback')
        sendJson(res, 200, {
          ok: true,
          source: 'fallback',
          question: normalizedQuestion,
          meta: {
            aiSupportEnabled: true,
            modelUsed: null,
            escalated: false,
            tokens: { input: 0, output: 0, total: 0 },
            errorCategory: reasonCategory,
          },
        })
        return
      }
      let questions = result.data?.questions || []
      let groundedCount = countGroundedQuestions(questions, keywords)
      if (groundedCount === 0) {
        result = await runSuggest(1)
        if (!result.ok) {
          const mapped = mapLlmError(result.error)
          const errorText = String(result.error || '')
          const reasonCategory = errorText.includes('OPENAI_API_KEY')
            ? 'MISSING_OPENAI_KEY'
            : errorText.includes('401') || errorText.includes('403')
              ? 'OPENAI_AUTH'
              : errorText.includes('timeout') || errorText.includes('ETIMEDOUT')
                ? 'OPENAI_NETWORK'
                : 'LLM_FAILED'
          console.error('[ai] LLM failed', {
            code: mapped.code,
            reasonCategory,
            aiSupportEnabled,
            hasOpenAiKey,
          })
          const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
          const rawQuestion = selectQuestion({
            dataset,
            lang,
            action,
            currentGroupCode,
            currentModeCode,
            askedIds,
          })
          const fallback = rawQuestion || dataset.list.find((q) => Number(q.is_active) === 1)
          const normalizedQuestion = normalizeQuestion(
            fallback ? mapQuestion(fallback, lang) : null
          )
          assertQuestionShape(normalizedQuestion, 'llm_failed_retry_fallback')
          sendJson(res, 200, {
            ok: true,
            source: 'fallback',
            question: normalizedQuestion,
            meta: {
              aiSupportEnabled: true,
              modelUsed: null,
              escalated: false,
              tokens: { input: 0, output: 0, total: 0 },
              errorCategory: reasonCategory,
            },
          })
          return
        }
        questions = result.data?.questions || []
        groundedCount = countGroundedQuestions(questions, keywords)
      }

      if (!questions.length || groundedCount === 0) {
        console.error('[ai] grounding failed; falling back')
      } else {
        const meta = buildMeta(result.meta || { aiSupportEnabled: true, modelUsed: null })
        const normalizedQuestion = normalizeQuestion(questions[0])
        assertQuestionShape(normalizedQuestion, 'llm_success')
        sendJson(res, 200, {
          ok: true,
          question: normalizedQuestion,
          data: { questions },
          groundedCount,
          meta,
          usage: {
            model: meta.modelUsed,
            tokensIn: meta.tokens.input,
            tokensOut: meta.tokens.output,
          },
        })
        return
      }
    }

    const meta = buildMeta({ aiSupportEnabled: false, modelUsed: null, escalated: false })
    const rawQuestion = selectQuestion({
      dataset,
      lang,
      action,
      currentGroupCode,
      currentModeCode,
      askedIds,
    })
    const activeList = dataset.list.filter((q) => Number(q.is_active) === 1)
    if (activeList.length === 0) {
      sendJson(res, 200, {
        ok: false,
        code: 'DATASET_EMPTY',
        message: 'No questions available.',
        meta,
        data: {
          candidates: dataset.list.length,
          datasetStats: dataset.stats,
          csvPath: dataset.csvPath,
        },
      })
      return
    }
    if (!rawQuestion) {
      const fallback = activeList[0]
      const normalizedQuestion = normalizeQuestion(mapQuestion(fallback, lang))
      assertQuestionShape(normalizedQuestion, 'fallback_active_first')
      sendJson(res, 200, {
        ok: true,
        question: normalizedQuestion,
        data: { question: normalizedQuestion },
        meta,
        debug: { fallbackUsed: true },
      })
      return
    }
    const normalizedQuestion = normalizeQuestion(mapQuestion(rawQuestion, lang))
    assertQuestionShape(normalizedQuestion, 'fallback_selected')
    sendJson(res, 200, {
      ok: true,
      question: normalizedQuestion,
      data: { question: normalizedQuestion },
      meta,
    })
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
    sendError(res, 500, 'EXCEPTION', 'Server error.')
  }
}
