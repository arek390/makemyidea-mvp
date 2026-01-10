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
    const { getDbHealth } = await import('../../engine/dbHealth.mjs')
    const { seedQuestionsIfEmpty } = await import('../../engine/seedQuestions.mjs')
    const { selectQuestion, finalizeSelection } = await import('../../engine/questionSelector.mjs')

    initEngineDb()
    seedQuestionsIfEmpty()
    const health = getDbHealth()
    if (health.questionsCount === 0) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'DB_EMPTY' }))
      return
    }

    const { question } = selectQuestion({
      sessionId,
      lang: normalizeEngineLanguage(language),
      groupCode,
      modeCode,
      categoryCode,
      intentCode,
      tags,
      minDifficulty,
      maxDifficulty,
      action,
    })

    if (!question) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ question: null }))
      return
    }

    finalizeSelection({ sessionId, question })

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ question }))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: error?.message || 'Server error' }))
  }
}
