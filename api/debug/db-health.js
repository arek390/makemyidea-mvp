module.exports = async (req, res) => {
  if (process.env.DEBUG_ENGINE !== '1') {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }))
    return
  }

  try {
    const { initEngineDb, ENGINE_DB_PATH } = await import('../../engine/db.mjs')
    const { getDbHealth } = await import('../../engine/dbHealth.mjs')
    const { getCsvInfo } = await import('../../engine/questionDataset.mjs')

    initEngineDb()
    const dbHealth = getDbHealth()
    const csvInfo = getCsvInfo()

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        ok: true,
        env: process.env.VERCEL ? 'vercel' : 'local',
        dbPath: ENGINE_DB_PATH || null,
        dbHealth,
        csvInfo,
      })
    )
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: error?.message || 'Server error' }))
  }
}
