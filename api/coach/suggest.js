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

  const { sessionId, action = 'AUTO', modeCode, categoryCode, intentCode, language } = body
  if (!sessionId) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Missing sessionId.' }))
    return
  }

  try {
    const { initEngineDb } = await import('../../engine/db.mjs')
    const { loadQuestionsFromCsvOnce } = await import('../../engine/questionsCsvSource.mjs')
    const {
      selectQuestionFromList,
      finalizeSelection,
    } = await import('../../engine/questionSelector.mjs')

    initEngineDb()
    const normalizedLang = normalizeEngineLanguage(language)
    const dataset = await loadQuestionsFromCsvOnce()
    const candidates = dataset.list
      .filter((question) => Number(question.is_active) === 1)
      .map((question) => {
        const text = question.texts[normalizedLang] || question.texts.pl || ''
        return {
          ...question,
          text,
          lang_text: question.texts[normalizedLang] || null,
          pl_text: question.texts.pl || null,
          tags: [],
        }
      })

    const { question, meta } = selectQuestionFromList({
      sessionId,
      lang: normalizedLang,
      action,
      modeCode,
      categoryCode,
      intentCode,
      all: candidates,
      lookupQuestionById: (id) => dataset.byId.get(id) || null,
    })

    if (!question) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          ok: false,
          error: 'NO_QUESTION',
          reason: {
            candidates: candidates.length,
            datasetStats: dataset.stats,
            csvPath: dataset.csvPath,
            meta,
          },
        })
      )
      return
    }

    finalizeSelection({ sessionId, question })

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ question }))
  } catch (error) {
    if (error?.message?.startsWith('CSV_')) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          ok: false,
          error: error.message.split(' ')[0],
          details: { message: error.message },
        })
      )
      return
    }
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: error?.message || 'Server error' }))
  }
}
