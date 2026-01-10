const fs = require('fs')
const path = require('path')

let cachedDataset = null

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
  const mapQuestion = (q) => ({
    id: q.id,
    text: q.texts[normalizedLang] || q.texts.pl || '',
    group_code: q.group_code,
    mode_code: q.mode_code,
    category_code: q.category_code,
    intent_code: q.intent_code,
    difficulty: q.difficulty,
    priority: q.priority,
  })

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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
      return
    }
    const body = await readJsonBody(req)
    if (!body) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: 'INVALID_JSON' }))
      return
    }
    const dataset = loadQuestionsFromCsvOnce()
    const question = selectQuestion({
      dataset,
      lang: body.lang || body.language || 'pl',
      action: body.action || 'NEXT',
      currentGroupCode: body.currentGroupCode || null,
      currentModeCode: body.currentModeCode || null,
      askedIds: Array.isArray(body.askedIds) ? body.askedIds : [],
    })
    if (!question) {
      res.statusCode = 200
      res.end(
        JSON.stringify({
          ok: false,
          error: 'NO_QUESTION',
          reason: {
            candidates: dataset.list.length,
            datasetStats: dataset.stats,
            csvPath: dataset.csvPath,
          },
        })
      )
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, question }))
  } catch (error) {
    res.statusCode = 500
    res.end(
      JSON.stringify({
        ok: false,
        error: 'EXCEPTION',
        message: error?.message || 'Server error',
        stack: error?.stack || null,
      })
    )
  }
}
