module.exports = async (req, res) => {
  try {
    const { getQuestionsCsvInfo } = await import('../../engine/questionsCsvSource.mjs')
    const info = await getQuestionsCsvInfo()
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, ...info }))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        ok: false,
        error: error?.message || 'CSV_SOURCE_ERROR',
      })
    )
  }
}
