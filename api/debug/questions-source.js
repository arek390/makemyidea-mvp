const fs = require('fs')
const path = require('path')

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json')

  const cwd = process.cwd()
  const csvPath = path.join(cwd, 'public', 'questions_enriched_pl_eng.csv')

  let exists = false
  try {
    exists = fs.existsSync(csvPath)
  } catch {
    exists = false
  }

  if (!exists) {
    res.statusCode = 200
    res.end(JSON.stringify({ ok: false, error: 'CSV_NOT_FOUND', cwd, csvPath, exists }))
    return
  }

  try {
    const raw = fs.readFileSync(csvPath, 'utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    const rows = Math.max(0, lines.length - 1)

    const header = lines[0] || ''
    const delim = header.split(';').length > header.split(',').length ? ';' : ','

    const idSet = new Set()
    const langSet = new Set()

    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split(delim)
      const id = (parts[0] || '').trim()
      const lang = (parts[parts.length - 1] || '').trim()
      if (id) idSet.add(id)
      if (lang) langSet.add(lang)
    }

    res.statusCode = 200
    res.end(
      JSON.stringify({
        ok: true,
        cwd,
        csvPath,
        exists: true,
        stats: { rows, uniqueIds: idSet.size, langs: Array.from(langSet).sort() },
      })
    )
  } catch (error) {
    res.statusCode = 200
    res.end(
      JSON.stringify({
        ok: false,
        error: 'EXCEPTION_READING_CSV',
        message: String(error && error.message ? error.message : error),
        cwd,
        csvPath,
        exists: true,
      })
    )
  }
}
