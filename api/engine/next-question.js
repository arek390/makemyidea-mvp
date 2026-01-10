const readJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body
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

const normalizeEngineLanguage = (language) => {
  if (!language) return 'pl'
  const normalized = String(language).toLowerCase()
  if (normalized.startsWith('en')) return 'en'
  if (normalized.startsWith('pl')) return 'pl'
  if (normalized.startsWith('de')) return 'de'
  if (normalized.startsWith('es')) return 'es'
  if (normalized.startsWith('hi')) return 'hi'
  if (normalized.startsWith('zh')) return 'zh'
  return normalized.slice(0, 2)
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
    return
  }

  const body = await readJsonBody(req)
  if (!body) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body.' }))
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
    action = 'AUTO',
  } = body
  if (!sessionId) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Missing sessionId.' }))
    return
  }

  try {
    const { initEngineDb } = await import('../../engine/db.mjs')
    const { getQuestionDataset } = await import('../../engine/questionDataset.mjs')
    const {
      selectQuestion,
      selectQuestionFromList,
      finalizeSelection,
    } = await import('../../engine/questionSelector.mjs')

    initEngineDb()
    const normalizedLang = normalizeEngineLanguage(language)
    const dataset = getQuestionDataset()
    const debugEnabled = process.env.DEBUG_ENGINE === '1'

    const { question, meta } =
      dataset.source === 'db'
        ? selectQuestion({
            sessionId,
            lang: normalizedLang,
            groupCode,
            modeCode,
            categoryCode,
            intentCode,
            tags,
            minDifficulty,
            maxDifficulty,
            action,
          })
        : selectQuestionFromList({
            sessionId,
            lang: normalizedLang,
            groupCode,
            modeCode,
            categoryCode,
            intentCode,
            tags,
            minDifficulty,
            maxDifficulty,
            action,
            all: dataset.getQuestionsForLang(normalizedLang),
            lookupQuestionById: dataset.lookupById,
          })

    if (!question) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          question: null,
          meta: debugEnabled
            ? { ...meta, source: dataset.source, questionsCount: dataset.questionsCount }
            : undefined,
        })
      )
      return
    }

    finalizeSelection({ sessionId, question })

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        question,
        meta: debugEnabled
          ? { ...meta, source: dataset.source, questionsCount: dataset.questionsCount }
          : undefined,
      })
    )
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: error?.message || 'Server error' }))
  }
}
